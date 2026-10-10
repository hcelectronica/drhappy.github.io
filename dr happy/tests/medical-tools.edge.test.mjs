import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import vm from 'node:vm'
import ts from 'typescript'
import { webcrypto } from 'node:crypto'
import { hasMedicalToolRowAccess, MEDICAL_TOOL_ACCESS_COLUMNS } from '../supabase/functions/_shared/medicalToolAccess.ts'

async function request(tool, professional, action) {
  let handler
  const queries = []
  const admin = {
    from(table) {
      const query = new Proxy({}, { get(_target, method) {
        if (method === 'then') return resolve => {
          queries.push(table)
          const data = table === 'professionals' ? professional
            : table === 'user_workspaces' ? { profile_json: {} } : []
          return Promise.resolve({ data, error: null }).then(resolve)
        }
        return () => query
      } })
      return query
    },
    rpc() { return Promise.resolve({ data: true, error: null }) },
  }
  const source = (await readFile(new URL(`../supabase/functions/${tool}/index.ts`, import.meta.url), 'utf8')).replace(/^import .*$/gm, '')
  vm.runInNewContext(ts.transpile(source, { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None }), {
    Deno: { serve: value => { handler = value }, env: { get: () => 'https://example.invalid' } },
    serve: value => { handler = value }, createClient: () => admin,
    resolveProfessionalId: async () => professional.id, corsHeaders: {},
    hasMedicalToolRowAccess, MEDICAL_TOOL_ACCESS_COLUMNS,
    crypto: webcrypto, TextEncoder, Response, console,
  })
  const response = await handler(new Request('https://example.invalid', {
    method: 'POST', headers: { 'x-drhappy-session': 'fixture' }, body: JSON.stringify({ action }),
  }))
  return { status: response.status, queries, data: await response.json() }
}

const physician = { id: 'fixture', specialty: 'Médico', active: true, is_admin: false, subscription_status: 'trial', trial_started_at: new Date().toISOString(), enabled_modules_json: ['attention', 'ledger'] }
for (const [tool, action] of [['paid-clinical-documents', 'list-ledger-requests'], ['virtual-consultations', 'list'], ['video-access', undefined], ['video-handoff', 'create']]) {
  test(`${tool}: trial and paid physicians allowed; dentists, expired and disabled modules denied`, async () => {
    for (const professional of [physician, { ...physician, subscription_status: 'active', subscription_expires_at: new Date(Date.now() + 86400000).toISOString() }]) {
      assert.equal((await request(tool, professional, action)).status, 200)
    }
    for (const professional of [
      { ...physician, specialty: 'Odontólogo' },
      { ...physician, specialty: 'Psicólogo' },
      { ...physician, subscription_status: 'expired' },
      { ...physician, active: false },
      { ...physician, enabled_modules_json: [] },
      { ...physician, trial_started_at: new Date(Date.now() - 7 * 86400000).toISOString() },
    ]) {
      const result = await request(tool, professional, action)
      assert.equal(result.status, 403)
      assert(!result.queries.includes('paid_clinical_document_requests'))
      assert(!result.queries.includes('virtual_consultations'))
    }
  })
}
