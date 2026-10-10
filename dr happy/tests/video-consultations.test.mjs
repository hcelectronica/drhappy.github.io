import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import vm from 'node:vm'
import ts from 'typescript'
import { webcrypto } from 'node:crypto'
import { hasMedicalToolRowAccess, MEDICAL_TOOL_ACCESS_COLUMNS } from '../supabase/functions/_shared/medicalToolAccess.ts'

async function fixture(options = {}) {
  let callback
  const calls = []
  const patients = [{ id: 'p1', ownerUserId: 'owner', nombre: 'Rodolfo', apellido: 'Perez' }, { id: 'p2', ownerUserId: 'another', nombre: 'Ajeno' }]
  const admin = {
    from(table) {
      let inserted
      const query = {
        select() { return query }, eq() { return query }, neq() { return query }, maybeSingle() { return query }, single() { return query },
        insert(value) { inserted = value; return query },
        then(resolve, reject) {
          calls.push({ table, inserted })
          const data = table === 'professionals' ? { is_admin: !options.nonAdmin, active: !options.inactive, ...options.professional }
            : table === 'user_workspaces' ? { patients_json: patients, appointments_json: [{ id: 'a1', patientId: 'p1', scheduledDate: '2026-10-06', scheduledTime: '10:00' }] }
              : table === 'dental_patient_archives' ? (options.archived ? [{ patient_id: 'p1' }] : []) : { id: 'consultation-id' }
          return Promise.resolve({ data, error: options.databaseFailure ? new Error('Unavailable') : null }).then(resolve, reject)
        },
      }
      return query
    },
    async rpc(name, value) { calls.push({ name, value }); return { data: options.invalidLifecycle ? false : true, error: null } },
  }
  const source = (await readFile(new URL('../supabase/functions/video-consultations/index.ts', import.meta.url), 'utf8')).replace(/^import .*$/gm, '')
  vm.runInNewContext(ts.transpile(source, { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None }), {
    Deno: { serve: value => { callback = value }, env: { get: () => 'fixture' } },
    serve: value => { callback = value },
    createClient: () => admin, resolveProfessionalId: async () => options.noSession ? null : 'owner',
    crypto: webcrypto, TextEncoder, corsHeaders: {}, Response, console: { error() {} },
    hasMedicalToolRowAccess, MEDICAL_TOOL_ACCESS_COLUMNS,
  })
  return { calls, async request(body) {
    const response = await callback(new Request('https://example.invalid', { method: 'POST', body: JSON.stringify(body) }))
    return { status: response.status, data: await response.json() }
  } }
}

test('Patient list is authenticated, administrative and excludes another owner and clinical details', async () => {
  for (const options of [{ noSession: true }, { nonAdmin: true }, { inactive: true }]) {
    const f = await fixture(options)
    assert([401, 403].includes((await f.request({ action: 'list' })).status))
  }
  const result = await (await fixture()).request({ action: 'list' })
  assert.equal(result.status, 200)
  assert.deepEqual(result.data.patients, [{ id: 'p1', name: 'Perez, Rodolfo' }])
  assert.deepEqual(result.data.appointments, [{ id: 'a1', patientId: 'p1', label: '2026-10-06 10:00' }])
})

test('Creation validates patient ownership and appointment pairing and stores only hashed lifecycle secret', async () => {
  const f = await fixture()
  for (const input of [
    { patientId: 'p2' }, { patientId: 'p1', appointmentId: 'foreign' },
    { patientId: '<p>' }, { patientId: 'p1', durationMinutes: 121 },
  ]) {
    const result = await f.request({ action: 'create', durationMinutes: 40, ...input })
    assert([400, 403].includes(result.status))
  }
  const result = await f.request({ action: 'create', patientId: 'p1', appointmentId: 'a1', durationMinutes: 40 })
  assert.equal(result.status, 201)
  assert.match(result.data.lifecycleToken, /^[a-f0-9]{64}$/)
  const inserted = f.calls.find(call => call.table === 'video_consultations').inserted
  assert.equal(inserted.professional_id, 'owner')
  assert.equal(inserted.patient_id, 'p1')
  assert.equal(inserted.appointment_id, 'a1')
  assert.match(inserted.lifecycle_hash, /^[a-f0-9]{64}$/)
  assert.notEqual(inserted.lifecycle_hash, result.data.lifecycleToken)
})

test('Lifecycle is restricted to a server-held 256-bit capability and validated event types', async () => {
  const f = await fixture({ noSession: true })
  for (const body of [{ lifecycleToken: 'bad', event: 'start' }, { lifecycleToken: 'a'.repeat(64), event: 'record-audio' }]) {
    assert.equal((await f.request({ action: 'event', ...body })).status, 400)
  }
  assert.equal((await f.request({ action: 'event', lifecycleToken: 'a'.repeat(64), event: 'start' })).status, 200)
  assert.equal(f.calls[0].name, 'advance_video_consultation')
  assert.notEqual(f.calls[0].value.p_lifecycle_hash, 'a'.repeat(64))
  assert.equal((await (await fixture({ invalidLifecycle: true })).request({ action: 'event', lifecycleToken: 'a'.repeat(64), event: 'start' })).status, 409)
})

test('Database failure is explicit instead of returning a successful empty patient list', async () => {
  assert.equal((await (await fixture({ databaseFailure: true })).request({ action: 'list' })).status, 503)
})

test('Archived patients cannot be listed or linked to a new consultation', async () => {
  const f = await fixture({ archived: true })
  const list = await f.request({ action: 'list' })
  assert.deepEqual(list.data.patients, [])
  assert.deepEqual(list.data.appointments, [])
  assert.equal((await f.request({ action: 'create', patientId: 'p1', durationMinutes: 40 })).status, 403)
})

test('trial physician can list and create own consultations; dentist and expired physician cannot', async () => {
  const trial = { is_admin: false, specialty: 'Médico', subscription_status: 'trial', trial_started_at: new Date().toISOString(), enabled_modules_json: ['attention'] }
  const f = await fixture({ professional: trial })
  assert.equal((await f.request({ action: 'list' })).status, 200)
  assert.equal((await f.request({ action: 'create', patientId: 'p1', durationMinutes: 40 })).status, 201)
  for (const professional of [{ ...trial, specialty: 'Odontólogo' }, { ...trial, subscription_status: 'expired' }, { ...trial, enabled_modules_json: [] }]) {
    assert.equal((await (await fixture({ professional })).request({ action: 'list' })).status, 403)
  }
})
