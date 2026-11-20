import assert from 'node:assert/strict'
import test from 'node:test'
import vm from 'node:vm'
import { readFile } from 'node:fs/promises'
import ts from 'typescript'
import { normalizeBlocks } from '../supabase/functions/_shared/publicBookingBlocks.ts'
import { documentServices, documentServiceOptions } from '../supabase/functions/_shared/clinicalDocumentServices.ts'
import { ensurePublicAlias, resolvePublicToolSettings, publicDocumentPaths } from '../supabase/functions/_shared/professionalPublicAlias.ts'
import { hasMedicalToolRowAccess, MEDICAL_TOOL_ACCESS_COLUMNS } from '../supabase/functions/_shared/medicalToolAccess.ts'

const source = await readFile(new URL('../supabase/functions/patient-reception/index.ts', import.meta.url), 'utf8')
const js = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText
function fixture() {
  const settings = { professional_id: 'owner', slug: 'fixture', display_name: 'Doctor', enabled: true,
    documents: true, studies: true, booking: true, registration: true, video: true }
  const db = {
    professional_public_aliases: [{ alias: 'fixture', professional_id: 'owner', is_primary: true }],
    professionals: [{ id: 'owner', active: true, full_name: 'Doctor', is_admin: true }],
    patient_receptions: [settings],
    public_booking_profiles: [{ professional_id: 'owner', slug: 'doctor-booking', enabled: true, availability_blocks: [{ id: 'private', label: 'Particular', modality: 'private', amountToCharge: 100, days: [1,2,3,4,5], startTime: '09:00', endTime: '12:00', durationMinutes: 30, slotCount: 6 }] }],
    virtual_consult_settings: [{ professional_id: 'owner', enabled: true, slug: 'doctor-virtual' }],
    paid_clinical_document_settings: [{ professional_id: 'owner', certificate_enabled: true, slug: 'doctor-documents' }],
    patient_invite_links: [{ professional_id: 'owner', token: 'doctor-invite' }],
    professional_payment_accounts: [{ professional_id: 'owner', provider: 'mercadopago', status: 'connected' }],
    ioma_prescription_settings: [],
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
  const admin = { from, async rpc() { return { data: 'fixture', error: null } } }
  let handler
  vm.runInNewContext(js, { exports: {}, Request, Response, console: { error() {} },
    normalizeBlocks, documentServices, documentServiceOptions,
    Deno: { env: { get: () => 'fixture' } },
    require: name => name.includes('server.ts') ? { serve: fn => { handler = fn } }
      : name.includes('clinicalDocumentServices') ? { documentServices, documentServiceOptions }
      : name.includes('professionalPublicAlias') ? { ensurePublicAlias, resolvePublicToolSettings, publicDocumentPaths }
      : name.includes('medicalToolAccess') ? { hasMedicalToolRowAccess, MEDICAL_TOOL_ACCESS_COLUMNS }
      : name.includes('publicBookingBlocks') ? { normalizeBlocks } : name.includes('supabase-js') ? { createClient: () => admin }
        : name.includes('professionalSession') ? { resolveProfessionalId: async () => state.identity } : { corsHeaders: {} },
  })
  async function call(body, method = 'POST') {
    const response = await handler(new Request('https://fixture.invalid', { method, ...(method === 'POST' ? { body: JSON.stringify(body) } : {}) }))
    return { status: response.status, body: await response.json() }
  }
  return { db, state, call, writes, settings }
}
test('free IOMA prescription link is independent of payment and other document services', async () => {
  const h = fixture()
  h.db.ioma_prescription_settings.push({ professional_id: 'owner', enabled: true })
  h.db.professional_payment_accounts[0].status = 'disconnected'
  h.settings.documents = false
  const result = await h.call({ action: 'public', slug: 'fixture' })
  assert.equal(result.status, 200)
  assert.equal(result.body.reception.iomaUrl, 'https://www.drhappy.com.ar/?ioma=fixture')
  h.db.ioma_prescription_settings[0].enabled = false
  assert.equal((await h.call({ action: 'public', slug: 'fixture' })).body.reception.iomaUrl, null)
})
test('public reception exposes only selected internal destinations; paid video is distinct and no patient data is returned', async () => {
  const h = fixture(); const result = await h.call({ action: 'public', slug: 'fixture', professionalId: 'attacker' })
  assert.equal(result.status, 200)
  assert.equal(Object.keys(result.body.reception.links).length, 5)
  assert.match(result.body.reception.links.video, /\/fixture\/particular\?consultation=video$/)
  assert.match(result.body.reception.links.booking, /\/fixture\/particular$/)
  assert.match(result.body.reception.links.registration, /\/registro\/fixture$/)
  assert.equal(JSON.stringify(result.body).includes('doctor-invite'), false)
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

test('reception lists independent document prices and hides disabled types or disconnected payments', async () => {
  const h = fixture()
  Object.assign(h.db.paid_clinical_document_settings[0], { certificate_price: 1000, fitness_enabled: true, fitness_price: 2000, prescription_enabled: true, prescription_price: 3000 })
  let reception = (await h.call({ action: 'public', slug: 'fixture' })).body.reception
  assert.deepEqual(reception.documents.map(item => [item.type, item.label, item.amount]), [['certificate', 'Certificados', 1000], ['fitness', 'Aptos físicos', 2000], ['prescription', 'Recetas', 3000]])
  assert.match(reception.documents[1].url, /\/fixture\/aptos-fisicos$/)
  h.db.paid_clinical_document_settings[0].certificate_enabled = false
  reception = (await h.call({ action: 'public', slug: 'fixture' })).body.reception
  assert.deepEqual(reception.documents.map(item => item.type), ['fitness', 'prescription'])
  h.db.professional_payment_accounts[0].status = 'disconnected'
  assert.deepEqual((await h.call({ action: 'public', slug: 'fixture' })).body.reception.documents, [])
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

test('reception lists each enabled turnera by identity, including free turneras without Mercado Pago', async () => {
  const h = fixture()
  const template = h.db.public_booking_profiles[0].availability_blocks[0]
  h.db.public_booking_profiles[0].availability_blocks = [
    { ...template, id: 'ioma', label: 'IOMA', modality: 'coverage', amountToCharge: undefined },
    { ...template, id: 'pami', label: 'PAMI', amountToCharge: 250 },
    { ...template, id: 'particular', label: 'Particular', amountToCharge: 500 },
    { ...template, id: 'paused', label: 'Pausada', enabled: false },
  ]
  let result = (await h.call({ action: 'public', slug: 'fixture' })).body.reception
  assert.deepEqual(result.turneras.map(block => block.label), ['IOMA', 'PAMI', 'Particular'])
  assert.equal(new Set(result.turneras.map(block => block.url)).size, 3)
  assert.deepEqual(result.turneras.map(block => block.amountToCharge), [null, 250, 500])
  h.db.professional_payment_accounts[0].status = 'disconnected'
  result = (await h.call({ action: 'public', slug: 'fixture' })).body.reception
  assert.deepEqual(result.turneras.map(block => block.label), ['IOMA'])
  assert.match(result.links.booking, /\/fixture\/ioma$/)
  h.settings.booking = false
  assert.deepEqual((await h.call({ action: 'public', slug: 'fixture' })).body.reception.turneras, [])
})

test('renaming an individual turnera updates its reception destination without changing reception slug or reservations', async () => {
  const h=fixture()
  const block=h.db.public_booking_profiles[0].availability_blocks[0]
  const before=(await h.call({action:'public',slug:'fixture'})).body.reception.turneras[0]
  block.label='TURNOS IOMA'
  const after=(await h.call({action:'public',slug:'fixture'})).body.reception.turneras[0]
  assert.equal(after.id,before.id)
  assert.equal(after.url,'https://www.drhappy.com.ar/turnera/fixture/turnos-ioma')
  assert.equal(h.settings.slug,'fixture')
  assert.equal(h.writes.length,0)
})
