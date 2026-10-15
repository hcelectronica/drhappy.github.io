import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import vm from 'node:vm'
import ts from 'typescript'
import { patientRegistrationEmail, sendPatientRegistrationNotice } from '../supabase/functions/_shared/patientRegistrationEmail.ts'

test('patient notice uses fixed administrator recipient, escaped identity and no health or authentication data', () => {
  const mail = patientRegistrationEmail({
    full_name: '<Paciente>', email: 'fixture@example.invalid',
    dni: '99123456', password_hash: 'private-hash', systolic: 190,
  })
  assert.equal(mail.to, 'alan.moodie@hotmail.com')
  assert.match(mail.subject, /Nuevo paciente/)
  assert.match(mail.templateData.message, /&lt;Paciente&gt;/)
  assert.doesNotMatch(JSON.stringify(mail), /99123456|private-hash|190/)
})

function noticeClient() {
  const state = { status: 'pending', attempts: 0, sends: 0 }
  return {
    state,
    from(table) {
      let patch, claim = false
      const query = {
        update(value) { patch = value; return query },
        eq() { return query }, or() { claim = true; return query }, select() { return query },
        maybeSingle() { return query }, single() { return query },
        then(resolve) {
          if (table === 'patient_accounts') return Promise.resolve({ data: { full_name: 'Fixture', email: 'fixture@example.invalid', email_verified_at: '2026-10-15' }, error: null }).then(resolve)
          if (claim) {
            if (state.status === 'sent' || state.status === 'sending') return Promise.resolve({ data: null, error: null }).then(resolve)
            state.status = 'sending'
            return Promise.resolve({ data: { patient_id: 'fixture', attempts: state.attempts }, error: null }).then(resolve)
          }
          Object.assign(state, patch)
          return Promise.resolve({ error: null }).then(resolve)
        },
      }
      return query
    },
  }
}

test('confirmed mail is persisted once and not resent', async () => {
  const admin = noticeClient()
  const send = async () => { admin.state.sends++; return new Response('{"success":true}') }
  assert.equal(await sendPatientRegistrationNotice(admin, 'https://example.invalid', 'key', 'fixture', send), true)
  assert.equal(admin.state.status, 'sent')
  assert.equal(await sendPatientRegistrationNotice(admin, 'https://example.invalid', 'key', 'fixture', send), false)
  assert.equal(admin.state.sends, 1)
})

test('SMTP failure remains retryable and is never reported as delivered', async () => {
  const admin = noticeClient()
  const original = console.error
  const errors = []
  console.error = (...args) => errors.push(args)
  try {
    assert.equal(await sendPatientRegistrationNotice(admin, 'https://example.invalid', 'key', 'fixture', async () => new Response('{"success":false}')), false)
    assert.equal(admin.state.status, 'failed')
    assert.equal(admin.state.attempts, 1)
    assert.equal(errors.length, 1)
    assert.equal(await sendPatientRegistrationNotice(admin, 'https://example.invalid', 'key', 'fixture', async () => new Response('{"success":true}')), true)
    assert.equal(admin.state.attempts, 2)
  } finally { console.error = original }
})

async function statsHandler({ session = true, isAdmin = true, action = 'patient-stats', page = 0 } = {}) {
  let callback
  const calls = []
  const source = (await readFile(new URL('../supabase/functions/admin-stats/index.ts', import.meta.url), 'utf8')).replace(/^import .*$/gm, '')
  const admin = {
    from(table) {
      calls.push(table)
      const query = { select() { return query }, eq() { return query }, maybeSingle: async () => ({ data: { id: 'server-admin', is_admin: isAdmin }, error: null }) }
      return query
    },
    rpc: async (name, args) => { calls.push({ name, args }); return { data: { summary: { total: 1005 } }, error: null } },
  }
  vm.runInNewContext(ts.transpile(source, { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None }), {
    serve: fn => { callback = fn }, createClient: () => admin, corsHeaders: {},
    resolveProfessionalId: async () => session ? 'server-admin' : null,
    Deno: { env: { get: () => 'fixture' } }, Response, console,
  })
  const response = await callback(new Request('https://example.invalid', {
    method: 'POST', body: JSON.stringify({ action, page, requesterId: 'forged-id' }),
  }))
  return { status: response.status, body: await response.json(), calls }
}

test('patient statistics and mail retry are protected by actual administrator session', async () => {
  for (const action of ['patient-stats', 'patient-notice-retry']) {
    const missing = await statsHandler({ session: false, action })
    assert.equal(missing.status, 401)
    assert.equal(missing.calls.length, 0)
    const professional = await statsHandler({ isAdmin: false, action })
    assert.equal(professional.status, 403)
    assert.deepEqual(professional.calls, ['professionals'])
  }
})

test('admin statistics uses server aggregate and validated pagination', async () => {
  const result = await statsHandler({ page: 2 })
  assert.equal(result.status, 200)
  assert.equal(result.body.stats.summary.total, 1005)
  assert.equal(result.calls[1].name, 'patient_admin_stats')
  assert.equal(result.calls[1].args.p_page, 2)
  for (const page of [-1, 1.5, '1', 100001]) {
    const invalid = await statsHandler({ page })
    assert.equal(invalid.status, 400)
    assert.equal(invalid.calls.length, 1)
  }
})

