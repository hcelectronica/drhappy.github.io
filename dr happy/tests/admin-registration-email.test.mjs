import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import vm from 'node:vm'
import ts from 'typescript'
import { adminRegistrationEmail, notifyAdminRegistration } from '../supabase/functions/_shared/adminRegistrationEmail.ts'

const professional = { id: 'demo-id', username: 'demo', full_name: '<Profesional Demo>', email: 'demo@example.invalid', specialty: 'Odontología', license_number: 'DEMO' }

test('notice has fixed admin recipient, escaped content and no credentials or DNI', () => {
  const mail = adminRegistrationEmail({ ...professional, password: 'secret', dni: '12345678' }, 'google')
  assert.equal(mail.to, 'alan.moodie@hotmail.com')
  assert.match(mail.text, /Google \(cuenta nueva\)/)
  assert.match(mail.templateData.message, /&lt;Profesional Demo&gt;/)
  assert.doesNotMatch(JSON.stringify(mail), /secret|12345678/)
  assert.match(adminRegistrationEmail(professional, 'email-verification').text, /pendiente/)
})

test('delivery checks HTTP and success, reports failures without losing registration', async () => {
  assert.equal(await notifyAdminRegistration('https://example.invalid', 'key', professional, 'form', async (_, request) => {
    assert.equal(JSON.parse(request.body).to, 'alan.moodie@hotmail.com')
    return new Response('{"success":true}')
  }), true)
  const original = console.error, errors = []
  console.error = (...args) => errors.push(args)
  try {
    for (const send of [async () => new Response('{"success":false}'), async () => new Response('{"success":true}', { status: 500 }), async () => { throw new Error('SMTP unavailable') }]) {
      assert.equal(await notifyAdminRegistration('https://example.invalid', 'key', professional, 'form', send), false)
    }
    assert.equal(errors.length, 3)
  } finally { console.error = original }
})

async function handler(name, options = {}) {
  let callback, writes = 0
  const notices = []
  const admin = {
    from() {
      let inserting = false
      const q = {
        select() { return q }, ilike() { return q }, eq() { return q }, limit() { return q },
        insert() { inserting = true; writes++; return q },
        single() { return q }, maybeSingle() { return q },
        then(resolve) { return Promise.resolve({ data: inserting ? professional : options.existing ? professional : null, error: inserting && options.insertError ? { message: 'Insert failed' } : null }).then(resolve) },
      }
      return q
    },
    rpc: async () => { writes++; return { data: options.insertError ? null : professional.id, error: options.insertError ? { message: 'Insert failed' } : null } },
    auth: { getUser: async () => ({ data: { user: { email: professional.email, user_metadata: { full_name: professional.full_name } } }, error: null }) },
  }
  const source = (await readFile(new URL(`../supabase/functions/${name}/index.ts`, import.meta.url), 'utf8')).replace(/^import .*$/gm, '')
  vm.runInNewContext(ts.transpile(source, { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None }), {
    serve: fn => { callback = fn }, createClient: () => admin, bcrypt: { hash: async () => 'hash' },
    createProfessionalSession: async () => 'session', hasVerifiedGoogleEmail: () => true,
    notifyAdminRegistration: async (...args) => { notices.push(args); return !options.mailFailure },
    Deno: { env: { get: key => key === 'ENABLE_EMAIL_VERIFICATION' ? String(name === 'auth-email-verification') : 'test-key' } },
    fetch: async () => new Response('{"success":true}'), corsHeaders: {}, crypto, TextEncoder,
    Request, Response, console, btoa, Uint8Array, AbortSignal,
  })
  const response = await callback(new Request('https://example.invalid', { method: 'POST', body: JSON.stringify({
    action: options.action || 'register', username: 'demo', password: 'password', fullName: professional.full_name,
    email: professional.email, specialty: professional.specialty, licenseNumber: 'DEMO', accessToken: 'google-token',
  }) }))
  return { status: response.status, body: await response.json(), notices, writes }
}

for (const [name, action, source] of [
  ['auth-professional', 'register', 'form'],
  ['auth-professional', 'google-login', 'google'],
  ['auth-email-verification', 'register', 'email-verification'],
]) {
  test(`${name} ${action} notifies once after successful creation`, async () => {
    const result = await handler(name, { action })
    assert.equal(result.status, 200, JSON.stringify(result.body))
    assert.equal(result.writes, 1)
    assert.equal(result.notices.length, 1)
    assert.equal(result.notices[0][3], source)
    assert.equal(result.body.adminEmailSent, true)
    const failedMail = await handler(name, { action, mailFailure: true })
    assert.equal(failedMail.body.success, true)
    assert.equal(failedMail.body.adminEmailSent, false)
    const failedSave = await handler(name, { action, insertError: true })
    assert.equal(failedSave.notices.length, 0)
    assert.equal(failedSave.body.success, false)
  })
}

test('existing Google logins and duplicate form registrations never notify', async () => {
  for (const action of ['register', 'google-login']) {
    const result = await handler('auth-professional', { action, existing: true })
    assert.equal(result.notices.length, 0)
    assert.equal(result.writes, 0)
  }
})
