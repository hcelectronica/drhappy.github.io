import test from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:net'
import { io } from 'socket.io-client'
import { createVideoServer } from './server.mjs'

async function fixture(t, options = {}) {
  const reservation = createServer()
  await new Promise(resolve => reservation.listen(0, '127.0.0.1', resolve))
  const port = reservation.address().port
  await new Promise(resolve => reservation.close(resolve))
  const origin = `http://127.0.0.1:${port}`
  const revoked = new Set()
  const clients = []
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
  const create = async cookie => {
    const response = await request('/api/rooms', { cookie, method: 'POST' })
    assert.equal(response.status, 201)
    return { ...response.data, patient: response.data.patientLink.split('#invite=')[1] }
  }
  const connect = (token, cookie, requestOrigin = origin) => new Promise(resolve => {
    const client = io(origin, { transports: ['websocket'], reconnection: false,
      auth: { token }, extraHeaders: { Origin: requestOrigin, ...(cookie ? { Cookie: cookie } : {}) } })
    clients.push(client)
    client.on('connect', () => resolve({ client }))
    client.on('connect_error', error => { client.disconnect(); resolve({ error }) })
  })
  return { origin, revoked, request, login, create, connect }
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
  const f = await fixture(t, { roomDurationMs: 1500 })
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
  assert.equal((await f.request('/api/rooms', { cookie, method: 'POST' })).status, 429)
  for (let index = 0; index < 19; index++) await f.request('/api/login', { method: 'POST', data: { username: 'admin', password: 'bad' } })
  assert.equal((await f.request('/api/login', { method: 'POST', data: { username: 'admin', password: 'bad' } })).status, 429)
})

test('Invalid public origins and ICE configurations fail explicitly at startup', () => {
  assert.throws(() => createVideoServer({ origin: 'http://public.invalid' }), /HTTPS/)
  assert.throws(() => createVideoServer({ iceServers: [{ urls: 'https://invalid' }] }), /STUN\/TURN/)
  assert.throws(() => createVideoServer({ iceServers: [{ urls: 'turn:example.invalid:3478' }] }), /STUN\/TURN/)
})
