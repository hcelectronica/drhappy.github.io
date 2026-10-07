import test from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:net'
import { spawn } from 'node:child_process'
import { io } from 'socket.io-client'
import { createVideoServer } from './videoServer.mjs'

async function fixture(t, options = {}) {
  const reservation = createServer()
  await new Promise(resolve => reservation.listen(0, '127.0.0.1', resolve))
  const port = reservation.address().port
  await new Promise(resolve => reservation.close(resolve))
  const origin = `http://127.0.0.1:${port}`
  const revoked = new Set()
  const clients = []
  const records = []
  const app = createVideoServer({
    origin, iceServers: [],
    login: async (username, password) => {
      if (password !== 'correct') throw Object.assign(new Error('Credenciales invalidas.'), { status: 401 })
      if (!['admin', 'admin2'].includes(username)) throw Object.assign(new Error('Solo administradores.'), { status: 403 })
      return username
    },
    verifyAdmin: async token => {
      if (revoked.has(token)) throw Object.assign(new Error('Permiso revocado.'), { status: 403 })
      return token
    },
    listPatients: async () => ({ patients: [{ id: 'patient-test', name: 'Paciente de prueba' }], appointments: [] }),
    createConsultation: async (_token, data) => {
      if (data.patientId !== 'patient-test' || data.appointmentId) throw Object.assign(new Error('Paciente o turno ajeno.'), { status: 403 })
      return { consultationId: 'consultation-test', patientName: 'Paciente de prueba', lifecycleToken: 'a'.repeat(64) }
    },
    recordConsultationEvent: async (_token, event) => { records.push(event); return { ok: true } },
    ...options,
  })
  await new Promise(resolve => app.server.listen(port, '127.0.0.1', resolve))
  t.after(async () => { for (const client of clients) client.disconnect(); await app.close() })
  const request = async (path, { cookie, data, method = 'GET', requestOrigin = origin, headers = {} } = {}) => {
    const response = await fetch(`${origin}${path}`, {
      method, headers: { Origin: requestOrigin, ...(cookie ? { Cookie: cookie } : {}),
        ...(data ? { 'Content-Type': 'application/json' } : {}), ...headers },
      ...(data ? { body: JSON.stringify(data) } : {}),
    })
    return { status: response.status, data: await response.json(), cookie: response.headers.get('set-cookie')?.split(';')[0], headers: response.headers }
  }
  const login = async (username = 'admin') => {
    const response = await request('/api/login', { method: 'POST', data: { username, password: 'correct' } })
    assert.equal(response.status, 200)
    assert.match(response.headers.get('set-cookie'), /HttpOnly; SameSite=Strict/)
    return response.cookie
  }
  const create = async (cookie, durationMinutes = 40) => {
    const response = await request('/api/rooms', { cookie, method: 'POST', data: { durationMinutes, patientId: 'patient-test' } })
    assert.equal(response.status, 201)
    return { ...response.data, patient: response.data.patientLink.split('#p=')[1] }
  }
  const connect = (token, cookie, requestOrigin = origin) => new Promise(resolve => {
    const client = io(origin, { transports: ['websocket'], reconnection: false,
      auth: { token }, extraHeaders: { Origin: requestOrigin, ...(cookie ? { Cookie: cookie } : {}) } })
    clients.push(client)
    client.on('connect', () => resolve({ client }))
    client.on('connect_error', error => { client.disconnect(); resolve({ error }) })
  })
  return { origin, revoked, request, login, create, connect, records }
}
const event = (client, name) => new Promise((resolve, reject) => {
  const timer = setTimeout(() => { client.off(name, listener); reject(new Error(`Timeout ${name}`)) }, 5000)
  const listener = value => { clearTimeout(timer); resolve(value) }
  client.once(name, listener)
})
const emit = (client, name, data) => new Promise((resolve, reject) => {
  const callback = (error, value) => error ? reject(error) : resolve(value)
  if (data === undefined) client.timeout(5000).emit(name, callback)
  else client.timeout(5000).emit(name, data, callback)
})

