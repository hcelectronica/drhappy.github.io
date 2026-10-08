import test from 'node:test'
import assert from 'node:assert/strict'
import { allergyDetails, clinicalChecklist, firstAttentionSummary, hasClinicalCondition, setAllergyDetails, toggleClinicalCondition } from '../src/firstAttention.ts'

test('checklist preserves free text, does not duplicate conditions or assert negative findings', () => {
  const original = 'HTA histórica\nAntecedentes familiares de diabetes'
  let text = toggleClinicalCondition(original, 'Diabetes', true)
  assert(hasClinicalCondition(text, 'Diabetes'))
  assert.equal(toggleClinicalCondition(text, 'Diabetes', true), text)
  text = toggleClinicalCondition(text, 'Diabetes', false)
  assert.equal(text, original)
  assert.equal(clinicalChecklist.length, 6)
  assert.equal(hasClinicalCondition(original, 'Diabetes'), false)
})

test('allergy selection requires detail and preserves other antecedents', () => {
  assert.equal(allergyDetails('Diabetes'), null)
  assert.equal(allergyDetails(setAllergyDetails('Diabetes', '')), '')
  const text = setAllergyDetails('Diabetes\nAlergias: penicilina', 'Penicilina; urticaria')
  assert.equal(allergyDetails(text), 'Penicilina; urticaria')
  assert.equal(setAllergyDetails(text, null), 'Diabetes')
  assert.equal(allergyDetails('Alergias: penicilina\nAlergias: látex'), 'penicilina; látex')
  assert.equal(allergyDetails(setAllergyDetails('Diabetes', 'Látex\nurticaria')), 'Látex; urticaria')
})

test('initial summary contains only documented facts, distinguishes habitual medication and includes appointment context', () => {
  const patient = {
    apellido: 'Prueba', nombre: 'Paciente', dni: '11111111', birthDate: '1980-01-01',
    obraSocial: '', numeroAfiliado: '', plan: '', patologiasConocidas: '',
    patologiasCronicas: 'Hipertensión\nAlergias: penicilina', ultimaInternacion: '', cirugiasPrevias: '',
    pesoInicial: '72,5', tallaCm: '170', pesoInicialFecha: '2026-10-07', tensionArterial: '120/80',
    medicacionHabitual: 'Losartán 50 mg', diagnosticoPrincipal: 'Control',
  }
  const summary = firstAttentionSummary(patient, 'Turno de control')
  assert.match(summary, /DNI: 11111111/)
  assert.match(summary, /Alergias: penicilina/)
  assert.match(summary, /antecedente, no nueva indicación/)
  assert.match(summary, /25.09 kg\/m²/)
  assert.match(summary, /Sobrepeso/)
  assert.match(summary, /Turno asociado: Turno de control/)
  assert.doesNotMatch(summary, /Cirugías previas:|Última internación:|sin alergias/i)
  assert.equal(patient.medicacionHabitual, 'Losartán 50 mg')
})
