import assert from 'node:assert/strict'
import test from 'node:test'
import vm from 'node:vm'
import { readFileSync } from 'node:fs'
import ts from 'typescript'
import { hasMedicalToolRowAccess, MEDICAL_TOOL_ACCESS_COLUMNS } from '../supabase/functions/_shared/medicalToolAccess.ts'
import { GlucoseInputError } from '../supabase/functions/_shared/patientGlucose.ts'

const load = path => readFileSync(new URL(path, import.meta.url), 'utf8').replace(/^import .*$/gm, '').replace(/^export /gm, '')
const js = ts.transpile(load('../supabase/functions/_shared/patientFolderReferral.ts') + '\n' +
  load('../supabase/functions/patient-folder/index.ts'), { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None })

function fixture() {
  const accounts = {
    one: { id: 'one', active: true, email_verified_at: '2026-10-31', referring_professional_id: null },
    two: { id: 'two', active: true, email_verified_at: '2026-10-31', referring_professional_id: null },
  }
  const doctors = {
    a: { id: 'a', full_name: 'Médico A', active: true, is_admin: true, patient_folder_code: 'aaaaaaaaaa' },
    b: { id: 'b', full_name: 'Médico B', active: true, is_admin: true, patient_folder_code: 'bbbbbbbbbb' },
  }
  const settings = { a: { slug: 'doctor-a', enabled: true }, b: { slug: 'doctor-b', enabled: true } }
  const payments = { a: { status: 'connected' }, b: { status: 'connected' } }
  const state = { account: 'one', fail: null, patches: [] }
  let handler
  const admin = {
    from(table) {
      const filters = new Map()
      let patch
      const q = {
        select() { return q }, eq(k, v) { filters.set(k, v); return q }, gt() { return q }, is() { return q },
        update(value) { patch = value; return q }, maybeSingle() { return q }, single() { return q },
        then(resolve, reject) {
          const id = filters.get('id') || filters.get('professional_id')
            || Object.keys(doctors).find(id => doctors[id].patient_folder_code === filters.get('patient_folder_code'))
          let data = table === 'patient_sessions' ? { patient_id: state.account }
            : table === 'patient_accounts' ? accounts[id]
            : table === 'professionals' ? doctors[id]
            : table === 'virtual_consult_settings' ? settings[id]
            : table === 'professional_payment_accounts' ? payments[id] : null
          if (state.fail === table) return Promise.resolve({ data: null, error: new Error('Fixture database unavailable') }).then(resolve, reject)
          if (patch) { state.patches.push({ table, id, patch }); Object.assign(data, patch) }
          return Promise.resolve({ data, error: null }).then(resolve, reject)
        },
      }
      return q
    },
  }
  vm.runInNewContext(js, {
    serve: fn => { handler = fn }, createClient: () => admin,
    hasMedicalToolRowAccess, MEDICAL_TOOL_ACCESS_COLUMNS,
    GlucoseInputError,
    baseCorsHeaders: {}, Deno: { env: { get: () => 'fixture' } },
    Response, crypto, TextEncoder, console: { error() {} },
  })
  const call = async (professionalId, token = true, folderCode) => {
    const response = await handler(new Request('https://fixture.invalid', { method: 'POST',
      headers: token ? { 'x-drhappy-patient-session': 'fixture' } : {},
      body: JSON.stringify({ action: 'orientation', ...(professionalId !== undefined ? { professionalId } : {}), ...(folderCode !== undefined ? { folderCode } : {}) }) }))
    return { status: response.status, body: await response.json() }
  }
  return { call, accounts, doctors, settings, payments, state }
}

test('personalized links route to their owner; latest opened link persists across sessions and devices', async () => {
  const h = fixture()
  assert.equal((await h.call()).body.orientation, null, 'Generic app has no default doctor')
  assert.equal((await h.call('a')).body.orientation.url, 'https://www.drhappy.com.ar/consulta/doctor-a')
  assert.equal(h.accounts.one.referring_professional_id, 'a')
  assert.equal((await h.call()).body.orientation.professionalId, 'a')
  assert.equal((await h.call('b')).body.orientation.url, 'https://www.drhappy.com.ar/consulta/doctor-b')
  assert.equal((await h.call()).body.orientation.professionalId, 'b')
  assert.equal((await h.call()).body.orientation.shareUrl, 'https://www.drhappy.com.ar/s/bbbbbbbbbb')
  h.state.account = 'two'
  assert.equal((await h.call()).body.orientation, null, 'No cross-account attribution')
  assert.ok(h.state.patches.every(p => p.table === 'patient_accounts' && Object.keys(p.patch).join() === 'referring_professional_id'), 'No document access or payment mutation')
})

test('short codes resolve the right doctor and retain compatibility with old links', async () => {
  const h = fixture()
  assert.equal((await h.call(undefined, true, 'aaaaaaaaaa')).body.orientation.professionalId, 'a')
  assert.equal((await h.call(undefined, true, 'bbbbbbbbbb')).body.orientation.professionalId, 'b')
  assert.equal((await h.call(undefined, true, 'cccccccccc')).status, 404)
  for (const code of ['', '../a', '123', null]) assert.equal((await h.call(undefined, true, code)).status, 400)
  assert.equal((await h.call('a', true, 'bbbbbbbbbb')).status, 400)
  assert.equal(h.accounts.one.referring_professional_id, 'b')
  assert.equal((await h.call('a')).body.orientation.shareUrl, 'https://www.drhappy.com.ar/s/aaaaaaaaaa')
})

test('invalid links, unauthenticated requests and database errors never switch to another doctor', async () => {
  const h = fixture()
  assert.equal((await h.call('a', false)).status, 401)
  for (const id of ['', '../a', 'https://evil.invalid', null, 'x'.repeat(121)]) assert.equal((await h.call(id)).status, 400)
  assert.equal((await h.call('missing')).status, 404)
  await h.call('a')
  h.doctors.b.active = false
  assert.equal((await h.call('b')).status, 404)
  assert.equal(h.accounts.one.referring_professional_id, 'a')
  h.state.fail = 'virtual_consult_settings'
  assert.equal((await h.call('a')).status, 500)
})

test('paused, unpaid or expired professionals retain attribution without offering a broken checkout', async () => {
  const h = fixture()
  await h.call('a')
  h.settings.a.enabled = false
  assert.equal((await h.call()).body.orientation.url, null)
  h.settings.a.enabled = true
  h.payments.a.status = 'disconnected'
  assert.equal((await h.call()).body.orientation.url, null)
  h.payments.a.status = 'connected'
  h.doctors.a.is_admin = false
  assert.equal((await h.call()).body.orientation.url, null)
  h.doctors.a.active = false
  assert.equal((await h.call()).body.orientation, null)
  assert.equal(h.accounts.one.referring_professional_id, 'a')
})