test('HTTP authorization, cookie, CSRF and payload validation', async t => {
  const f = await fixture(t)
  assert.equal((await f.request('/api/rooms', { method: 'POST' })).status, 401)
  assert.equal((await f.request('/api/login', { method: 'POST', requestOrigin: 'https://attacker.invalid', data: { username: 'admin', password: 'correct' } })).status, 403)
  assert.equal((await f.request('/api/login', { method: 'POST', data: { username: 'normal', password: 'correct' } })).status, 403)
  assert.equal((await f.request('/api/login', { method: 'POST', data: { username: 'admin', password: 'bad' } })).status, 401)
  assert.equal((await f.request('/api/login', { method: 'POST', data: { username: 'admin,email.ilike.%', password: 'correct' } })).status, 400)
  assert.equal((await f.request('/api/login', { method: 'POST', data: { username: 'admin', password: 'x'.repeat(5000) } })).status, 413)
  const cookie = await f.login()
  assert.equal((await f.request('/api/session', { cookie })).data.admin, true)
  assert.equal((await f.request('/api/rooms', { cookie, method: 'POST', requestOrigin: 'https://attacker.invalid' })).status, 403)
  const room = await f.create(cookie)
  assert.equal((await f.request('/api/ice')).status, 401)
  assert.equal((await f.request('/api/ice', { headers: { 'x-video-token': room.patient } })).status, 200)
  assert.equal((await f.request('/api/ice', { headers: { 'x-video-token': room.token } })).status, 401)
  f.revoked.add('admin')
  assert.equal((await f.request('/api/rooms', { cookie, method: 'POST' })).status, 403)
})

test('invitation email uses the owned live room and never accepts client recipient or URL', async t => {
  const calls = []
  const f = await fixture(t, { sendInvitation: async (token, data) => { calls.push({ token, data }); return { ok: true } } })
  const cookie = await f.login()
  const room = await f.create(cookie)
  const send = (token, owner = cookie) => f.request('/api/rooms/invitation-email', {
    cookie: owner, method: 'POST', data: { token, patientLink: 'https://attacker.invalid/', to: 'wrong@example.invalid' },
  })
  assert.equal((await send(room.token, null)).status, 401)
  assert.equal((await send(room.patient)).status, 400)
  assert.equal((await send('b'.repeat(64))).status, 409)
  const other = await f.login('admin2')
  assert.equal((await send(room.token, other)).status, 409)
  assert.equal((await send(room.token)).status, 200)
  assert.deepEqual(calls, [{ token: 'admin', data: {
    consultationId: 'consultation-test', lifecycleToken: 'a'.repeat(64), patientLink: room.patientLink,
  } }])
  assert.equal((await send(room.token)).status, 409)
  assert.equal(calls.length, 1)
})

test('invitation email blocks concurrent requests, rejects expired rooms and surfaces mail errors', async t => {
  let clock = Date.now()
  let finish
  let calls = 0
  const f = await fixture(t, { now: () => clock, sendInvitation: async () => {
    calls++
    return await new Promise(resolve => { finish = resolve })
  } })
  const cookie = await f.login()
  const room = await f.create(cookie)
  const send = () => f.request('/api/rooms/invitation-email', { cookie, method: 'POST', data: { token: room.token } })
  const pending = send()
  while (!finish) await new Promise(resolve => setTimeout(resolve, 5))
  assert.equal((await send()).status, 409)
  finish({ ok: false })
  assert.equal((await pending).status, 502)
  assert.equal(calls, 1)
  clock += 31 * 60_000
  assert.equal((await send()).status, 409)
})

