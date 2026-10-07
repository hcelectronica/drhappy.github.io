import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import {
  appendMedication, bmiLabel, calculateBmi, followUpLines,
  normalizeClinicalBaseline, positiveMeasurement, validateClinicalMeasurements,
  mergeClinicalPathologies, adultAtMeasurement, adultBmiCategory, classifiedBmiLabel, relevantWeightLoss, weightComparison,
} from '../src/clinicalFollowUp.ts'
import { clinicalMedicationLine, clinicalMedicationSuggestions } from '../src/clinicalMedication.ts'

test('IMC uses kg and cm, including decimal commas', () => {
  assert.equal(calculateBmi('72,5', '170'), 72.5 / 1.7 ** 2)
  assert.equal(bmiLabel('72.5', '170'), '25.09 kg/m²')
  assert.equal(positiveMeasurement(' 170,5 '), 170.5)
})

test('optional measurements preserve old records; malformed data never generates an IMC', () => {
  assert.equal(validateClinicalMeasurements({}), null)
  for (const value of ['', '0', '-1', 'abc', 'Infinity', '1,2.3', '2kg']) {
    assert.equal(calculateBmi(value, '170'), null)
    assert.equal(calculateBmi('72', value), null)
  }
  assert.match(validateClinicalMeasurements({ pesoInicial: '0' }), /Peso inicial/)
  assert.match(validateClinicalMeasurements({}, '-2'), /Peso actual/)
  assert.equal(validateClinicalMeasurements({}, '70,3'), null)
  assert.equal(calculateBmi('70', undefined), null)
})

test('blood pressure is optional but validates both components', () => {
  assert.equal(validateClinicalMeasurements({ tensionArterial: '120/80' }), null)
  assert.equal(validateClinicalMeasurements({ tensionArterial: '120 / 80' }), null)
  for (const value of ['120', '120/00', 'abc', '120/80/90']) {
    assert.match(validateClinicalMeasurements({ tensionArterial: value }), /Tensión arterial/)
  }
})

test('baseline normalizes legacy records and survives JSON roundtrip', () => {
  assert.deepEqual(normalizeClinicalBaseline({}), { pesoInicial: '', pesoInicialFecha: '', tallaCm: '', tensionArterial: '', medicacionHabitual: '' })
  const data = { pesoInicial: '72,5', pesoInicialFecha: '2026-01-12', tallaCm: '170', tensionArterial: '120/80', medicacionHabitual: 'Metformina 500 mg' }
  assert.deepEqual(normalizeClinicalBaseline(JSON.parse(JSON.stringify(data))), data)
})

test('a dated evolution retains its own height and clinical instructions', () => {
  const entry = { pesoActual: '70', tensionArterial: '130/85', tallaCmEnConsulta: '170', farmacosAgregados: 'Enalapril 5 mg', estudiosComplementarios: 'Hemograma\nControl próximo' }
  const baseline = { tallaCm: '170' }
  baseline.tallaCm = '180'
  assert.equal(followUpLines(entry).find(([label]) => label === 'IMC')[1], '24.22 kg/m²')
  assert(followUpLines(entry).some(([label, value]) => label === 'Estudios complementarios solicitados' && value === entry.estudiosComplementarios))
  assert(followUpLines(entry).some(([label, value]) => label === 'Tensión arterial (mmHg)' && value === '130/85'))
  assert.deepEqual(followUpLines({}), [])
  assert(!followUpLines({ pesoActual: '70' }).some(([label]) => label === 'IMC'))
})

test('adding medication preserves manual posology and never replaces the habitual list', () => {
  assert.equal(appendMedication('Metformina 500 mg cada 12 h', 'Enalapril 5 mg'), 'Metformina 500 mg cada 12 h\nEnalapril 5 mg')
  assert.equal(appendMedication('Metformina', ''), 'Metformina')
  assert.equal(appendMedication('', 'Enalapril'), 'Enalapril')
})

test('normalization, backup import, signature and printing are wired to clinical fields', async () => {
  const app = await readFile(new URL('../src/App.tsx', import.meta.url), 'utf8')
  assert(app.includes('...normalizeClinicalBaseline(candidate)'))
  assert(app.includes('...normalizeClinicalBaseline(patient)'))
  assert(app.includes('...normalizeClinicalBaseline(incoming)'))
  assert(app.includes('contentToSign: {'))
  assert(app.includes('...followUp,'))
  assert(app.includes('followUpLines(entry, patientForPrint.birthDate).map(([label, value]) => `<p>'))
  assert(!app.includes('incorporarFarmacos'))
  assert(app.includes("medicacionHabitual: baseline.medicacionHabitual || ''"))
})

test('WHO adult categories use exact unrounded BMI cutoffs', () => {
  for (const [value, category] of [
    [18.4999, 'Bajo peso'], [18.5, 'Normopeso'], [24.9999, 'Normopeso'],
    [25, 'Sobrepeso'], [29.9999, 'Sobrepeso'], [30, 'Obesidad clase I'], [34.9999, 'Obesidad clase I'],
    [35, 'Obesidad clase II'], [39.9999, 'Obesidad clase II'], [40, 'Obesidad clase III'],
  ]) assert.equal(adultBmiCategory(value), category)
  for (const value of [null, 0, -1, NaN, Infinity]) assert.equal(adultBmiCategory(value), null)
  assert.match(classifiedBmiLabel('18.4999', '100', '1980-01-01', '2026-01-01'), /18.50 kg\/m² · Bajo peso/)
})

