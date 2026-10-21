import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import vm from 'node:vm'
import ts from 'typescript'
import { notifyProfessionalRegistration } from '../supabase/functions/_shared/professionalRegistrationEmail.ts'

async function fixture(mode, paymentStatus = 'approved') {
  const encode = value => Buffer.from(value).toString('base64')
  const keyBytes = crypto.getRandomValues(new Uint8Array(32)), iv = crypto.getRandomValues(new Uint8Array(12))
  const key = await crypto.subtle.importKey('raw', keyBytes, 'AES-GCM', false, ['encrypt'])
  const encrypted = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode('fixture-token'))
  const reservation = { id: 'fixture', appointment_id: 'appointment', professional_id: 'owner', patient_name: 'Fixture',
    patient_dni: '12345678', patient_email: 'fixture@example.invalid', patient_phone: '', slot_date: '2026-11-02',
    slot_time: '15:00', amount_to_charge: 1000, amount_concept: 'consulta', modality: 'private',
    payment_status: 'pending', status: 'pending_payment', consultation_mode: mode }
  const records = {
    professional_payment_accounts: { professional_id: 'owner', status: 'connected', access_token_encrypted: `${encode(iv)}.${encode(encrypted)}` },
    public_booking_reservations: reservation,
    professionals: { full_name: 'Fixture Doctor', email: 'doctor@example.invalid' },
    user_workspaces: { profile_json: {} },
  }
  const mails = [], appointments = []
  let noticeClaimed = false, handler
  const admin = { from(table) {
    let notice = false
    const q = { select() { return q }, eq() { return q }, neq() { return q }, is() { return q }, maybeSingle() { return q },
      update(value) { notice = !!value.video_notice_claimed_at; return q },
      then(resolve, reject) {
        const data = notice ? (noticeClaimed ? [] : [{ id: reservation.id }]) : structuredClone(records[table])
        if (notice) noticeClaimed = true
        return Promise.resolve({ data, error: null }).then(resolve, reject)
      } }
    return q
  }, async rpc(name, params) {
    if (name === 'confirm_paid_public_booking') {
      if (!appointments.length) appointments.push(params.p_appointment)
      reservation.payment_status = 'approved'
      return { data: true }
    }
    assert.equal(name, 'mark_public_booking_email_sent'); return { data: true }
  } }
  const fetchMock = async (url, init) => {
    if (url.startsWith('https://api.mercadopago.com/')) return Response.json({ status: paymentStatus, external_reference: 'appointment', transaction_amount: 1000 })
    assert.ok(url.endsWith('/functions/v1/send-email'))
    mails.push(JSON.parse(init.body)); return Response.json({ success: true })
  }
  const source = (await readFile(new URL('../supabase/functions/mercadopago-patient-webhook/index.ts', import.meta.url), 'utf8')).replace(/^import .*$/gm, '')
  vm.runInNewContext(ts.transpile(source, { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None }), {
    Deno: { serve: callback => { handler = callback }, env: { get: name => name === 'MP_TOKEN_ENCRYPTION_KEY' ? encode(keyBytes) : 'https://fixture.invalid' } },
    createClient: () => admin, corsHeaders: {}, crypto, Request, Response, URL, TextDecoder, atob,
    fetch: fetchMock, console,
    notifyProfessionalRegistration: params => notifyProfessionalRegistration({ ...params, send: fetchMock }),
  })
  return { appointments, mails, async call() {
    const response = await handler(new Request('https://fixture.invalid?professional_id=owner', { method: 'POST', body: JSON.stringify({ data: { id: 'payment' } }) }))
    assert.equal(response.status, 200); return response.json()
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
test('pending video payment creates no appointment or paid-confirmation email; presential path remains unchanged', async () => {
  const pending = await fixture('video', 'pending')
  await pending.call(); assert.equal(pending.appointments.length, 0); assert.equal(pending.mails.length, 0)
  const presential = await fixture('presential')
  await presential.call()
  assert.equal(presential.appointments[0].consultationMode, 'presential')
  assert.equal(presential.appointments[0].location, 'Consultorio médico')
  assert.equal(presential.mails.length, 1)
})