test('Sofia summary routes require an authorized session, enforce limits and propagate quota errors', async t => {
  const calls = []
  const consultationId = '3f2b8c1e-5d4a-4b6f-9a1c-2e7d8f9a0b1c'
  const f = await fixture(t, {
    summarizeConsultation: async (token, data) => {
      calls.push(['summary', token, data])
      if (data.professional === 'sin cupo') throw Object.assign(new Error('Alcanzaste el limite mensual de consultas de Sofia.'), { status: 429 })
      return { motivoConsulta: 'Control', detalleAtencion: 'Refiere mejoria.', planManejo: 'Control en 7 dias.', extra: 'no' }
    },
    saveConsultationSummary: async (token, data) => {
      calls.push(['save', token, data])
      if (data.motivoConsulta === 'repetido') throw Object.assign(new Error('Ya fue guardado.'), { status: 409 })
      return { ok: true }
    },
  })
  const summary = { consultationId, professional: 'como te sentis', patient: 'mucho mejor' }
  assert.equal((await f.request('/api/consultations/summary', { method: 'POST', data: summary })).status, 401)
  const cookie = await f.login()
  assert.equal((await f.request('/api/consultations/summary', { cookie, method: 'POST', requestOrigin: 'https://attacker.invalid', data: summary })).status, 403)
  assert.equal((await f.request('/api/consultations/summary', { cookie, method: 'POST', data: { ...summary, consultationId: 'consultation-test' } })).status, 400)
  assert.equal((await f.request('/api/consultations/summary', { cookie, method: 'POST', data: { ...summary, patient: 'x'.repeat(100_001) } })).status, 400)
  const long = await f.request('/api/consultations/summary', { cookie, method: 'POST', data: { ...summary, professional: 'a'.repeat(60_000), patient: 'b'.repeat(60_000) } })
  assert.equal(long.status, 200)
  const ok = await f.request('/api/consultations/summary', { cookie, method: 'POST', data: summary })
  assert.deepEqual(ok.data, { motivoConsulta: 'Control', detalleAtencion: 'Refiere mejoria.', planManejo: 'Control en 7 dias.' })
  assert.deepEqual(calls.at(-1), ['summary', 'admin', summary])
  const quota = await f.request('/api/consultations/summary', { cookie, method: 'POST', data: { ...summary, professional: 'sin cupo' } })
  assert.equal(quota.status, 429)
  assert.match(quota.data.error, /limite mensual/)
  const entry = { consultationId, motivoConsulta: 'Control', detalleAtencion: 'Refiere mejoria.', planManejo: '' }
  assert.equal((await f.request('/api/consultations/save', { cookie, method: 'POST', data: { ...entry, detalleAtencion: '  ' } })).status, 400)
  assert.equal((await f.request('/api/consultations/save', { cookie, method: 'POST', data: { ...entry, detalleAtencion: 'x'.repeat(8001) } })).status, 400)
  assert.equal((await f.request('/api/consultations/save', { cookie, method: 'POST', data: entry })).status, 201)
  assert.deepEqual(calls.at(-1), ['save', 'admin', entry])
  assert.equal((await f.request('/api/consultations/save', { cookie, method: 'POST', data: { ...entry, motivoConsulta: 'repetido' } })).status, 409)
  f.revoked.add('admin')
  assert.equal((await f.request('/api/consultations/save', { cookie, method: 'POST', data: entry })).status, 403)
})

test('Patient ownership is checked server-side and lifecycle secrets never reach participants', async t => {
  const f = await fixture(t)
  assert.equal((await f.request('/api/patients')).status, 401)
  const cookie = await f.login()
  assert.deepEqual((await f.request('/api/patients', { cookie })).data.patients, [{ id: 'patient-test', name: 'Paciente de prueba' }])
  for (const patientId of [undefined, '', '<script>', 'another-patient']) {
    const result = await f.request('/api/rooms', { cookie, method: 'POST', data: { durationMinutes: 40, patientId } })
    assert([400, 403].includes(result.status))
  }
  const room = await f.create(await f.login())
  assert.equal(room.patientName, 'Paciente de prueba')
  assert.equal(room.consultationId, 'consultation-test')
  assert(!JSON.stringify(room).includes('lifecycleToken'))
  assert(!room.patientLink.includes('patient-test'))
  const professional = (await f.connect(room.token, await f.login('admin2'))).error
  assert(professional)
})

test('Admission and finalization persist clinical metadata before success acknowledgement', async t => {
  const f = await fixture(t)
  const cookie = await f.login()
  const room = await f.create(cookie)
  const professional = (await f.connect(room.token, cookie)).client
  await f.connect(room.patient)
  assert.equal((await emit(professional, 'admit')).ok, true)
  assert.deepEqual(f.records, ['start'])
  assert.equal((await emit(professional, 'admit')).ok, true)
  assert.deepEqual(f.records, ['start'])
  assert.equal((await emit(professional, 'end')).ok, true)
  assert(f.records.includes('completed'))
})

test('Failure to persist start prevents admission instead of leaving an unregistered call', async t => {
  const f = await fixture(t, { recordConsultationEvent: async (_token, event) => {
    if (event === 'start') throw Object.assign(new Error('Registro no disponible.'), { status: 503 })
    return { ok: true }
  } })
  const cookie = await f.login()
  const room = await f.create(cookie)
  const professional = (await f.connect(room.token, cookie)).client
  const patient = (await f.connect(room.patient)).client
  assert((await emit(professional, 'admit')).error)
  assert((await emit(patient, 'signal', { candidate: { candidate: 'candidate:test' } })).error)
})

