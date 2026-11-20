import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import vm from 'node:vm'
import ts from 'typescript'

async function load(path, globals = {}) {
  const source = (await readFile(new URL(path, import.meta.url), 'utf8')).replaceAll('import.meta.env.BASE_URL', '"/"')
  const exports = {}
  vm.runInNewContext(ts.transpile(source, { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS }), {
    exports, Response, window: { location: { origin: 'https://fixture.invalid' } },
    require: () => globals.supabaseClient ?? {}, sessionStorage: globals.sessionStorage,
  })
  return exports
}

test('reception shows a separate free IOMA link only when provided', async () => {
  const { buildReceptionChoices } = await load('../src/patientReceptionService.ts')
  const reception = { displayName: 'Prueba', links: {}, documents: [{ type: 'prescription', label: 'Recetas', amount: 100, url: '/paid' }] }
  assert.equal(buildReceptionChoices(reception).length, 1)
  const choices = buildReceptionChoices({ ...reception, iomaUrl: '/?ioma=fixture' })
  assert.equal(choices.length, 2)
  assert.equal(choices.find(item => item.kind === 'ioma').url, '/?ioma=fixture')
  assert.equal(choices.find(item => item.kind === 'documents').url, '/paid')
})

test('IOMA service sends public and authenticated actions to the dedicated function', async () => {
  const calls = []
  const api = await load('../src/iomaPrescriptionService.ts', {
    sessionStorage: { getItem: key => key === 'drhappy-professional-session' ? 'test-session' : null },
    supabaseClient: { isSupabaseConfigured: true, supabase: { functions: { invoke: async (name, options) => {
      calls.push({ name, ...options }); return { data: { success: true }, error: null }
    } } } },
  })
  const submit = { action: 'submit', slug: 'fixture', patientFirstName: 'Prueba', patientLastName: 'Ficticia',
    patientDni: '12345678', patientEmail: 'fixture@example.invalid', patientPhone: '12345678', birthDate: '2000-01-01',
    insuranceMemberNumber: 'fixture', medication: 'Prueba', consent: true, website: '' }
  const actions = [{ action: 'public-info', slug: 'fixture' }, submit, { action: 'get-settings' },
    { action: 'save-settings', enabled: true }, { action: 'list', offset: 100 }, { action: 'complete', id: 'fixture' }]
  for (const action of actions) assert.equal((await api.callIoma(action)).success, true)
  assert.equal(api.iomaUrl('fixture'), 'https://fixture.invalid/?ioma=fixture')
  assert.ok(calls.every(call => call.name === 'ioma-prescriptions'))
  assert.equal(calls[0].headers, undefined)
  assert.equal(calls[1].headers, undefined)
  assert.ok(calls.slice(2).every(call => call.headers['x-drhappy-session'] === 'test-session'))
  assert.equal(calls[4].body.offset, 100)
  assert.equal('image' in calls[1].body, false)
})

test('expired session and ambiguous submit failures do not promise success', async () => {
  let invoked = false
  const noSession = await load('../src/iomaPrescriptionService.ts', {
    sessionStorage: { getItem: () => null },
    supabaseClient: { isSupabaseConfigured: true, supabase: { functions: { invoke: async () => { invoked = true; return {data:{success:true},error:null} } } } },
  })
  assert.equal((await noSession.callIoma({ action: 'list', offset: 0 })).success, true)
  assert.equal(invoked, true, 'Supabase-authenticated professionals can use the service without a custom session token')
  const failed = await load('../src/iomaPrescriptionService.ts', {
    sessionStorage: { getItem: () => 'expired' },
    supabaseClient: { isSupabaseConfigured: true, supabase: { functions: { invoke: async () => ({ error: { context: new Response('', { status: 401 }) } }) } } },
  })
  assert.match((await failed.callIoma({ action: 'list', offset: 0 })).message, /sesión/i)
  const network = await load('../src/iomaPrescriptionService.ts', {
    sessionStorage: { getItem: () => null },
    supabaseClient: { isSupabaseConfigured: true, supabase: { functions: { invoke: async () => { throw new Error('network') } } } },
  })
  assert.match((await network.callIoma({ action: 'submit', slug: 'fixture' })).message, /antes de volver a enviar/)
})
