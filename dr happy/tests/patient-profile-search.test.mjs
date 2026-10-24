import assert from 'node:assert/strict'
import test from 'node:test'
import vm from 'node:vm'
import { readFile } from 'node:fs/promises'
import ts from 'typescript'
import { GlucoseInputError } from '../supabase/functions/_shared/patientGlucose.ts'

const source = (await readFile(new URL('../supabase/functions/patient-folder/index.ts', import.meta.url), 'utf8')).replace(/^import .*$/gm, '')
const js = ts.transpile(source, { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None })
function fixture() {
  const patient = { id: 'patient-owner', email: 'patient@example.invalid', full_name: 'Paciente Prueba', first_name: 'Paciente', last_name: 'Prueba',
    dni: '12345678', active: true, email_verified_at: '2026-10-24', health_insurance: 'Anterior', insurance_member_number: '001',
    storage_used_bytes: 0, storage_quota_bytes: 1000 }
  const state = { fail: false, doctor: { id: 'doctor', full_name: 'María Gómez', specialty: 'Clínica', email: 'private@example.invalid', active: true } }
  const patches = [], rpcCalls = []
  let handler
  const admin = {
    from(table) {
      const filters = []; let patch
      const q = {
        select() { return q }, update(value) { patch = value; return q },
        eq(key, value) { filters.push([key, value]); return q }, ilike() { return q }, gt() { return q }, is() { return q },
        limit() { return q }, maybeSingle() { return q }, single() { return q },
        then(resolve, reject) {
          if (table === 'patient_accounts' && patch) { patches.push({ patch, filters }); Object.assign(patient, patch) }
          const data = table === 'patient_sessions' ? { patient_id: patient.id } : table === 'patient_accounts' ? patient
            : table === 'professionals' ? state.doctor : table === 'patient_invite_links' ? { professional_id: 'doctor' } : null
          return Promise.resolve({ data, error: null }).then(resolve, reject)
        },
      }; return q
    },
    async rpc(name, args) {
      rpcCalls.push({ name, args })
      return state.fail ? { error: { message: 'Fixture DB unavailable' } } : { data: Array.from({ length: 11 }, (_, i) => ({ id: `d-${i}`, full_name: 'María Gómez', specialty: 'Clínica' })), error: null }
    },
  }
  vm.runInNewContext(js, { serve: fn => { handler = fn }, createClient: () => admin, baseCorsHeaders: {},
    Deno: { env: { get: () => 'fixture' } }, Response, crypto, TextEncoder, GlucoseInputError, console: { error() {} } })
  async function call(body, token = true) {
    const response = await handler(new Request('https://fixture.invalid', { method: 'POST',
      headers: token ? { 'x-drhappy-patient-session': 'fixture' } : {}, body: JSON.stringify(body) }))
    return { status: response.status, body: await response.json() }
  }
  return { state, patient, patches, rpcCalls, call }
}
test('name lookup requires patient session, validates query and returns bounded identifying results without emails', async () => {
  const h = fixture()
  assert.equal((await h.call({ action: 'search-doctors', query: 'Gom' }, false)).status, 401)
  for (const query of ['', 'G', '%%', 'x'.repeat(121)]) assert.equal((await h.call({ action: 'search-doctors', query })).status, 400)
  assert.equal(h.rpcCalls.length, 0)
  const result = await h.call({ action: 'search-doctors', query: 'Góme María' })
  assert.equal(result.status, 200); assert.equal(result.body.doctors.length, 10); assert.equal(result.body.hasMoreDoctors, true)
  assert.equal(h.rpcCalls[0].name, 'search_patient_professionals')
  assert.equal(h.rpcCalls[0].args.p_query, 'Góme María')
  assert.deepEqual(Object.keys(result.body.doctors[0]), ['id', 'name', 'specialty'])
  assert.equal(h.patches.length, 0, 'Searching grants no permission')
  h.state.fail = true
  assert.equal((await h.call({ action: 'search-doctors', query: 'Gom' })).status, 500)
})
test('existing email/link lookups are supported and inactive doctors are excluded', async () => {
  const h = fixture()
  for (const query of ['doctor@example.invalid', 'https://www.drhappy.com.ar/registro/test-link']) {
    const result = await h.call({ action: 'search-doctors', query })
    assert.equal(result.status, 200)
    assert.equal(result.body.doctors[0].id, 'doctor')
    assert.equal(JSON.stringify(result.body).includes('private@example.invalid'), false)
  }
  h.state.doctor.active = false
  assert.equal((await h.call({ action: 'search-doctors', query: 'doctor@example.invalid' })).body.doctors.length, 0)
  assert.equal(h.rpcCalls.length, 0)
})
test('insurance fields persist only on session owner, retain leading zeros, support clearing and old-client omission', async () => {
  const h = fixture()
  const body = { action: 'update-profile', firstName: 'Paciente', lastName: 'Prueba', phone: '', birthDate: '', patientId: 'forged' }
  assert.equal((await h.call(body, false)).status, 401)
  const saved = await h.call({ ...body, healthInsurance: ' OSDE ', insuranceMemberNumber: ' 000123/45-A ' })
  assert.equal(saved.status, 200)
  assert.equal(saved.body.patient.healthInsurance, 'OSDE')
  assert.equal(saved.body.patient.insuranceMemberNumber, '000123/45-A')
  assert.ok(h.patches.some(({ filters }) => filters.some(([key, value]) => key === 'id' && value === 'patient-owner')))
  const reread = await h.call({ action: 'me' })
  assert.equal(reread.body.patient.insuranceMemberNumber, '000123/45-A')
  assert.equal((await h.call(body)).body.patient.healthInsurance, 'OSDE', 'Old clients do not erase coverage')
  assert.equal((await h.call({ ...body, healthInsurance: '', insuranceMemberNumber: '' })).body.patient.healthInsurance, null)
  for (const fields of [{ healthInsurance: 12 }, { insuranceMemberNumber: ['12'] }, { healthInsurance: 'x'.repeat(121) },
    { insuranceMemberNumber: 'x'.repeat(81) }, { healthInsurance: 'bad\nvalue' }]) {
    assert.equal((await h.call({ ...body, ...fields })).status, 400)
  }
})