test('Server gates admission, roles, signals, duplicate access, reconnection, logout and token revocation', async t => {
  const f = await fixture(t)
  const cookie = await f.login()
  const room = await f.create(cookie)
  assert((await f.connect(room.token)).error)
  const another = await f.login('admin2')
  assert((await f.connect(room.token, another)).error)
  assert((await f.connect(room.patient, undefined, 'https://attacker.invalid')).error)
  assert((await f.connect('0'.repeat(64))).error)
  const professional = (await f.connect(room.token, cookie)).client
  const patient = (await f.connect(room.patient)).client
  assert(professional && patient)
  assert((await f.connect(room.patient)).error.message.includes('otra pestana'))
  assert((await emit(patient, 'admit')).error)
  assert((await emit(patient, 'end')).error)
  assert((await emit(patient, 'signal', { candidate: { candidate: 'candidate:test' } })).error)
  const state = event(patient, 'state')
  assert.equal((await emit(professional, 'admit')).ok, true)
  assert.equal((await state).admitted, true)
  assert((await emit(patient, 'signal', { description: { type: 'offer', sdp: 'test' } })).error)
  const offer = event(patient, 'signal')
  assert.equal((await emit(professional, 'signal', { description: { type: 'offer', sdp: 'test' } })).ok, true)
  assert.deepEqual(await offer, { description: { type: 'offer', sdp: 'test' } })
  assert((await emit(professional, 'signal', { candidate: { candidate: 'test', sdpMLineIndex: -1 } })).error)
  assert((await emit(professional, 'signal', { description: { type: 'offer', sdp: 'a'.repeat(50001) } })).error)
  const disconnected = event(professional, 'state')
  patient.disconnect()
  assert.equal((await disconnected).admitted, false)
  const rejoined = (await f.connect(room.patient)).client
  assert(rejoined)
  assert((await emit(rejoined, 'signal', { candidate: { candidate: 'test' } })).error)
  assert.equal((await emit(professional, 'admit')).ok, true)
  const ended = event(rejoined, 'ended')
  assert.equal((await f.request('/api/logout', { cookie, method: 'POST' })).status, 200)
  assert.match(await ended, /sesion administrativa/)
  assert((await f.connect(room.patient)).error)
  assert.equal((await f.request('/api/session', { cookie })).status, 401)
})

test('Reject invalidates invitation; end invalidates both participants; expiry closes active rooms', async t => {
  const f = await fixture(t, { waitingDurationMs: 1500 })
  const cookie = await f.login()
  let room = await f.create(cookie)
  let professional = (await f.connect(room.token, cookie)).client
  let patient = (await f.connect(room.patient)).client
  const rejected = event(patient, 'ended')
  assert.equal((await emit(professional, 'reject')).ok, true)
  assert.match(await rejected, /rechazo/)
  assert((await f.connect(room.patient)).error)
  assert.equal((await emit(professional, 'end')).ok, true)
  assert((await f.connect(room.token, cookie)).error)
  room = await f.create(cookie)
  professional = (await f.connect(room.token, cookie)).client
  patient = (await f.connect(room.patient)).client
  const expired = event(patient, 'ended')
  assert.match(await expired, /vencio/)
  assert((await f.connect(room.patient)).error)
})

test('Administrative revocation is rechecked for connected rooms and privileged actions', async t => {
  const f = await fixture(t, { checkIntervalMs: 50 })
  const cookie = await f.login()
  const room = await f.create(cookie)
  const professional = (await f.connect(room.token, cookie)).client
  const patient = (await f.connect(room.patient)).client
  const ended = event(patient, 'ended')
  f.revoked.add('admin')
  assert.match(await ended, /sesion administrativa/)
  assert.equal(professional.connected, false)
  assert((await f.connect(room.patient)).error)
})

test('Privileged controls revalidate permission without waiting for the periodic check', async t => {
  const f = await fixture(t)
  const cookie = await f.login()
  const room = await f.create(cookie)
  const professional = (await f.connect(room.token, cookie)).client
  const patient = (await f.connect(room.patient)).client
  const ended = event(patient, 'ended')
  f.revoked.add('admin')
  assert.match((await emit(professional, 'admit')).error, /revocado/)
  assert.match(await ended, /autorizada/)
  assert((await f.connect(room.patient)).error)
})