test('telemetry is limited to nonclinical events, authenticated patient ID and visibility', async () => {
  const endpoint = await readFile(new URL('../supabase/functions/patient-folder/index.ts', import.meta.url), 'utf8')
  const portal = await readFile(new URL('../src/PatientPortal.tsx', import.meta.url), 'utf8')
  const activity = await readFile(new URL('../src/patientActivity.ts', import.meta.url), 'utf8')
  assert.ok(endpoint.indexOf("if (action === 'activity')") > endpoint.indexOf('const patient = await resolveSession()'))
  assert.match(endpoint, /p_patient_id: patient.id/)
  assert.match(portal, /document.visibilityState === 'visible'/)
  assert.match(portal, /clearInterval\(timer\)/)
  assert.doesNotMatch(activity, /dni|systolic|diastolic|score|answer|fullName/)
})

async function patientHandler(action, { verified = false, validCode = true, token = true, event = 'heartbeat', feature, mailFailure = false } = {}) {
  const patient = {
    id: 'server-patient', email: 'fixture@example.invalid', full_name: 'Fixture', active: true,
    email_verified_at: verified ? '2026-10-15' : null, password_hash: 'hash', dni: '00000000',
    storage_used_bytes: 0, storage_quota_bytes: 52428800, failed_login_count: 0,
  }
  const hash = Buffer.from(await crypto.subtle.digest('SHA-256', new TextEncoder().encode('patient-code:verify:server-patient:123456:fixture'))).toString('hex')
  const calls = [], notices = []
  let callback
  const admin = {
    from(table) {
      let patch, conditionalVerify = false
      const query = {
        select() { return query }, ilike() { return query }, limit() { return query },
        eq() { return query }, gt() { return query }, order() { return query },
        is(key) { if (key === 'email_verified_at') conditionalVerify = true; return query },
        insert() { return query }, update(value) { patch = value; return query },
        maybeSingle() { return query }, single() { return query },
        then(resolve) {
          let data = null
          if (table === 'patient_accounts') {
            if (conditionalVerify && patch) {
              if (!patient.email_verified_at) { Object.assign(patient, patch); data = { id: patient.id } }
            } else data = patient
          }
          if (table === 'patient_sessions' && !patch) data = { patient_id: patient.id }
          if (table === 'patient_email_codes') data = { id: 'code', code_hash: validCode ? hash : 'incorrect', attempts: 0, expires_at: new Date(Date.now() + 600000).toISOString() }
          return Promise.resolve({ data, error: null }).then(resolve)
        },
      }
      return query
    },
    rpc: async (name, args) => { calls.push({ name, args }); return { error: null } },
  }
  const source = (await readFile(new URL('../supabase/functions/patient-folder/index.ts', import.meta.url), 'utf8')).replace(/^import .*$/gm, '')
  vm.runInNewContext(ts.transpile(source, { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None }), {
    serve: fn => { callback = fn }, createClient: () => admin, baseCorsHeaders: {},
    sendPatientRegistrationNotice: async (...args) => { notices.push(args); return !mailFailure },
    bcrypt: { compare: async () => true },
    Deno: { env: { get: () => 'fixture' } }, Response, console, crypto, TextEncoder, Uint8Array,
  })
  const response = await callback(new Request('https://example.invalid', {
    method: 'POST', headers: token ? { 'x-drhappy-patient-session': 'fixture-token' } : {},
    body: JSON.stringify({ action, email: patient.email, code: '123456', password: 'fixture', event, feature, patientId: 'forged-patient' }),
  }))
  return { status: response.status, body: await response.json(), calls, notices }
}

test('verified registration notifies; invalid code, existing account and normal login do not', async () => {
  const verified = await patientHandler('verify')
  assert.equal(verified.status, 200, JSON.stringify(verified.body))
  assert.equal(verified.notices.length, 1)
  assert.equal(verified.notices[0][3], 'server-patient')
  const failedMail = await patientHandler('verify', { mailFailure: true })
  assert.equal(failedMail.body.success, true)
  assert.equal(failedMail.body.adminEmailSent, false)
  for (const result of [
    await patientHandler('verify', { validCode: false }),
    await patientHandler('verify', { verified: true }),
    await patientHandler('login', { verified: true }),
  ]) assert.equal(result.notices.length, 0)
})

test('activity resolves its owner from session, rejects unknown features and requires login', async () => {
  const valid = await patientHandler('activity', { verified: true, event: 'view', feature: 'memory' })
  assert.equal(valid.status, 200, JSON.stringify(valid.body))
  assert.equal(valid.calls[0].args.p_patient_id, 'server-patient')
  assert.equal(valid.calls[0].args.p_feature, 'memory')
  const missing = await patientHandler('activity', { token: false })
  assert.equal(missing.status, 401)
  assert.equal(missing.calls.length, 0)
  for (const options of [{ event: 'view', feature: 'diagnosis' }, { event: 'private-info' }]) {
    const invalid = await patientHandler('activity', { verified: true, ...options })
    assert.equal(invalid.status, 400)
    assert.equal(invalid.calls.length, 0)
  }
})
