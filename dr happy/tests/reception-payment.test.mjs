import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import vm from 'node:vm'
import ts from 'typescript'
import { notifyProfessionalRegistration } from '../supabase/functions/_shared/professionalRegistrationEmail.ts'

async function fixture(mode, paymentStatus = 'approved', options = {}) {
  const encode = value => Buffer.from(value).toString('base64')
  const keyBytes = crypto.getRandomValues(new Uint8Array(32)), iv = crypto.getRandomValues(new Uint8Array(12))
  const key = await crypto.subtle.importKey('raw', keyBytes, 'AES-GCM', false, ['encrypt'])
  const encrypted = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode('fixture-token'))
  const reservation = { id: 'fixture', appointment_id: 'appointment', professional_id: 'owner', patient_name: 'Fixture',
    patient_dni: '12345678', patient_email: 'fixture@example.invalid', patient_phone: '', slot_date: '2026-11-02',
    slot_time: '15:00', amount_to_charge: 1000, amount_concept: 'consulta', modality: 'private',
    block_id: 'pami', block_label: 'PAMI', duration_minutes: 45, location: 'Sede Centro', reason: 'Control PAMI',
    payment_status: 'pending', status: 'pending_payment', confirmation_email_status: 'pending', professional_confirmation_status: 'pending', consultation_mode: mode }
  const records = {
    professional_payment_accounts: { professional_id: 'owner', status: 'connected', access_token_encrypted: `${encode(iv)}.${encode(encrypted)}` },
    public_booking_reservations: reservation,
    professionals: { full_name: 'Fixture Doctor', email: 'doctor@example.invalid' },
    user_workspaces: { profile_json: {} },
  }
  const mails = [], appointments = []
  let handler, patientFailures = options.patientFailures || 0, professionalFailures = options.professionalFailures || 0
  const admin = { from(table) {
    let update, allowed, required, isExpired = false
    const q = { select() { return q }, eq(key, value) { if (['status', 'confirmation_email_status', 'professional_confirmation_status'].includes(key)) required = { ...required, [key]: value }; return q },
      neq() { return q }, is() { return q }, in(key, value) { allowed = { key, values: value }; return q },
      lt() { isExpired = true; return q }, maybeSingle() { return q },
      update(value) { update = value; return q },
      then(resolve, reject) {
        let data = structuredClone(records[table])
        if (table === 'public_booking_reservations' && update) {
          if (isExpired) data = []
          else if ((allowed && !allowed.values.includes(reservation[allowed.key]))
            || (required && Object.entries(required).some(([key, value]) => reservation[key] !== value))) data = []
          else { Object.assign(reservation, update); data = [{ id: reservation.id }] }
        }
        return Promise.resolve({ data, error: null }).then(resolve, reject)
      } }
    return q
  }, async rpc(name, params) {
    if (name === 'confirm_paid_public_booking') {
      if (!appointments.length) appointments.push(params.p_appointment)
      reservation.payment_status = 'approved'
      reservation.status = 'confirmed'
      return { data: true }
    }
    assert.equal(name, 'mark_public_booking_email_sent'); return { data: true }
  } }
  const fetchMock = async (url, init) => {
    if (url.startsWith('https://api.mercadopago.com/')) return Response.json({ status: paymentStatus, external_reference: 'appointment', transaction_amount: 1000 })
    assert.ok(url.endsWith('/functions/v1/send-email'))
    const mail=JSON.parse(init.body)
    mails.push(mail)
    if(mail.to==='fixture@example.invalid' && patientFailures>0){patientFailures--;return Response.json({success:false},{status:502})}
    if(mail.to==='doctor@example.invalid' && professionalFailures>0){professionalFailures--;return Response.json({success:false},{status:502})}
    return Response.json({ success: true })
  }
  const source = (await readFile(new URL('../supabase/functions/mercadopago-patient-webhook/index.ts', import.meta.url), 'utf8')).replace(/^import .*$/gm, '')
  vm.runInNewContext(ts.transpile(source, { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None }), {
    Deno: { serve: callback => { handler = callback }, env: { get: name => name === 'MP_TOKEN_ENCRYPTION_KEY' ? encode(keyBytes) : 'https://fixture.invalid' } },
    createClient: () => admin, corsHeaders: {}, crypto, Request, Response, URL, TextDecoder, atob, AbortSignal,
    fetch: fetchMock, console,
    notifyProfessionalRegistration: params => notifyProfessionalRegistration({ ...params, send: fetchMock }),
  })
  return { appointments, mails, reservation, async call(expectedStatus = 200) {
    const response = await handler(new Request('https://fixture.invalid?professional_id=owner', { method: 'POST', body: JSON.stringify({ data: { id: 'payment' } }) }))
    assert.equal(response.status, expectedStatus); return response.json()
  } }
}
test('approved video payment persists origin in professional agenda and both emails, once only', async () => {
  const h = await fixture('video')
  await h.call()
  assert.equal(h.appointments.length, 1)
  assert.equal(h.appointments[0].consultationMode, 'video')
  assert.match(h.appointments[0].reason, /Videoconsulta/)
  assert.match(h.appointments[0].notes, /recepción digital - consulta virtual/)
  assert.match(h.appointments[0].location, /Videoconsulta/)
  assert.equal(h.mails.length, 2)
  assert.equal(h.mails[0].to, 'doctor@example.invalid')
  assert.match(h.mails[0].text, /Pago aprobado/)
  assert.match(h.mails[0].text, /enviá al paciente el enlace/)
  assert.equal(h.mails[1].to, 'fixture@example.invalid')
  assert.match(h.mails[1].templateData.notes, /videoconsulta/)
  await h.call()
  assert.equal(h.appointments.length, 1); assert.equal(h.mails.length, 2)
})
test('failed paid confirmation preserves the approved appointment and retries on a repeated webhook', async () => {
  const h = await fixture('presential', 'approved', { patientFailures: 1 })
  await h.call(503)
  assert.equal(h.appointments.length, 1)
  assert.equal(h.reservation.status, 'confirmed')
  assert.equal(h.reservation.confirmation_email_status, 'failed')
  await h.call()
  assert.equal(h.appointments.length, 1)
  assert.equal(h.reservation.confirmation_email_status, 'sent')
  await h.call()
  assert.equal(h.mails.filter(mail=>mail.to==='fixture@example.invalid').length, 2, 'successful confirmation is not sent again')
  assert.equal(h.mails.filter(mail=>mail.to==='doctor@example.invalid').length, 1)
})
test('pending video payment creates no appointment or paid-confirmation email; presential path remains unchanged', async () => {
  const pending = await fixture('video', 'pending')
  await pending.call(); assert.equal(pending.appointments.length, 0); assert.equal(pending.mails.length, 0)
  const presential = await fixture('presential')
  await presential.call()
  assert.equal(presential.appointments[0].consultationMode, 'presential')
  assert.equal(presential.appointments[0].location, 'Sede Centro')
  assert.equal(presential.appointments[0].durationMinutes, 45)
  assert.equal(presential.appointments[0].publicBookingBlockId, 'pami')
  assert.equal(presential.appointments[0].publicBookingLabel, 'PAMI')
  assert.equal(presential.appointments[0].reason, 'Control PAMI')
  assert.equal(presential.mails.length, 2)
  assert.match(presential.mails.find(mail=>mail.to==='doctor@example.invalid').text, /Turno confirmado/)
})
test('failed professional confirmation still sends the patient confirmation and retries without duplicates', async () => {
  const h = await fixture('presential', 'approved', { professionalFailures: 1 })
  await h.call(503)
  assert.equal(h.reservation.status, 'confirmed')
  assert.equal(h.reservation.professional_confirmation_status, 'failed')
  assert.equal(h.reservation.confirmation_email_status, 'sent')
  await h.call()
  assert.equal(h.reservation.professional_confirmation_status, 'sent')
  assert.equal(h.mails.filter(mail=>mail.to==='fixture@example.invalid').length, 1)
  assert.equal(h.appointments.length, 1)
})