test('Authorization service failures deny requests instead of granting access', async t => {
  let unavailable = false
  const f = await fixture(t, { verifyAdmin: async token => {
    if (unavailable) throw Object.assign(new Error('Servicio no disponible.'), { status: 503 })
    return token
  } })
  const cookie = await f.login()
  const room = await f.create(cookie)
  unavailable = true
  assert.equal((await f.request('/api/rooms', { cookie, method: 'POST' })).status, 503)
  assert.equal((await f.request('/api/ice', { headers: { 'x-video-token': room.patient } })).status, 503)
  assert((await f.connect(room.patient)).error)
})

test('Room caps and login throttling reject excess requests', async t => {
  const f = await fixture(t)
  const cookie = await f.login()
  for (let index = 0; index < 3; index++) await f.create(cookie)
  assert.equal((await f.request('/api/rooms', { cookie, method: 'POST', data: { durationMinutes: 40, patientId: 'patient-test' } })).status, 429)
  for (let index = 0; index < 19; index++) await f.request('/api/login', { method: 'POST', data: { username: 'admin', password: 'bad' } })
  assert.equal((await f.request('/api/login', { method: 'POST', data: { username: 'admin', password: 'bad' } })).status, 429)
})

test('Concurrent creation reserves room slots while remote patient registration is pending', async t => {
  let created = 0
  const f = await fixture(t, { createConsultation: async () => {
    await new Promise(resolve => setTimeout(resolve, 60))
    created++
    return { consultationId: `consultation-${created}`, patientName: 'Fixture', lifecycleToken: 'a'.repeat(64) }
  } })
  const cookie = await f.login()
  const responses = await Promise.all(Array.from({ length: 5 }, () => f.request('/api/rooms', {
    cookie, method: 'POST', data: { patientId: 'patient-test', durationMinutes: 40 },
  })))
  assert.equal(responses.filter(response => response.status === 201).length, 3)
  assert.equal(responses.filter(response => response.status === 429).length, 2)
  assert.equal(created, 3)
})

test('Duration accepts 1 through 120 whole minutes and rejects missing, fractional or coerced values', async t => {
  const f = await fixture(t)
  const cookie = await f.login()
  assert.equal((await f.create(cookie, 1)).durationMinutes, 1)
  assert.equal((await f.create(cookie, 120)).durationMinutes, 120)
  for (const value of [undefined, null, 0, -1, 121, 40.5, '40', true]) {
    const anotherCookie = await f.login()
    const result = await f.request('/api/rooms', { cookie: anotherCookie, method: 'POST', data: { durationMinutes: value } })
    assert.equal(result.status, 400, `Invalid duration: ${String(value)}`)
  }
})

test('First admission starts selected duration; duplicate admission and reentry do not reset it; expiry revokes access', async t => {
  let clock = Date.now()
  const f = await fixture(t, { now: () => clock })
  const cookie = await f.login()
  const room = await f.create(cookie, 40)
  assert.equal(room.startedAt, null)
  assert.equal(room.expiresAt - room.serverNow, 30 * 60_000)
  clock += 29 * 60_000
  const professional = (await f.connect(room.token, cookie)).client
  const patient = (await f.connect(room.patient)).client
  const started = event(patient, 'state')
  await emit(professional, 'admit')
  const state = await started
  assert.equal(state.durationMinutes, 40)
  assert.equal(state.startedAt, clock)
  assert.equal(state.expiresAt - state.startedAt, 40 * 60_000, 'Wait does not consume consultation time')
  assert.equal((await emit(professional, 'admit')).ok, true)
  const left = event(professional, 'state')
  patient.disconnect()
  assert.equal((await left).expiresAt, state.expiresAt)
  clock += 20 * 60_000
  const rejoined = (await f.connect(room.patient)).client
  const readmitted = event(rejoined, 'state')
  await emit(professional, 'admit')
  const again = await readmitted
  assert.equal(again.startedAt, state.startedAt)
  assert.equal(again.expiresAt, state.expiresAt)
  assert.equal(again.expiresAt - again.serverNow, 20 * 60_000)
  const ended = event(rejoined, 'ended')
  clock = state.expiresAt
  assert.match(await ended, /duracion elegida/)
  assert((await f.connect(room.patient)).error)
  assert((await f.connect(room.token, cookie)).error)
})

