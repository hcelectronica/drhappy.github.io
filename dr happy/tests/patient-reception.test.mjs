import assert from 'node:assert/strict'
import test from 'node:test'
import vm from 'node:vm'
import { readFile } from 'node:fs/promises'
import ts from 'typescript'

const source = await readFile(new URL('../supabase/functions/patient-reception/index.ts', import.meta.url), 'utf8')
const js = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText
function fixture() {
  const settings = { professional_id: 'owner', slug: 'fixture', display_name: 'Doctor', enabled: true,
    documents: true, studies: true, booking: true, registration: true, video: true }
  const db = {
    professionals: [{ id: 'owner', active: true, full_name: 'Doctor' }],
    patient_receptions: [settings],
    public_booking_profiles: [{ professional_id: 'owner', slug: 'doctor-booking', enabled: true, availability_blocks: [{ modality: 'private', amountToCharge: 100 }] }],
    virtual_consult_settings: [{ professional_id: 'owner', enabled: true, slug: 'doctor-virtual' }],
    paid_clinical_document_settings: [{ professional_id: 'owner', certificate_enabled: true, slug: 'doctor-documents' }],
    patient_invite_links: [{ professional_id: 'owner', token: 'doctor-invite' }],
    professional_payment_accounts: [{ professional_id: 'owner', provider: 'mercadopago', status: 'connected' }],
  }
  const state = { identity: 'owner', conflict: false, fail: false }
  const writes = []
  function from(table) {
    const filters = []; let value
    const query = {
      select() { return query }, eq(key, value) { filters.push(row => row[key] === value); return query },
      maybeSingle() { return query }, single() { return query },
      upsert(input) { value = input; return query },
      then(resolve, reject) {
        if (state.fail) return Promise.resolve({ data: null, error: { code: 'ERROR' } }).then(resolve, reject)
        if (value && state.conflict) return Promise.resolve({ data: null, error: { code: '23505' } }).then(resolve, reject)
        if (value) { writes.push(value); Object.assign(settings, value) }
        return Promise.resolve({ data: db[table].find(row => filters.every(filter => filter(row))) ?? null, error: null }).then(resolve, reject)
      },
    }; return query
  }
  let handler
  vm.runInNewContext(js, { exports: {}, Request, Response, console: { error() {} },
    Deno: { env: { get: () => 'fixture' } },
    require: name => name.includes('server.ts') ? { serve: fn => { handler = fn } }
      : name.includes('supabase-js') ? { createClient: () => ({ from }) }
        : name.includes('professionalSession') ? { resolveProfessionalId: async () => state.identity } : { corsHeaders: {} },
  })
  async function call(body, method = 'POST') {
    const response = await handler(new Request('https://fixture.invalid', { method, ...(method === 'POST' ? { body: JSON.stringify(body) } : {}) }))
    return { status: response.status, body: await response.json() }
  }
  return { db, state, call, writes, settings }
}
test('public reception exposes only selected internal destinations; paid video is distinct and no patient data is returned', async () => {
  const h = fixture(); const result = await h.call({ action: 'public', slug: 'fixture', professionalId: 'attacker' })
  assert.equal(result.status, 200)
  assert.equal(Object.keys(result.body.reception.links).length, 5)
  assert.match(result.body.reception.links.video, /\?m=private&consultation=video$/)
  assert.match(result.body.reception.links.booking, /\?m=private$/)
  assert.match(result.body.reception.links.registration, /\/registro\/doctor-invite$/)
  assert.equal(JSON.stringify(result.body).includes('professional_id'), false)
  h.settings.documents = false
  assert.equal((await h.call({ action: 'public', slug: 'fixture' })).body.reception.links.documents, undefined)
  h.db.professional_payment_accounts[0].status = 'disconnected'
  const links = (await h.call({ action: 'public', slug: 'fixture' })).body.reception.links
  assert.equal(links.booking, undefined); assert.equal(links.video, undefined); assert.equal(links.studies, undefined)
})
test('disabled, inactive and unknown receptions cannot be opened, nor can invalid input', async () => {
  for (const change of [h => { h.settings.enabled = false }, h => { h.db.professionals[0].active = false }]) {
    const h = fixture(); change(h); assert.equal((await h.call({ action: 'public', slug: 'fixture' })).status, 404)
  }
  const h = fixture()
  for (const slug of ['unknown', '../path', '', 'https://example.invalid']) assert.equal((await h.call({ action: 'public', slug })).status, 404)
  assert.equal((await h.call(null)).status, 400)
  assert.equal((await h.call({}, 'GET')).status, 405)
})
test('professional settings cannot impersonate another owner; availability, types and slug collisions are validated', async () => {
  const h = fixture(); h.state.identity = null
  assert.equal((await h.call({ action: 'get-settings', professionalId: 'owner' })).status, 401)
  h.state.identity = 'foreign'
  assert.equal((await h.call({ action: 'save-settings', professionalId: 'owner', settings: h.settings })).status, 404)
  h.state.identity = 'owner'
  assert.equal((await h.call({ action: 'save-settings', settings: { ...h.settings, professional_id: 'foreign' } })).status, 200)
  assert.equal(h.writes[0].professional_id, 'owner')
  for (const value of [{ slug: 'Bad Name' }, { slug: 'a'.repeat(25) }, { video: 'true' }, { display_name: '' }]) {
    assert.equal((await h.call({ action: 'save-settings', settings: { ...h.settings, ...value } })).status, 400)
  }
  h.state.conflict = true
  assert.equal((await h.call({ action: 'save-settings', settings: h.settings })).status, 409)
  h.state.conflict = false; h.db.virtual_consult_settings[0].enabled = false
  assert.equal((await h.call({ action: 'save-settings', settings: h.settings })).status, 409)
  h.state.fail = true
  assert.equal((await h.call({ action: 'public', slug: 'fixture' })).status, 500)
})
