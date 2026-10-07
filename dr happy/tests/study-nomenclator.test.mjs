import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { findStudySuggestions, formatOrderedStudy, loadStudyNomenclatorFromJson, studyCodeLabel, STUDY_CATALOG } from '../src/studyCatalog.ts'
import { certificateSignedContent } from '../src/medicalCertificate.ts'

const data = JSON.parse(await readFile(new URL('../public/study-nomenclator.json', import.meta.url), 'utf8'))
const catalog = loadStudyNomenclatorFromJson(data)

test('nomenclator contains all extracted rows in pages 9–98, excludes section 3.4 and preserves distinct settings', () => {
  assert.equal(catalog.length, 3534)
  assert.equal(new Set(catalog.map(entry => entry.code)).size, catalog.length)
  assert.equal(catalog.filter(entry => entry.setting === 'Ambulatorio').length, 2020)
  assert.equal(catalog.filter(entry => entry.setting === 'Internación').length, 1514)
  assert(catalog.every(entry => entry.sourcePage >= 9 && entry.sourcePage <= 98))
  assert(!catalog.some(entry => entry.category.startsWith('PRACTICAS EN INTERNACION CLINICA') || entry.code === '130106'))
  assert(catalog.some(entry => entry.sourcePage === 98 && /LABORATORIO/.test(entry.category)))
  assert(catalog.some(entry => entry.sourcePage === 98 && /FISIOKINES/.test(entry.category)))
})

test('multiline terms, numbered laboratory names and requested specialties remain intact', () => {
  assert.match(catalog.find(entry => entry.code === '180112').term, /SUPRARRENALES/)
  assert.match(catalog.find(entry => entry.code === '660160').term, /17/)
  assert.equal(catalog.find(entry => entry.code === '660475').term, 'HEMOGRAMA')
  assert(catalog.some(entry => /TRAUMAT/.test(entry.category)))
  assert(catalog.some(entry => entry.code === '250102' && /REHABILITACION RESPIRATORIA/.test(entry.term)))
})

test('same search supports accents, multiple words, aliases and codes for both forms', () => {
  assert(findStudySuggestions(catalog, 'rx tórax').some(entry => /TORAX/.test(entry.term)))
  assert(findStudySuggestions(catalog, 'tc craneo').some(entry => /CRANEO/.test(entry.term)))
  assert.equal(findStudySuggestions(catalog, '660475')[0].code, '660475')
  assert(findStudySuggestions(catalog, 'kinesioterapia').length > 0)
  assert.equal(findStudySuggestions(catalog, 'a').length, 0)
  assert.equal(findStudySuggestions(catalog, 'not-a-study').length, 0)
  assert(findStudySuggestions(catalog, 'laboratorio').length <= 16)
})

test('code system is explicit for nomenclator, legacy signed SNOMED docs are not rewritten', () => {
  assert.equal(studyCodeLabel(STUDY_CATALOG[0]), 'SNOMED CT 45036003')
  const practice = catalog.find(entry => entry.code === '660475')
  assert.match(formatOrderedStudy(practice), /HEMOGRAMA \(Nomenclador 660475 · Ambulatorio\)/)
  assert.equal(studyCodeLabel({ term: 'Libre' }), 'Texto libre')
  const legacy = { documentType: 'study-order', studies: [{ term: 'Ecografía', code: '45036003' }], certificateDate: '2026-01-01', letterhead: {}, diagnostico: 'Control', body: 'Original', patient: {} }
  assert.deepEqual(certificateSignedContent(legacy).studies, legacy.studies)
  assert.deepEqual(certificateSignedContent({ ...legacy, studies: [practice] }).studies, [practice])
})

test('invalid catalogues fail explicitly instead of presenting partial or mislabelled data', () => {
  for (const value of [null, {}, { practices: [] }, { practices: [catalog[0], { ...catalog[1], codeSystem: 'snomed' }] }, { practices: [{ ...catalog[0], sourcePage: 99 }] }]) {
    assert.throws(() => loadStudyNomenclatorFromJson(value), /catálogo|práctica/)
  }
})