test('120-minute consultation is not cut off by the former one-hour administrative session', async t => {
  let clock = Date.now()
  const f = await fixture(t, { now: () => clock })
  const cookie = await f.login()
  const room = await f.create(cookie, 120)
  clock += 29 * 60_000
  const professional = (await f.connect(room.token, cookie)).client
  const patient = (await f.connect(room.patient)).client
  const started = event(patient, 'state')
  await emit(professional, 'admit')
  const state = await started
  clock += 119 * 60_000
  assert.equal((await f.request('/api/session', { cookie })).status, 200)
  assert.equal((await emit(professional, 'admit')).ok, true)
  const ended = event(patient, 'ended')
  clock = state.expiresAt
  assert.match(await ended, /duracion elegida/)
})

test('Creation refuses a session too old to cover chosen duration and waiting window', async t => {
  let clock = Date.now()
  const f = await fixture(t, { now: () => clock })
  const cookie = await f.login()
  clock += 31 * 60_000
  assert.equal((await f.request('/api/rooms', { cookie, method: 'POST', data: { durationMinutes: 120, patientId: 'patient-test' } })).status, 409)
})

test('Invalid public origins and ICE configurations fail explicitly at startup', () => {
  assert.throws(() => createVideoServer({ origin: 'http://public.invalid' }), /HTTPS/)
  assert.throws(() => createVideoServer({ iceServers: [{ urls: 'https://invalid' }] }), /STUN\/TURN/)
  assert.throws(() => createVideoServer({ iceServers: [{ urls: 'turn:example.invalid:3478' }] }), /STUN\/TURN/)
})

test('One-use handoff establishes HttpOnly session, rejects reuse/invalid passes and cross-origin requests', async t => {
  const available = new Set(['a'.repeat(64), 'b'.repeat(64), 'c'.repeat(64)])
  const f = await fixture(t, { exchangeHandoff: async token => {
    if (!available.delete(token)) throw Object.assign(new Error('Pase vencido o usado.'), { status: 401 })
    return token === 'c'.repeat(64) ? 'admin2' : 'admin'
  } })
  assert.equal((await f.request('/api/handoff', { method: 'POST', data: { token: 'invalid' } })).status, 400)
  assert.equal((await f.request('/api/handoff', { method: 'POST', requestOrigin: 'https://attacker.invalid', data: { token: 'a'.repeat(64) } })).status, 403)
  const response = await f.request('/api/handoff', { method: 'POST', data: { token: 'a'.repeat(64) } })
  assert.equal(response.status, 200)
  assert.match(response.headers.get('set-cookie'), /HttpOnly; SameSite=Strict/)
  assert.deepEqual(response.data, { ok: true }, 'Does not expose upstream session token to browser')
  assert.equal((await f.request('/api/session', { cookie: response.cookie })).status, 200)
  assert.equal((await f.request('/api/handoff', { method: 'POST', data: { token: 'a'.repeat(64) } })).status, 401)
  const room = await f.create(response.cookie)
  const professional = (await f.connect(room.token, response.cookie)).client
  const same = await f.request('/api/handoff', { cookie: response.cookie, method: 'POST', data: { token: 'b'.repeat(64) } })
  assert.equal(same.status, 200)
  assert.equal(same.cookie, undefined, 'Same account keeps cookie and existing rooms')
  assert(professional.connected)
  const ended = event(professional, 'ended')
  const other = await f.request('/api/handoff', { cookie: response.cookie, method: 'POST', data: { token: 'c'.repeat(64) } })
  assert.equal(other.status, 200)
  assert.notEqual(other.cookie, response.cookie)
  await ended
  assert.equal((await f.request('/api/session', { cookie: response.cookie })).status, 401)
})

test('Consumed pass still requires fresh administrative validation before creating local session', async t => {
  const f = await fixture(t, { exchangeHandoff: async () => 'admin' })
  f.revoked.add('admin')
  const denied = await f.request('/api/handoff', { method: 'POST', data: { token: 'a'.repeat(64) } })
  assert.equal(denied.status, 403)
  assert.equal(denied.cookie, undefined)
})

