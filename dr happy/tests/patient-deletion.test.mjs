import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import vm from 'node:vm'
import test from 'node:test'
import ts from 'typescript'

const patientId = '11111111-2222-4333-8444-555555555555'
const source = await readFile(new URL('../supabase/functions/patient-account-admin/index.ts', import.meta.url), 'utf8')
const js = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText
function fixture() {
  const state = { session: true, isAdmin: true, conversionFail: false, smtpFail: false, storageFail: false, sends: [], removed: [], deleted: false }
  const db = {
    professionals: [{ is_admin: true, active: true }],
    patient_accounts: [{ id: patientId, email: 'patient@example.invalid', email_verified_at: 'verified' }],
    patient_account_exports: [],
    patient_account_export_files: [],
    patient_documents: [{ id: 'doc', patient_id: patientId, status: 'ready', deleted_at: null }],
  }
  function from(table) {
    let patch, head = false
    const filters = []
    const query = {
      select(_c, options) { head = options?.head; return query },
      eq(key, value) { if (table !== 'professionals') filters.push(r => r[key] === value); return query },
      is(key, value) { filters.push(r => r[key] === value); return query },
      maybeSingle() { return query },
      update(value) { patch = value; return query },
      or() { filters.push(r => ['failed', 'uncertain'].includes(r.status)); return query },
      then(resolve, reject) {
        try {
          const rows = db[table].filter(r => filters.every(f => f(r)))
          if (patch) rows.forEach(r => Object.assign(r, patch))
          return Promise.resolve({ data: head ? null : table === 'patient_account_export_files' ? rows : rows[0] ?? null, count: rows.length, error: null }).then(resolve, reject)
        } catch (error) { return Promise.reject(error).then(resolve, reject) }
      },
    }
    return query
  }
  const admin = { from, rpc: async (name, args) => {
    if (name === 'prepare_patient_account_deletion') {
      assert.equal(args.p_actor, 'server-admin')
      assert.equal(args.p_email, 'patient@example.invalid')
      if (!db.patient_account_exports.length) {
        db.patient_account_exports.push({ id: 'export', patient_id: patientId, email: 'patient@example.invalid' })
        db.patient_account_export_files.push({ id: 'file', export_id: 'export', file_path: `${patientId}/doc.pdf`, title: 'Fixture', mime_type: 'application/pdf', status: 'pending' })
      }
      return { data: 'export', error: null }
    }
    if (name === 'claim_patient_export_file') {
      const row = db.patient_account_export_files.find(r => r.status === 'pending')
      if (row) row.status = 'sending'
      return { data: row ? [row] : [], error: null }
    }
    assert.equal(name, 'finish_patient_account_deletion')
    assert.ok(db.patient_account_export_files.every(r => r.status === 'sent'))
    state.deleted = true
    return { error: null }
  }, storage: { from(bucket) {
    assert.equal(bucket, 'patient-folders')
    return {
      download: async file => { assert.ok(file.startsWith(`${patientId}/`)); return { data: new Blob(['%PDF-fixture']), error: null } },
      list: async prefix => { assert.equal(prefix, patientId); return { data: state.removed.length ? [] : [{ id: 'object', name: 'doc.pdf' }], error: null } },
      remove: async files => { if (state.storageFail) return { error: new Error('Storage unavailable') }; state.removed.push(...files); return { error: null } },
    }
  } } }
  let handler
  vm.runInNewContext(js, {
    exports: {}, Response, Request, URL, Blob, Uint8Array, TextEncoder, AbortSignal, console: { error() {} },
    Deno: { env: { get: name => name === 'SUPABASE_URL' ? 'https://fixture.invalid' : 'key' } },
    require: name => name.includes('server.ts') ? { serve: h => { handler = h } } : name.includes('supabase-js') ? { createClient: () => admin }
      : name.includes('professionalSession') ? { resolveProfessionalId: async () => state.session ? 'server-admin' : null }
        : name.includes('cors') ? { corsHeaders: {} } : {
          patientBackupPdf: async bytes => { if (state.conversionFail) throw new Error('Invalid document'); return bytes },
          pdfBase64: bytes => Buffer.from(bytes).toString('base64'), backupPdfFilename: () => 'fixture.pdf',
        },
    fetch: async (url, init) => {
      assert.equal(url, 'https://fixture.invalid/functions/v1/send-email')
      const body = JSON.parse(init.body); state.sends.push(body)
      if (state.smtpFail) throw new Error('SMTP timeout')
      return Response.json({ success: true, accepted: [body.to], rejected: [] })
    },
  })
  async function call(action, overrides = {}) {
    db.professionals[0].is_admin = state.isAdmin
    const response = await handler(new Request('https://fixture.invalid', { method: 'POST', body: JSON.stringify({
      action, patientId, confirmEmail: 'patient@example.invalid', confirmPermanent: true, ...overrides,
    }) }))
    return { status: response.status, body: await response.json() }
  }
  return { state, db, call }
}
test('Patient deletion requires a real admin, patient ID, exact email and explicit confirmation', async () => {
  const f = fixture()
  f.state.session = false
  assert.equal((await f.call('prepare', { requesterId: 'forged-admin' })).status, 401)
  f.state.session = true; f.state.isAdmin = false
  assert.equal((await f.call('prepare')).status, 403)
  f.state.isAdmin = true
  assert.equal((await f.call('prepare', { patientId: 'bad' })).status, 400)
  assert.equal((await f.call('prepare', { confirmEmail: 'another@example.invalid' })).status, 400)
  assert.equal((await f.call('prepare', { confirmPermanent: false })).status, 400)
  assert.equal(f.state.sends.length, 0)
})
test('Backup uses fixed verified patient address, real PDF attachments and never deletes before receipt confirmation', async () => {
  const f = fixture()
  await f.call('prepare')
  assert.equal((await f.call('delete', { receiptConfirmed: true })).status, 409)
  await f.call('send-next', { to: 'attacker@example.invalid' })
  assert.equal(f.state.sends.length, 1)
  assert.equal(f.state.sends[0].to, 'patient@example.invalid')
  assert.equal(f.state.sends[0].attachments[0].contentType, 'application/pdf')
  assert.equal(Buffer.from(f.state.sends[0].attachments[0].content, 'base64').toString(), '%PDF-fixture')
  await f.call('send-next')
  assert.equal(f.state.sends.length, 1)
  assert.equal((await f.call('delete')).status, 409)
  assert.equal(f.state.removed.length, 0)
  assert.equal((await f.call('delete', { receiptConfirmed: true })).body.deleted, false)
  assert.deepEqual(f.state.removed, [`${patientId}/doc.pdf`])
  assert.equal((await f.call('delete', { receiptConfirmed: true })).body.deleted, true)
})
test('Unverified destinations, failed conversion and uncertain mail block deletion without removing originals', async () => {
  const u = fixture(); u.db.patient_accounts[0].email_verified_at = null
  assert.equal((await u.call('prepare')).status, 409)
  assert.equal(u.db.patient_account_exports.length, 0)
  for (const failure of ['conversionFail', 'smtpFail']) {
    const f = fixture(); await f.call('prepare'); f.state[failure] = true
    assert.equal((await f.call('send-next')).status, 409)
    assert.equal((await f.call('delete', { receiptConfirmed: true })).status, 409)
    assert.equal(f.state.deleted, false); assert.equal(f.state.removed.length, 0)
    f.state[failure] = false
    await f.call('send-next')
    assert.equal(f.state.sends.length, failure === 'smtpFail' ? 1 : 0, 'Failures cannot resend without explicit retry')
    assert.equal((await f.call('retry')).status, 400)
    await f.call('retry', { acceptDuplicateRisk: true })
    await f.call('send-next')
    assert.equal(f.db.patient_account_export_files[0].status, 'sent')
  }
})
test('Storage errors retain the account and scope cleanup to the exact patient prefix', async () => {
  const f = fixture(); await f.call('prepare'); await f.call('send-next')
  f.state.storageFail = true
  assert.equal((await f.call('delete', { receiptConfirmed: true })).status, 500)
  assert.equal(f.state.deleted, false)
  assert.equal(f.state.removed.length, 0)
})
test('Concurrent send requests claim a PDF once and confirmed PDFs are not retried', async () => {
  const f = fixture(); await f.call('prepare')
  await Promise.all([f.call('send-next'), f.call('send-next')])
  assert.equal(f.state.sends.length, 1)
  await f.call('retry', { acceptDuplicateRisk: true })
  await f.call('send-next')
  assert.equal(f.state.sends.length, 1)
})
