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
    'Certificados y recetas', 'Videoconsulta', 'Turno Particular', 'Turno PAMI',
  ])
  assert.equal(choices[1].url, turneras[1].url)
  assert.match(choices[1].description, /15\.000/)
  assert.equal(choices[2].url, links.studies)
  assert.match(choices[2].description, /revisada por tu profesional/)
  assert.equal(new Set(choices.map(choice => choice.url)).size, choices.length)
})

test('missing options stay hidden, multiple IOMA turneras retain their identities and remaining order', () => {
  const turneras = [block('not-ioma', 'Bioma'), block('one', 'IOMA'), block('two', 'ioma sede norte')]
  const choices = buildReceptionChoices({ displayName: 'Doctor', links: { studies: links.studies }, turneras })
  assert.deepEqual(Array.from(choices, choice => choice.key), ['turnera-one', 'turnera-two', 'studies', 'turnera-not-ioma'])
  assert.equal(choices.filter(choice => choice.kind === 'registration').length, 0)
  assert.equal(buildReceptionChoices({ displayName: 'Doctor', links: {}, turneras: [] }).length, 0)
  assert.equal(buildReceptionChoices({ displayName: 'Doctor', links, turneras: [] }).filter(choice => choice.kind === 'booking').length, 0)
})

test('legacy booking remains available when no individual turneras are returned', () => {
  const choices = buildReceptionChoices({ displayName: 'Doctor', links })
  assert.deepEqual(Array.from(choices, choice => choice.kind), ['registration', 'studies', 'documents', 'booking', 'video'])
  assert.equal(choices.find(choice => choice.kind === 'booking').url, links.booking)
})