test('Short patient links have 128-bit random secrets in fragments, retain admission and reject guessing or administrative use', async t => {
  const f = await fixture(t)
  const cookie = await f.login()
  const room = await f.create(cookie)
  assert.match(room.patient, /^[A-Za-z0-9_-]{21}[AQgw]$/)
  assert.equal(Buffer.from(room.patient, 'base64url').length, 16)
  assert.equal(new URL(room.patientLink).pathname, '/')
  assert.equal(new URL(room.patientLink).search, '', 'Secret never placed in server request URL')
  assert.equal(room.patientLink.length, f.origin.length + 26)
  const room2 = await f.create(cookie)
  assert.notEqual(room.patient, room2.patient)
  assert.equal((await f.request('/api/ice', { headers: { 'x-video-token': room.patient } })).status, 200)
  assert.equal((await f.request('/api/rooms', { method: 'POST', data: { durationMinutes: 40 }, headers: { 'x-video-token': room.patient } })).status, 401)
  assert.equal((await f.request('/api/handoff', { method: 'POST', data: { token: room.patient } })).status, 400)
  assert.equal((await f.request('/api/session', { cookie: `drhappy-video=${room.patient}` })).status, 401)
  const patient = (await f.connect(room.patient)).client
  assert(patient.connected)
  assert((await emit(patient, 'signal', { description: { type: 'answer', sdp: 'test' } })).error)
  const invalid = room.patient.slice(0, -1) + 'B'
  assert.equal((await f.request('/api/ice', { headers: { 'x-video-token': invalid } })).status, 401)
  assert((await f.connect('A'.repeat(22))).error)
})

test('Manual login keeps original replacement behavior instead of silently retaining old sessions', async t => {
  const f = await fixture(t)
  const cookie = await f.login()
  const room = await f.create(cookie)
  const professional = (await f.connect(room.token, cookie)).client
  const ended = event(professional, 'ended')
  const response = await f.request('/api/login', { cookie, method: 'POST', data: { username: 'admin', password: 'correct' } })
  assert.equal(response.status, 200)
  assert.notEqual(response.cookie, cookie)
  await ended
  assert.equal((await f.request('/api/session', { cookie })).status, 401)
})

test('Entry listens within 3 seconds when executed directly or imported by a hosting wrapper', async t => {
  for (const mode of ['direct', 'import']) {
    await t.test(mode, async () => {
      const reservation = createServer()
      await new Promise(resolve => reservation.listen(0, '127.0.0.1', resolve))
      const port = reservation.address().port
      await new Promise(resolve => reservation.close(resolve))
      const origin = `http://127.0.0.1:${port}`
      const args = mode === 'direct' ? ['server.mjs'] : ['--input-type=module', '-e', "await import('./server.mjs')"]
      const started = performance.now()
      const child = spawn(process.execPath, args, {
        cwd: new URL('.', import.meta.url),
        env: { ...process.env, PORT: String(port), PUBLIC_ORIGIN: origin, ICE_SERVERS_JSON: '[]' },
        stdio: ['ignore', 'pipe', 'pipe'],
      })
      let output = ''
      let launchError
      child.stdout.on('data', chunk => { output += chunk })
      child.stderr.on('data', chunk => { output += chunk })
      child.on('error', error => { launchError = error })
      try {
        let ready = false
        while (performance.now() - started < 3000) {
          if (launchError) throw launchError
          if (child.exitCode !== null) throw new Error(`Startup exited: ${output}`)
          try {
            const response = await fetch(`${origin}/health`, { signal: AbortSignal.timeout(500) })
            if (response.ok) { assert.equal(typeof (await response.json()).turnConfigured, 'boolean'); ready = true; break }
          } catch (error) {
            if (error.cause?.code !== 'ECONNREFUSED' && error.name !== 'TimeoutError') throw error
          }
          await new Promise(resolve => setTimeout(resolve, 25))
        }
        assert(ready, `No listen within 3 seconds: ${mode}\n${output}`)
        const denied = await fetch(`${origin}/api/rooms`, { method: 'POST', headers: { Origin: origin } })
        assert.equal(denied.status, 401)
      } finally {
        if (child.exitCode === null && child.signalCode === null) {
          const exited = new Promise(resolve => child.once('exit', resolve))
          child.kill()
          await exited
        }
      }
    })
  }
})
