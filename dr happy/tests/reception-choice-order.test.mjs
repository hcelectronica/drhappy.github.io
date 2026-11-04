import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import vm from 'node:vm'
import ts from 'typescript'

const source = await readFile(new URL('../src/patientReceptionService.ts', import.meta.url), 'utf8')
const exports = {}
vm.runInNewContext(ts.transpile(source, { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS }), { exports, require: () => ({}) })
const { buildReceptionChoices } = exports
const links = { registration: '/registro/doctor', studies: '/consulta/doctor', documents: '/documentos/doctor', video: '/video/doctor', booking: '/turnera/doctor' }
const block = (id, label, amountToCharge = null) => ({ id, label, url: '/turnera/doctor?b=' + id, location: 'Consultorio', amountToCharge })

test('registration, IOMA and IA lead the reception without changing links or amounts', () => {
  const turneras = [block('private', 'Particular', 35000), block('ioma', 'Turno I.O.M.A', 15000), block('pami', 'PAMI')]
  const choices = buildReceptionChoices({ displayName: 'Doctor', links, turneras })
  assert.deepEqual(Array.from(choices, choice => choice.title), [
    'Registrarse como paciente', 'Turno I.O.M.A', 'Chequea tus estudios con IA, Ahora',
    'Documentos médicos', 'Videoconsulta', 'Turno Particular', 'Turno PAMI',
  ])
  assert.equal(choices[1].url, turneras[1].url)
  assert.equal(choices[1].description, 'Consultorio')
  assert.equal(turneras[1].amountToCharge, 15000)
  assert.equal(choices[2].url, links.studies)
  assert.match(choices[2].description, /revisada por tu profesional/)
  assert.equal(new Set(choices.map(choice => choice.url)).size, choices.length)
})

test('each enabled document appears once with its own link but no price in the menu', () => {
  const documents = [['certificate', 'Certificados', 1000], ['fitness', 'Aptos físicos', 2000], ['prescription', 'Recetas', 3000]].map(([type, label, amount]) => ({ type, label, amount, url: `/documentos/doctor?type=${type}` }))
  const choices = buildReceptionChoices({ displayName: 'Doctor', links, turneras: [block('ioma', 'IOMA')], documents })
  assert.deepEqual(Array.from(choices.slice(0, 6), choice => choice.title), ['Registrarse como paciente', 'Turno IOMA', 'Chequea tus estudios con IA, Ahora', 'Certificados', 'Aptos físicos', 'Recetas'])
  assert.equal(choices.filter(choice => choice.kind === 'documents').length, 3)
  assert.equal(choices[4].url, '/documentos/doctor?type=fitness')
  assert.equal(choices[4].description, 'Evaluación profesional')
  assert.equal(documents[1].amount, 2000)
  for (const choice of choices) assert.doesNotMatch(choice.description, /\$|1\.000|2\.000|3\.000/)
})

test('missing options stay hidden, multiple IOMA turneras retain their identities and remaining order', () => {
  const turneras = [block('not-ioma', 'Bioma'), block('one', 'IOMA'), block('two', 'ioma sede norte')]
  const choices = buildReceptionChoices({ displayName: 'Doctor', links: { studies: links.studies }, turneras })
  assert.deepEqual(Array.from(choices, choice => choice.key), ['turnera-one', 'turnera-two', 'studies', 'turnera-not-ioma'])
  assert.equal(choices.filter(choice => choice.kind === 'registration').length, 0)
  assert.equal(buildReceptionChoices({ displayName: 'Doctor', links: {}, turneras: [] }).length, 0)
  assert.equal(buildReceptionChoices({ displayName: 'Doctor', links, turneras: [] }).filter(choice => choice.kind === 'booking').length, 0)
})

test('turnera names starting with Turno or Turnos are preserved without a duplicate prefix', () => {
  for (const label of ['TURNOS IOMA', 'Turnos PAMI', 'Turno Particular', 'turnos ioma', '  TURNOS IOMA']) {
    const choices = buildReceptionChoices({ displayName: 'Doctor', links: {}, turneras: [block('named', label, 15000)] })
    assert.equal(choices[0].title, label)
    assert.equal(choices[0].url, '/turnera/doctor?b=named')
    assert.equal(choices[0].description, 'Consultorio')
  }
  const choices = buildReceptionChoices({ displayName: 'Doctor', links: {}, turneras: [block('other', 'Turnoterapia')] })
  assert.equal(choices[0].title, 'Turno Turnoterapia')
})

test('legacy booking remains available when no individual turneras are returned', () => {
  const choices = buildReceptionChoices({ displayName: 'Doctor', links })
  assert.deepEqual(Array.from(choices, choice => choice.kind), ['registration', 'studies', 'documents', 'booking', 'video'])
  assert.equal(choices.find(choice => choice.kind === 'booking').url, links.booking)
})

test('paid and free turnera buttons hide amounts without modifying payment configuration', () => {
  const turneras = [block('paid', 'Particular', 35000), block('free', 'PAMI')]
  const before = JSON.stringify(turneras)
  const choices = buildReceptionChoices({ displayName: 'Doctor', links: {}, turneras })
  assert.equal(choices[0].description, 'Consultorio')
  assert.equal(choices[1].description, 'Consultorio · Sin pago online')
  assert.equal(JSON.stringify(turneras), before)
  for (const choice of choices) assert.doesNotMatch(choice.description, /\$|35\.000/)
})
