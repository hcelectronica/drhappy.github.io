import test from 'node:test'
import assert from 'node:assert/strict'
import { registrationEmail, deliverRegistrationEmail, notifyProfessionalRegistration } from '../supabase/functions/_shared/professionalRegistrationEmail.ts'

const invite = { source: 'invite', patientName: 'Paciente de prueba', patientEmail: 'patient@example.invalid', patientPhone: '12345678' }
const booking = { ...invite, source: 'booking', date: '2026-10-03', time: '15:30', location: 'Consultorio', status: 'confirmed' }

test('invitation and booking identify source without inventing appointments or new-patient identity', () => {
  const invitation = registrationEmail(invite, 'Profesional')
  assert.match(invitation.subject, /invitación/)
  assert.match(invitation.text, /Link de invitar paciente/)
  assert.match(invitation.text, /no reserva un turno/)
  assert.ok(!invitation.text.includes('Fecha:'))
  const turn = registrationEmail(booking, 'Profesional')
  for (const value of ['Link de turnera', '2026-10-03', '15:30', 'Turno confirmado']) assert.ok(turn.text.includes(value))
  assert.ok(!turn.text.includes('paciente nuevo'))
})

test('paid and legacy reservations never appear confirmed before they are', () => {
  assert.match(registrationEmail({ ...booking, status: 'pending_payment' }, '').text, /todavía no está confirmado/)
  assert.match(registrationEmail({ ...booking, status: 'pending' }, '').text, /Solicitud pendiente/)
})

test('patient and professional text is escaped and clinical identifiers are absent', () => {
  const mail = registrationEmail({ ...invite, patientName: '<img src=x onerror=alert(1)> & "test"' }, '<script>')
  assert.ok(!mail.templateData.message.includes('<img'))
  assert.ok(!mail.templateData.message.includes('<script>'))
  assert.match(mail.templateData.message, /&lt;img/)
  assert.ok(!mail.text.includes('DNI'))
})

test('delivery targets only professional and requires successful HTTP and JSON result', async () => {
  let sent
  const mock = async (url, options) => {
    sent = { url, options, body: JSON.parse(options.body) }
    return new Response(JSON.stringify({ success: true }), { status: 200 })
  }
  await deliverRegistrationEmail('https://example.invalid', 'test-key', 'professional@example.invalid', invite, 'Profesional', mock)
  assert.equal(sent.body.to, 'professional@example.invalid')
  assert.ok(sent.options.signal)
  for (const response of [
    new Response(JSON.stringify({ success: false }), { status: 200 }),
    new Response(JSON.stringify({ success: true }), { status: 502 }),
    new Response('{}'), new Response('not json'),
  ]) {
    await assert.rejects(deliverRegistrationEmail('https://example.invalid', 'test-key', 'professional@example.invalid', invite, '', async () => response))
  }
  await assert.rejects(deliverRegistrationEmail('', '', '', invite, '', mock), /email válido/)
  await assert.rejects(deliverRegistrationEmail('', '', 'professional@example.invalid', invite, '', async () => { throw new Error('Network failure') }), /Network failure/)
})

test('unavailable professional logs failure without claiming email delivery or failing saved registration', async () => {
  const errors = []
  const previous = console.error
  console.error = (...args) => errors.push(args)
  try {
    const admin = { from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null, error: { message: 'Unavailable' } }) }) }) }) }
    const sent = await notifyProfessionalRegistration({ admin, url: '', key: '', professionalId: 'test', eventId: 'event', event: invite })
    assert.equal(sent, false)
    assert.equal(errors.length, 1)
    assert.equal(errors[0][1].eventId, 'event')
    assert.ok(!JSON.stringify(errors).includes(invite.patientEmail))
  } finally { console.error = previous }
})

test('recipient comes from stored professional profile, then account, never from the patient', async () => {
  for (const profileEmail of ['profile@example.invalid', '']) {
    let recipient
    const admin = { from: (table) => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({
      data: table === 'professionals' ? { full_name: 'Profesional', email: 'account@example.invalid' } : { profile_json: { email: profileEmail } },
      error: null,
    }) }) }) }) }
    const sent = await notifyProfessionalRegistration({
      admin, url: 'https://example.invalid', key: 'test-key', professionalId: 'test', eventId: 'event', event: invite,
      send: async (_url, options) => {
        recipient = JSON.parse(options.body).to
        return new Response(JSON.stringify({ success: true }))
      },
    })
    assert.equal(sent, true)
    assert.equal(recipient, profileEmail || 'account@example.invalid')
    assert.notEqual(recipient, invite.patientEmail)
  }
})
