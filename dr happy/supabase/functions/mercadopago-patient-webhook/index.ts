import { corsHeaders } from '../_shared/cors.ts'
import { createClient } from 'jsr:@supabase/supabase-js@2'

function jsonResponse(status: number, body: Record<string, unknown>): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
}

function decodeBase64(value: string): Uint8Array {
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (value.length % 4)) % 4)
  return Uint8Array.from(atob(normalized), (char) => char.charCodeAt(0))
}

async function decryptToken(value: string): Promise<string> {
  const rawKey = Deno.env.get('MP_TOKEN_ENCRYPTION_KEY')?.trim()
  if (!rawKey) throw new Error('Falta MP_TOKEN_ENCRYPTION_KEY.')
  const [ivPart, dataPart] = value.split('.')
  if (!ivPart || !dataPart) throw new Error('Token cifrado inválido.')
  const key = await crypto.subtle.importKey('raw', decodeBase64(rawKey), 'AES-GCM', false, ['decrypt'])
  const decrypted = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: decodeBase64(ivPart) }, key, decodeBase64(dataPart))
  return new TextDecoder().decode(decrypted)
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  const supabaseUrl = Deno.env.get('SUPABASE_URL')?.trim()
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')?.trim()
  if (!supabaseUrl || !serviceRoleKey) return jsonResponse(500, { success: false, message: 'Falta configuración del servidor.' })
  const admin = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false } })
  let body: Record<string, unknown> = {}
  try { body = await request.json() } catch { return jsonResponse(400, { success: false, message: 'JSON inválido.' }) }
  const paymentId = String(body.data && typeof body.data === 'object' ? (body.data as Record<string, unknown>).id || '' : body.id || '').trim()
  if (!paymentId) return jsonResponse(200, { success: true, ignored: true })

  const providerUserId = String(body.user_id || body.userId || '').trim()
  const professionalIdFromUrl = new URL(request.url).searchParams.get('professional_id')?.trim() || ''
  let accountQuery = admin.from('professional_payment_accounts').select('professional_id, provider_user_id, access_token_encrypted, status').eq('provider', 'mercadopago')
  if (providerUserId) {
    accountQuery = accountQuery.eq('provider_user_id', providerUserId)
  } else if (professionalIdFromUrl) {
    accountQuery = accountQuery.eq('professional_id', professionalIdFromUrl)
  } else {
    return jsonResponse(200, { success: true, ignored: true, message: 'Notificación sin cuenta profesional identificable.' })
  }
  const { data: account } = await accountQuery.maybeSingle()
  if (!account || account.status !== 'connected') return jsonResponse(500, { success: false, message: 'Cuenta Mercado Pago del profesional no disponible.' })
  const accessToken = await decryptToken(account.access_token_encrypted)
  const paymentResponse = await fetch(`https://api.mercadopago.com/v1/payments/${encodeURIComponent(paymentId)}`, { headers: { Authorization: `Bearer ${accessToken}` } })
  const payment = await paymentResponse.json().catch(() => null)
  if (!paymentResponse.ok || !payment) return jsonResponse(502, { success: false, message: 'No se pudo validar el pago.' })
  const externalReference = String(payment.external_reference || '').trim()
  if (externalReference.startsWith('cd_')) {
    const requestId = externalReference.slice(3)
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(requestId)) {
      return jsonResponse(200, { success: true, ignored: true })
    }
    const { data: clinicalDocument, error: requestError } = await admin
      .from('paid_clinical_document_requests')
      .select('id, professional_id, amount, patient_first_name, patient_last_name, patient_email, service_type, requested_purpose, status, payment_status, payment_id')
      .eq('id', requestId)
      .eq('professional_id', account.professional_id)
      .maybeSingle()
    if (requestError) return jsonResponse(500, { success: false, message: 'No se pudo buscar la solicitud de documento.' })
    if (!clinicalDocument) return jsonResponse(200, { success: true, ignored: true })
    if (
      String(payment.currency_id || '') !== 'ARS' ||
      Math.round(Number(payment.transaction_amount) * 100) !== Math.round(Number(clinicalDocument.amount) * 100) ||
      String(payment.collector_id || '') !== String(account.provider_user_id || '')
    ) {
      console.error('[mercadopago-patient-webhook] Pago de documento con importe, moneda o cuenta distinta', requestId)
      return jsonResponse(200, { success: true, ignored: true })
    }
    const paymentStatus = String(payment.status || 'pending')
    if (paymentStatus !== 'approved') {
      const { error } = await admin.from('paid_clinical_document_requests').update({
        payment_status: paymentStatus,
        payment_id: paymentId,
        updated_at: new Date().toISOString(),
      }).eq('id', requestId).eq('professional_id', account.professional_id).eq('status', 'pending_payment')
        .neq('payment_status', 'approved')
      if (error) return jsonResponse(500, { success: false, message: 'No se pudo actualizar el estado del pago del documento.' })
      return jsonResponse(200, { success: true, paymentStatus })
    }
    if (clinicalDocument.status === 'pending_review' || clinicalDocument.status === 'completed') {
      if (clinicalDocument.payment_id !== paymentId) {
        console.error('[mercadopago-patient-webhook] Otro pago aprobado para una solicitud ya pagada', requestId)
        return jsonResponse(200, { success: true, ignored: true })
      }
      return jsonResponse(200, { success: true, paymentStatus, alreadyProcessed: true })
    }
    if (clinicalDocument.status !== 'pending_payment' || clinicalDocument.payment_status === 'approved') {
      return jsonResponse(200, { success: true, ignored: true })
    }
    const paidAt = new Date().toISOString()
    const { data: paid, error: paidError } = await admin.from('paid_clinical_document_requests').update({
      status: 'pending_review',
      payment_status: 'approved',
      payment_id: paymentId,
      paid_at: paidAt,
      updated_at: paidAt,
    }).eq('id', requestId).eq('professional_id', account.professional_id).eq('status', 'pending_payment')
      .select('id')
      .maybeSingle()
    if (paidError) return jsonResponse(500, { success: false, message: 'No se pudo registrar el pago del documento.' })
    if (!paid) return jsonResponse(200, { success: true, ignored: true })
    const [{ data: professional }, { data: workspace }] = await Promise.all([
      admin.from('professionals').select('full_name, email').eq('id', account.professional_id).maybeSingle(),
      admin.from('user_workspaces').select('profile_json').eq('user_id', account.professional_id).maybeSingle(),
    ])
    const profile = (workspace?.profile_json ?? {}) as Record<string, unknown>
    const to = (typeof profile.email === 'string' && profile.email.trim()) || String(professional?.email || '')
    if (to) {
      const serviceLabel = clinicalDocument.service_type === 'study-order' ? 'orden de estudios' : 'certificado médico'
      const text = [
        `Hola ${professional?.full_name || 'profesional'},`, '',
        `Recibiste una nueva solicitud paga de ${serviceLabel}.`, '',
        `Paciente: ${clinicalDocument.patient_last_name}, ${clinicalDocument.patient_first_name}`,
        `Tipo solicitado: ${clinicalDocument.requested_purpose}`,
        'Ingresá a Dr Happy > Certificados y órdenes para revisar el pago y emitir el documento con tu herramienta habitual.',
        'https://www.drhappy.com.ar/',
      ].join('\n')
      const escaped = text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
      await fetch(`${supabaseUrl}/functions/v1/send-email`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${serviceRoleKey}`, apikey: serviceRoleKey, 'Content-Type': 'application/json' },
        body: JSON.stringify({ to, subject: 'Dr Happy - Solicitud paga de certificado u orden', type: 'custom', text, templateData: { message: escaped.replaceAll('\n', '<br>') } }),
        signal: AbortSignal.timeout(10000),
      }).catch((error) => console.error('[mercadopago-patient-webhook] Aviso de documento no enviado', error))
    }
    return jsonResponse(200, { success: true, paymentStatus })
  }
  if (externalReference.startsWith('vc_')) {
    const consultId = externalReference.slice(3)
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(consultId)) return jsonResponse(200, { success: true, ignored: true })
    const paymentStatus = String(payment.status || 'pending')
    if (paymentStatus !== 'approved') {
      await admin.from('virtual_consultations').update({ payment_status: paymentStatus, payment_id: paymentId, updated_at: new Date().toISOString() })
        .eq('id', consultId).eq('professional_id', account.professional_id).eq('status', 'pending_payment')
      return jsonResponse(200, { success: true, paymentStatus })
    }
    const paidAt = new Date().toISOString()
    const { data: paid, error: paidError } = await admin.from('virtual_consultations').update({
      status: 'pending_review', payment_status: 'approved', payment_id: paymentId, paid_at: paidAt, updated_at: paidAt,
    }).eq('id', consultId).eq('professional_id', account.professional_id).in('status', ['pending_payment', 'cancelled'])
      .select('nombre, apellido, email, phone').maybeSingle()
    if (paidError) return jsonResponse(500, { success: false, message: 'No se pudo registrar el pago de la consulta virtual.' })
    if (paid) {
      const [{ data: professional }, { data: workspace }] = await Promise.all([
        admin.from('professionals').select('full_name, email').eq('id', account.professional_id).maybeSingle(),
        admin.from('user_workspaces').select('profile_json').eq('user_id', account.professional_id).maybeSingle(),
      ])
      const profile = (workspace?.profile_json ?? {}) as Record<string, unknown>
      const to = (typeof profile.email === 'string' && profile.email.trim()) || String(professional?.email || '')
      const text = [
        `Hola ${professional?.full_name || 'profesional'},`, '',
        'Recibiste una nueva consulta virtual asistida (pago aprobado).', '',
        `Paciente: ${paid.apellido}, ${paid.nombre}`,
        `Email: ${paid.email}`, ...(paid.phone ? [`Teléfono: ${paid.phone}`] : []), '',
        'Ingresá a Dr Happy > Consultas virtuales para revisarla, preparar la respuesta con Sofía y visarla.',
        'https://www.drhappy.com.ar/',
      ].join('\n')
      const escaped = text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
      await fetch(`${supabaseUrl}/functions/v1/send-email`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${serviceRoleKey}`, apikey: serviceRoleKey, 'Content-Type': 'application/json' },
        body: JSON.stringify({ to, subject: 'Dr Happy - Nueva consulta virtual para revisar', type: 'custom', text, templateData: { message: escaped.replaceAll('\n', '<br>') } }),
        signal: AbortSignal.timeout(10000),
      }).catch((error) => console.error('[mercadopago-patient-webhook] Aviso de consulta virtual no enviado', error))
    }
    return jsonResponse(200, { success: true, paymentStatus })
  }
  const { data: reservation } = await admin.from('public_booking_reservations').select('id, appointment_id, professional_id, patient_name, patient_dni, patient_email, patient_phone, slot_date, slot_time, amount_to_charge, amount_concept, modality, payment_status, status').eq('professional_id', account.professional_id).eq('appointment_id', externalReference).maybeSingle()
  if (!reservation) return jsonResponse(200, { success: true, ignored: true })
  if (reservation.status === 'cancelled') return jsonResponse(200, { success: true, ignored: true })

  const paymentStatus = String(payment.status || 'pending')
  const approved = paymentStatus === 'approved'
  if (!approved) {
    const { error } = await admin.from('public_booking_reservations')
      .update({ payment_status: paymentStatus, status: 'pending_payment' })
      .eq('id', reservation.id).neq('status', 'cancelled').neq('payment_status', 'approved')
    if (error) return jsonResponse(500, { success: false, message: 'No se pudo actualizar el estado del pago.' })
  }
  if (approved && reservation.appointment_id) {
    const normalizedDni = String(reservation.patient_dni || '').replace(/\D/g, '')
    if (!normalizedDni) return jsonResponse(400, { success: false, message: 'La reserva no tiene DNI válido.' })
    const patientId = crypto.randomUUID()
    const nameParts = String(reservation.patient_name || '').split(',')
    const patientRecord = {
      id: patientId, ownerUserId: reservation.professional_id,
      nombre: nameParts.slice(1).join(',').trim(), apellido: nameParts[0]?.trim() || String(reservation.patient_name || '').trim(),
      dni: normalizedDni, email: String(reservation.patient_email || '').trim(), obraSocial: '', numeroAfiliado: '', plan: '',
      birthDate: '', edad: 0, diagnosticoPrincipal: 'Turno reservado por turnera pública', patologiasConocidas: '', patologiasCronicas: '',
      ultimaInternacion: '', cirugiasPrevias: '', direccion: '', documents: [], consultations: [],
      createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    }
    const confirmedAppointment = {
      id: reservation.appointment_id,
      patientId,
      patientName: reservation.patient_name,
      patientDni: reservation.patient_dni,
      patientEmail: reservation.patient_email || '',
      patientPhone: reservation.patient_phone || '',
      scheduledDate: reservation.slot_date,
      scheduledTime: reservation.slot_time,
      scheduledAt: `${reservation.slot_date}T${reservation.slot_time}:00`,
      durationMinutes: 30,
      reason: 'Turno reservado por turnera pública',
      notes: 'Pago aprobado por Mercado Pago.',
      location: 'Consultorio médico',
      createdAt: new Date().toISOString(),
      createdByUserId: reservation.professional_id,
      publicBookingModality: reservation.modality,
      amountToCharge: Number(reservation.amount_to_charge || payment.transaction_amount || 0),
      amountConcept: reservation.amount_concept || 'consulta',
      status: 'confirmed',
      paymentStatus: 'approved',
      paymentId,
    }
    const ledgerId = `mercadopago-${paymentId}`
    const ledgerEntry = {
          id: ledgerId,
          patientId,
          patientName: reservation.patient_name,
          date: reservation.slot_date,
          intervention: reservation.amount_concept === 'consulta' ? 'Turno médico' : 'Seña de turno',
          totalAmount: Number(reservation.amount_to_charge || payment.transaction_amount || 0),
          paidAmount: Number(payment.transaction_amount || reservation.amount_to_charge || 0),
          notes: 'Pago aprobado por Mercado Pago.',
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        }
    const { data: confirmed, error: confirmError } = await admin.rpc('confirm_paid_public_booking', {
      p_professional_id: reservation.professional_id,
      p_appointment_id: reservation.appointment_id,
      p_patient: patientRecord,
      p_appointment: confirmedAppointment,
      p_ledger: ledgerEntry,
    })
    if (confirmError) return jsonResponse(500, { success: false, message: `No se pudo confirmar el turno pagado: ${confirmError.message}` })
    if (!confirmed) return jsonResponse(200, { success: true, ignored: true, paymentStatus })
    let emailConfirmationSentAt: string | undefined
    if (reservation.patient_email && reservation.payment_status !== 'approved') {
      const { data: professional } = await admin.from('professionals').select('full_name, specialty').eq('id', reservation.professional_id).maybeSingle()
      const emailResponse = await fetch(`${supabaseUrl}/functions/v1/send-email`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${serviceRoleKey}`, apikey: serviceRoleKey, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          to: reservation.patient_email,
          subject: `Turno confirmado con ${professional?.full_name || 'tu profesional'} - ${reservation.slot_date} ${reservation.slot_time} hs`,
          type: 'appointment',
          templateData: {
            patientName: reservation.patient_name,
            professionalName: professional?.full_name || 'tu profesional',
            specialty: professional?.specialty || 'Consulta médica',
            date: reservation.slot_date,
            time: reservation.slot_time,
            location: confirmedAppointment.location,
            notes: confirmedAppointment.notes,
            amountToCharge: reservation.amount_to_charge,
            amountConcept: reservation.amount_concept || 'sena',
          },
        }),
      })
      if (emailResponse.ok) emailConfirmationSentAt = new Date().toISOString()
    }
    if (emailConfirmationSentAt) {
      const { error } = await admin.rpc('mark_public_booking_email_sent', {
        p_professional_id: reservation.professional_id,
        p_appointment_id: reservation.appointment_id,
        p_sent_at: emailConfirmationSentAt,
      })
      if (error) return jsonResponse(500, { success: false, message: `No se pudo registrar el envío del email: ${error.message}` })
    }
  }
  return jsonResponse(200, { success: true, paymentStatus })
})
