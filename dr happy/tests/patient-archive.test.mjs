import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import vm from 'node:vm'
import ts from 'typescript'
import { readPatientArchives } from '../src/patientArchive.ts'

const patient = { id: 'p1', nombre: 'Ana', apellido: 'Test', dni: '12345678', documents: [{ id: 'document' }] }
const archive = { patient_id: 'p1', state: 'archived', patient, archived_at: '2026-10-04T12:00:00Z', confirmed_at: null }

test('archive decoder preserves snapshots and validates state and identity', () => {
  assert.deepEqual(readPatientArchives([archive]), [archive])
  assert.deepEqual(readPatientArchives(undefined), [])
  for (const value of [null, {}, [{ ...archive, state: 'deleted' }], [{ ...archive, patient_id: 'other' }], [{ ...archive, patient: null }]]) {
    assert.throws(() => readPatientArchives(value))
  }
})

async function handler(options = {}) {
  let callback
  const calls = []
  const admin = {
    from(table) {
      const query = {
        select() { return query }, eq() { return query }, neq() { return query }, maybeSingle() { return query },
        then(resolve, reject) {
          const data = table === 'professionals' ? { specialty: options.nonDentist ? 'Clinica' : 'Odontologia' }
            : table === 'dental_patient_archives' ? [archive]
              : { patients_json: [patient, { id: 'p2' }], treatment_ledger_json: [{ id: 'paid', paidAmount: 30 }] }
          return Promise.resolve({ data, error: options.archiveLoadFailure && table === 'dental_patient_archives' ? { message: 'Unavailable' } : null }).then(resolve, reject)
        },
      }
      return query
    },
    async rpc(name, args) {
      calls.push({ name, args })
      return { data: name === 'dental_sync_provisional' ? { patients_json: [patient, { id: 'p2' }], treatment_ledger_json: [{ id: 'paid', paidAmount: 30 }] } : { success: true }, error: options.rpcError || null }
    },
  }
  const source = (await readFile(new URL('../supabase/functions/workspace-data/index.ts', import.meta.url), 'utf8')).replace(/^import .*$/gm, '')
  vm.runInNewContext(ts.transpile(source, { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None }), {
    Deno: { serve: (value) => { callback = value }, env: { get: () => 'test-only' } },
    createClient: () => admin, resolveProfessionalId: async () => options.noSession ? null : 'owner',
    corsHeaders: {}, Response, console: { error() {} },
  })
  return { calls, async request(body) {
    const response = await callback(new Request('https://example.invalid', { method: 'POST', body: JSON.stringify(body) }))
    return { status: response.status, data: await response.json() }
  } }
}

test('workspace hides archived patients but keeps finances and archive snapshots', async () => {
  const h = await handler()
  const result = await h.request({ action: 'load' })
  assert.equal(result.status, 200)
  assert.deepEqual(result.data.workspace.patients_json, [{ id: 'p2' }])
  assert.deepEqual(result.data.workspace.treatment_ledger_json, [{ id: 'paid', paidAmount: 30 }])
  assert.deepEqual(result.data.archivedPatients, [archive])
  assert.equal(h.calls[0].name, 'dental_sync_provisional')
})

test('archive RPC uses session owner and validates all three actions', async () => {
  for (const action of ['archive', 'restore', 'confirm']) {
    const h = await handler()
    const result = await h.request({ action: 'archive-patient', patientId: 'p1', archiveAction: action, professionalId: 'spoofed' })
    assert.equal(result.status, 200)
    assert.deepEqual(JSON.parse(JSON.stringify(h.calls)), [{ name: 'dental_archive_patient', args: { p_professional_id: 'owner', p_patient_id: 'p1', p_action: action } }])
  }
  for (const body of [{ patientId: '', archiveAction: 'archive' }, { patientId: 'p1', archiveAction: 'delete' }]) {
    const h = await handler()
    assert.equal((await h.request({ action: 'archive-patient', ...body })).status, 400)
    assert.equal(h.calls.length, 0)
  }
  const h = await handler({ noSession: true })
  assert.equal((await h.request({ action: 'archive-patient', patientId: 'p1', archiveAction: 'archive' })).status, 401)
})

test('archive failures remain explicit errors, not successful empty workspaces', async () => {
  const load = await handler({ archiveLoadFailure: true })
  assert.equal((await load.request({ action: 'load' })).status, 500)
  for (const [code, status] of [['22023', 409], ['42501', 403], ['P0002', 404], ['other', 500]]) {
    const h = await handler({ rpcError: { code, message: 'Archive rejected' } })
    const result = await h.request({ action: 'archive-patient', patientId: 'p1', archiveAction: 'confirm' })
    assert.equal(result.status, status)
    assert.equal(result.data.success, false)
  }
})
