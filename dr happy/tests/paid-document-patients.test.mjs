import test from 'node:test'
import assert from 'node:assert/strict'
import vm from 'node:vm'
import { readFile } from 'node:fs/promises'
import ts from 'typescript'

const source = (await readFile(new URL('../supabase/functions/paid-clinical-documents/index.ts', import.meta.url), 'utf8')).replace(/^import .*$/gm, '')
const js = ts.transpile(source, { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None })
const requestId = '12345678-1234-4234-8234-123456789abc'

async function fixture() {
  const keyBytes = crypto.getRandomValues(new Uint8Array(32))
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const key = await crypto.subtle.importKey('raw', keyBytes, 'AES-GCM', false, ['encrypt'])
  const encrypted = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode('fixture-only'))
  const encoded = bytes => Buffer.from(bytes).toString('base64')
  const state = { session: true, fail: false, result: { patient: { id: 'chart-one' }, archived: false }, checkoutCount: 0 }
  const inserts = [], rpcCalls = []
  let handler
  const admin = {
    from(table) {
      let insert
      const q = {
        select() { return q }, eq() { return q }, in() { return q }, gte() { return q },
        order() { return q }, range() { return q }, maybeSingle() { return q }, single() { return q },
        insert(value) { insert = value; return q }, update() { return q },
        then(resolve, reject) {
          if (insert) inserts.push({ table, value: insert })
          const data = table === 'professionals' ? { id: 'owner', full_name: 'Prueba', active: true }
            : table === 'paid_clinical_document_settings' ? { professional_id: 'owner', certificate_enabled: true, certificate_price: 30000 }
              : table === 'professional_payment_accounts' ? { status: 'connected', access_token_encrypted: `${encoded(iv)}.${encoded(encrypted)}` }
                : null
          return Promise.resolve({ data, count: 0, error: null }).then(resolve, reject)
        },
      }
      return q
    },
    async rpc(name, args) {
      rpcCalls.push({ name, args })
      return state.fail ? { error: { message: 'Fixture DB error' } } : { data: state.result }
    },
  }
  vm.runInNewContext(js, {
    Deno: { env: { get: key => key === 'MP_TOKEN_ENCRYPTION_KEY' ? encoded(keyBytes) : 'fixture' }, serve: fn => { handler = fn } },
    corsHeaders: {}, createClient: () => admin, resolveProfessionalId: async () => state.session ? 'owner' : null,
    hasMedicalToolRowAccess: () => true, MEDICAL_TOOL_ACCESS_COLUMNS: 'id',
    Response, crypto, TextEncoder, TextDecoder, atob, Uint8Array, AbortSignal,
    fetch: async () => { state.checkoutCount++; return new Response(JSON.stringify({ id: 'checkout', init_point: 'https://checkout.example.invalid' })) },
    console: { error() {} },
  })
  async function call(body) {
    const response = await handler(new Request('https://fixture.invalid', { method: 'POST', body: JSON.stringify(body) }))
    return { status: response.status, body: await response.json() }
  }
  return { state, inserts, rpcCalls, call }
}
const submission = {
  action: 'submit', slug: 'doctor-test', consent: true, patientFirstName: 'Ana', patientLastName: 'Prueba',
  patientDni: '12345678', patientEmail: 'patient@example.invalid', patientPhone: '11111111',
  birthDate: '1990-01-02', reason: 'Certificado laboral',
}

test('public request persists optional coverage and a textual member ID without changing checkout', async () => {
  const h = await fixture()
  const result = await h.call({ ...submission, healthInsurance: ' Cobertura ', insuranceMemberNumber: ' 000123/45-A ' })
  assert.equal(result.status, 200)
  assert.equal(h.inserts[0].value.patient_health_insurance, 'Cobertura')
  assert.equal(h.inserts[0].value.patient_insurance_member_number, '000123/45-A')
  assert.equal(h.inserts[0].value.amount, 30000)
  assert.equal(h.state.checkoutCount, 1)
  assert.equal(h.rpcCalls.length, 0, 'An unpaid checkout must not create a chart')
})

test('omitted or blank coverage stays optional; malformed or oversized input is rejected before checkout', async () => {
  const h = await fixture()
  assert.equal((await h.call(submission)).status, 200)
  assert.equal(h.inserts[0].value.patient_health_insurance, null)
  assert.equal(h.inserts[0].value.patient_insurance_member_number, null)
  for (const fields of [{ healthInsurance: 'x'.repeat(121) }, { insuranceMemberNumber: 'x'.repeat(81) },
    { insuranceMemberNumber: 123 }, { healthInsurance: 'bad\ninput' }]) {
    assert.equal((await h.call({ ...submission, ...fields })).status, 400)
  }
  assert.equal(h.state.checkoutCount, 1)
})

test('retrieving a paid chart uses session owner, never a forged professional ID', async () => {
  const h = await fixture()
  h.state.session = false
  assert.equal((await h.call({ action: 'get-patient', id: requestId })).status, 401)
  assert.equal(h.rpcCalls.length, 0)
  h.state.session = true
  assert.equal((await h.call({ action: 'get-patient', id: 'invalid' })).status, 400)
  const result = await h.call({ action: 'get-patient', id: requestId, professionalId: 'forged' })
  assert.equal(result.body.patient.id, 'chart-one')
  assert.equal(h.rpcCalls[0].args.p_professional_id, 'owner')
  assert.equal(h.rpcCalls[0].args.p_request_id, requestId)
})

test('unpaid/missing, archived and database failures are explicit, never success-shaped empty charts', async () => {
  const h = await fixture()
  h.state.result = null
  assert.equal((await h.call({ action: 'get-patient', id: requestId })).status, 404)
  h.state.result = { archived: true, patient: {} }
  assert.equal((await h.call({ action: 'get-patient', id: requestId })).status, 409)
  h.state.fail = true
  assert.equal((await h.call({ action: 'get-patient', id: requestId })).status, 500)
})
