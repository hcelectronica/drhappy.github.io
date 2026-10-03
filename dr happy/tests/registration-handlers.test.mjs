import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import vm from 'node:vm'
import ts from 'typescript'
import { notifyProfessionalRegistration } from '../supabase/functions/_shared/professionalRegistrationEmail.ts'

async function handler(name, options = {}) {
  const writes = []
  const mails = []
  const date = new Date(Date.now() + 86400000).toLocaleDateString('en-CA', { timeZone: 'America/Argentina/Buenos_Aires' })
  const keyBytes = crypto.getRandomValues(new Uint8Array(32))
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const key = await crypto.subtle.importKey('raw', keyBytes, 'AES-GCM', false, ['encrypt'])
  const ciphertext = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode('test-token')))
  const encode = (value) => Buffer.from(value).toString('base64')
  const block = { id: 'block', modality: options.paid ? 'private' : 'coverage', days: [0, 1, 2, 3, 4, 5, 6], startTime: '15:00', endTime: '16:00', durationMinutes: 30, slotCount: 2, amountToCharge: options.paid ? 1000 : undefined }
  const admin = {
    from(table) {
      let operation = 'select'
      const query = {
        select() { return query },
        insert(value) { operation = 'insert'; writes.push({ table, value }); return query },
        update(value) { operation = 'update'; writes.push({ table, value }); return query },
        upsert(value) { operation = 'upsert'; writes.push({ table, value }); return query },
        eq() { return query }, gte() { return query }, lte() { return query }, lt() { return query },
        maybeSingle() { return query },
        then(resolve, reject) {
          const records = {
            patient_invite_links: { professional_id: 'professional' },
            professionals: { full_name: 'Profesional de prueba', email: 'professional@example.invalid' },
            user_workspaces: { profile_json: {}, appointments_json: [] },
            public_booking_profiles: { professional_id: 'professional', professional_name: 'Profesional de prueba', slug: 'test', enabled: true, availability_blocks: [block] },
            public_booking_reservations: [],
            public_booking_links: { id: 'link', professional_id: 'professional', slot_date: date, status: 'active', appointment_days: [0, 1, 2, 3, 4, 5, 6] },
            public_booking_slots: { id: 'slot', is_booked: false },
            professional_payment_accounts: { status: 'connected', access_token_encrypted: `${encode(iv)}.${encode(ciphertext)}` },
          }
          const error = options.saveError && operation === 'insert' ? { message: 'Save failed' } : null
          return Promise.resolve({ data: records[table] ?? null, count: options.limit ? 60 : 0, error }).then(resolve, reject)
        },
      }
      return query
    },
  }
  const fetchMock = async (url, request) => {
    if (url.includes('mercadopago.com')) return new Response(JSON.stringify({ id: 'preference', init_point: 'https://example.invalid/pay' }))
    mails.push(JSON.parse(request.body))
    return new Response(JSON.stringify({ success: !options.emailFailure }))
  }
  const errors = []
  let serveHandler
  const source = (await readFile(new URL(`../supabase/functions/${name}/index.ts`, import.meta.url), 'utf8'))
    .replace(/^import .*$/gm, '')
  vm.runInNewContext(ts.transpile(source, { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None }), {
    serve: (callback) => { serveHandler = callback },
    createClient: () => admin,
    corsHeaders: {},
    resolveProfessionalId: async () => null,
    getHolidayName: () => null,
    notifyProfessionalRegistration: (params) => notifyProfessionalRegistration({ ...params, send: fetchMock }),
    Deno: { env: { get: (name) => name === 'MP_TOKEN_ENCRYPTION_KEY' ? encode(keyBytes) : name === 'SUPABASE_URL' ? 'https://example.invalid' : 'test-key' } },
    crypto, Request, Response, fetch: fetchMock, console: { error: (...args) => errors.push(args) },
    TextEncoder, TextDecoder, atob, Date,
  })
  return { request: async (body) => {
    const response = await serveHandler(new Request('https://example.invalid', { method: 'POST', body: JSON.stringify(body) }))
    return { status: response.status, body: await response.json() }
  }, writes, mails, date, errors }
}

test('invitation sends professional notification only after storing a real submission', async () => {
  const h = await handler('patient-invite')
  const result = await h.request({ action: 'submit', token: 'test-link', nombre: 'Paciente', apellido: 'Prueba', dni: '12345678', birthDate: '1990-01-01', phone: '12345678', consent: true })
  assert.equal(result.status, 200)
  assert.equal(result.body.professionalEmailSent, true)
  assert.equal(h.writes.filter((write) => write.table === 'patient_invite_submissions').length, 1)
  assert.equal(h.mails.length, 1)
  assert.equal(h.mails[0].to, 'professional@example.invalid')
  assert.match(h.mails[0].text, /Link de invitar paciente/)
})

test('rejected invitations and honeypot submissions send no mail', async () => {
  for (const options of [{ saveError: true }, { limit: true }, { trap: true }]) {
    const h = await handler('patient-invite', options)
    await h.request({ action: 'submit', token: 'test-link', nombre: 'Paciente', apellido: 'Prueba', dni: '12345678', birthDate: '1990-01-01', phone: '12345678', consent: true, website: options.trap ? 'spam' : '' })
    assert.equal(h.mails.length, 0)
  }
})

test('public free and paid bookings notify professional and preserve patient mail', async () => {
  for (const paid of [false, true]) {
    const h = await handler('public-booking', { paid })
    const result = await h.request({ action: 'book-public-slot', slug: 'test', slotDate: h.date, slotTime: '15:00', blockId: 'block', patientName: 'Prueba, Paciente', patientDni: '12345678', patientEmail: 'patient@example.invalid' })
    assert.equal(result.status, 200, JSON.stringify(result))
    assert.equal(result.body.professionalEmailSent, true)
    assert.equal(result.body.emailSent, true)
    assert.equal(h.mails.length, 2)
    assert.equal(h.mails[0].to, 'professional@example.invalid')
    assert.equal(h.mails[1].to, 'patient@example.invalid')
    assert.match(h.mails[0].text, paid ? /todavía no está confirmado/ : /Turno confirmado/)
  }
})

test('legacy link sends turnera origin; mail failures do not invalidate saved bookings', async () => {
  const h = await handler('public-booking')
  const result = await h.request({ action: 'book-slot', token: 'test-link', slotTime: '15:00', patientName: 'Prueba', patientDni: '12345678' })
  assert.equal(result.status, 200)
  assert.equal(result.body.professionalEmailSent, true)
  assert.match(h.mails[0].text, /Link de turnera/)
  const failed = await handler('public-booking', { emailFailure: true })
  const saved = await failed.request({ action: 'book-public-slot', slug: 'test', slotDate: failed.date, slotTime: '15:00', blockId: 'block', patientName: 'Prueba', patientDni: '12345678', patientEmail: 'patient@example.invalid' })
  assert.equal(saved.status, 200)
  assert.equal(saved.body.success, true)
  assert.equal(saved.body.professionalEmailSent, false)
  assert.equal(saved.body.emailSent, false)
  assert.ok(failed.writes.some((write) => write.table === 'user_workspaces' && write.value.appointments_json?.length === 1))
  assert.ok(failed.errors.length > 0)
})