test('adult categories require real dates and adulthood at the measurement, not current age', () => {
  assert.equal(adultAtMeasurement('2008-06-20', '2026-06-19'), false)
  assert.equal(adultAtMeasurement('2008-06-20', '2026-06-20'), true)
  for (const birth of [undefined, '', 'bad', '2026-02-30', '2030-01-01']) assert.equal(adultAtMeasurement(birth, '2026-06-20'), false)
  for (const date of ['', '2026-02-30', '2026-06-20garbage']) assert.equal(adultAtMeasurement('1980-01-01', date), false)
  assert.equal(adultAtMeasurement('2008-06-20', '2026-06-20T01:00:00Z'), false, 'Consultations use Argentina calendar day')
  assert.equal(classifiedBmiLabel('70', '170', '2015-01-01', '2026-01-01'), '24.22 kg/m²')
  assert.equal(classifiedBmiLabel('70', '170', undefined, '2026-01-01'), '24.22 kg/m²')
})

test('weight-loss alert requires >=5% between different dated adult measurements within six calendar months', () => {
  const adult = '1980-01-01'
  const baseline = { pesoInicial: '100', pesoInicialFecha: '2026-01-31' }
  const current = { pesoActual: '95', date: '2026-07-31' }
  assert.equal(relevantWeightLoss(baseline, [], current, adult)?.percent, 5)
  assert.equal(relevantWeightLoss(baseline, [], { ...current, pesoActual: '95.01' }, adult), null)
  assert.equal(relevantWeightLoss(baseline, [], { ...current, date: '2026-08-01' }, adult), null)
  assert.equal(relevantWeightLoss({ pesoInicial: '100' }, [], current, adult), null)
  assert.equal(relevantWeightLoss({ ...baseline, pesoInicialFecha: current.date }, [], current, adult), null)
  assert.equal(relevantWeightLoss(baseline, [], current), null)
  assert.equal(relevantWeightLoss(baseline, [], current, '2015-01-01'), null)
  assert.equal(relevantWeightLoss(baseline, [], { ...current, pesoActual: '-10' }, adult), null)
  assert.equal(relevantWeightLoss({ ...baseline, pesoInicialFecha: '2026-02-30' }, [], current, adult), null)
  assert.equal(relevantWeightLoss({ pesoInicial: '100', pesoInicialFecha: '2025-08-28' }, [], { pesoActual: '95', date: '2026-02-28' }, adult)?.percent, 5)
})

test('weight-loss history uses the highest eligible prior weight, ignores future/undated/self entries, and preserves baseline delta', () => {
  const history = [
    { id: 'a', pesoActual: '100', date: '2026-04-01' },
    { id: 'b', pesoActual: '110', date: '2026-06-01' },
    { id: 'c', pesoActual: '200', date: '2026-09-01' },
    { id: 'd', pesoActual: '200', date: '' },
    { id: 'current', pesoActual: '200', date: '2026-06-20' },
  ]
  const baseline = { pesoInicial: '100', tallaCm: '170' }
  const current = { id: 'current', pesoActual: '99', tallaCmEnConsulta: '180', date: '2026-07-01' }
  const loss = relevantWeightLoss(baseline, history, current, '1980-01-01')
  assert.equal(loss?.referenceWeight, 110)
  assert.equal(loss?.percent, 10)
  assert.match(weightComparison(baseline, current), /-1.00 kg \(-1.00%\).*34.60.*30.56/)
  assert.equal(weightComparison({}, current), null)
  assert.match(validateClinicalMeasurements({ pesoInicialFecha: '2026-02-30' }), /Fecha/)
})

test('old known and chronic pathologies merge without discarding either field', () => {
  assert.equal(mergeClinicalPathologies('HTA', 'Diabetes'), 'HTA\nDiabetes')
  assert.equal(mergeClinicalPathologies('HTA', 'HTA'), 'HTA')
  assert.equal(mergeClinicalPathologies('', ''), '')
})

test('medication search offers distinct strengths and presentations, never a patient regimen by default', async () => {
  const catalog = JSON.parse(await readFile(new URL('../public/vademecum.json', import.meta.url), 'utf8'))
  const suggestions = clinicalMedicationSuggestions(catalog, 'losartan 50')
  assert(suggestions.length > 0)
  assert(suggestions.every(item => item.presentation.includes('50')))
  assert(suggestions.some(item => item.dosage))
  assert.equal(clinicalMedicationSuggestions(catalog, 'l').length, 0)
  const selected = suggestions[0]
  assert.equal(clinicalMedicationLine(selected, ''), `${selected.drug} · ${selected.presentation}`)
  assert.equal(clinicalMedicationLine(selected, '1 comprimido cada 24 h'), `${selected.drug} · ${selected.presentation} · 1 comprimido cada 24 h`)
})

test('AI review mode uses the no-tools branch and keeps approval optional', async () => {
  const backend = await readFile(new URL('../supabase/functions/ai-assistant/index.ts', import.meta.url), 'utf8')
  const app = await readFile(new URL('../src/App.tsx', import.meta.url), 'utf8')
  assert(backend.includes("payload.mode === 'clinical-evolution-review'"))
  const branch = backend.slice(backend.indexOf("if (payload.mode === 'paper-record-transcription'"), backend.indexOf('for (let', backend.indexOf("if (payload.mode === 'paper-record-transcription'")))
  assert(!branch.includes('system, tools, messages'))
  assert(app.includes("mode: 'clinical-evolution-review'"))
  assert(app.includes("resumenSofia: consultationDraft.incluirResumenSofia ?"))
  assert(app.includes('originalDraft !== clinicalDraftRef.current'))
})
