import test from 'node:test'
import assert from 'node:assert/strict'
import { buildConsultationInstructions, deliverConsultationInstructions, InstructionsError } from '../supabase/functions/_shared/consultationInstructions.ts'

const entry = {
  id: 'consultation-1', date: '2026-10-08T01:00:00Z',
  motivoConsulta: 'NO MOTIVO', enfermedadActual: 'NO HISTORIA', impresionDiagnostica: 'NO DIAGNOSTICO',
  pensamientoMedico: 'NO PENSAMIENTO', resumenSofia: 'NO SOFIA', pesoActual: 'NO PESO',
  planManejo: 'Control en 7 días.\nAlarma: fiebre <alta> & vómitos.',
  farmacosAgregados: 'Losartán 50 mg · 1 comprimido cada 24 h',
  estudiosComplementarios: 'Hemograma\nEcografía',
  professionalSignature: { fullName: 'Dra. Prueba', licenseNumber: 'TEST' },
  signatureSeal: { signedByUserId: 'professional-a' },
}
const patient = { id: 'patient-1', ownerUserId: 'professional-a', email: 'patient@example.invalid', consultations: [entry], medicacionHabitual: 'NO HABITUAL', dni: 'NO DNI' }
const build = (changes = {}) => buildConsultationInstructions({
  professionalId: 'professional-a', patients: [patient], patientId: patient.id,
  consultationId: entry.id, expectedEmail: patient.email, ...changes,
})

test('only saved instructions go to the registered patient email, with consultation date and unchanged regimen', () => {
  const payload = build()
  assert.equal(payload.to, patient.email)
  assert(payload.subject.includes('07/10/2026'), 'Date is the actual consultation date in Argentina, not send date')
  for (const value of [entry.planManejo, entry.farmacosAgregados, entry.estudiosComplementarios]) assert(payload.text.includes(value))
  for (const value of ['NO MOTIVO', 'NO HISTORIA', 'NO DIAGNOSTICO', 'NO PENSAMIENTO', 'NO SOFIA', 'NO PESO', 'NO HABITUAL', 'NO DNI']) {
    assert(!JSON.stringify(payload).includes(value), 'Forbidden field: '+value)
  }
  assert(payload.templateData.message.includes('&lt;alta&gt; &amp;'))
  assert(payload.templateData.message.includes('Hemograma<br>Ecografía'))
  assert(payload.text.includes('No reemplaza una receta'))
})

test('missing saved records, empty indications and invalid dates fail explicitly', () => {
  assert.throws(() => build({ patients: [] }), error => error instanceof InstructionsError && error.status === 404)
  assert.throws(() => build({ consultationId: 'not-saved' }), error => error.status === 409)
  assert.throws(() => build({ patients: [{ ...patient, consultations: [{ ...entry, planManejo: '', farmacosAgregados: '', estudiosComplementarios: '' }] }] }), /no tiene tratamiento/)
  assert.throws(() => build({ patients: [{ ...patient, consultations: [{ ...entry, date: 'invalid' }] }] }), /fecha válida/)
  const onlyStudies = build({ patients: [{ ...patient, consultations: [{ ...entry, planManejo: '', farmacosAgregados: '' }] }] })
  assert(onlyStudies.text.includes(entry.estudiosComplementarios))
  assert(!onlyStudies.text.includes('Fármacos y forma'))
})

test('recipient is taken from storage; missing, injected or changed emails are rejected', () => {
  for (const email of ['', 'not-email', 'victim@example.com,other@example.com', 'victim@example.com\r\nBcc:other@example.com']) {
    assert.throws(() => build({ patients: [{ ...patient, email }] }), /email válido/)
  }
  assert.throws(() => build({ expectedEmail: 'different@example.invalid' }), /email de la ficha cambió/)
})

test('shared records allow only the author to send their own saved evolution', () => {
  assert.throws(() => build({ professionalId: 'professional-b' }), error => error.status === 403)
  const own = build({ professionalId: 'professional-b', patients: [{ ...patient, consultations: [{ ...entry, signatureSeal: { signedByUserId: 'professional-b' } }] }] })
  assert.equal(own.to, patient.email)
})

test('oversized instructions are rejected without silent truncation; HTML remains escaped', () => {
  assert.throws(() => build({ patients: [{ ...patient, consultations: [{ ...entry, planManejo: 'a'.repeat(20_001) }] }] }), /No se recortó/)
  const payload = build({ patients: [{ ...patient, consultations: [{ ...entry, planManejo: '<script>alert("x")</script>' }] }] })
  assert(!payload.templateData.message.includes('<script>'))
  assert(payload.text.includes('<script>'), 'Plain text is not rewritten')
})

test('mail succeeds only with positive provider confirmation; ambiguous sends are not retried', async () => {
  const payload = build()
  await deliverConsultationInstructions(payload, async sent => {
    assert.deepEqual(sent, payload)
    return Response.json({ success: true })
  })
  for (const response of [Response.json({ success: false }), Response.json({}), Response.json({ success: true }, { status: 500 }), new Response('bad json')]) {
    await assert.rejects(deliverConsultationInstructions(payload, async () => response), error => error.status === 502)
  }
  let calls = 0
  await assert.rejects(deliverConsultationInstructions(payload, async () => { calls++; throw new Error('timeout') }), /Verificá con el paciente/)
  assert.equal(calls, 1, 'No automatic duplicate send after an ambiguous timeout')
})
