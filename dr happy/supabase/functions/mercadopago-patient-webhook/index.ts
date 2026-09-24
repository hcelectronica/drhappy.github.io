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
  let accountQuery = admin.from('professional_payment_accounts').select('professional_id, access_token_encrypted, status').eq('provider', 'mercadopago')
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
  const { data: reservation } = await admin.from('public_booking_reservations').select('id, appointment_id, professional_id, patient_name, patient_dni, patient_email, patient_phone, slot_date, slot_time, amount_to_charge, amount_concept, modality, payment_status').eq('professional_id', account.professional_id).eq('appointment_id', externalReference).maybeSingle()
  if (!reservation) return jsonResponse(200, { success: true, ignored: true })

  const paymentStatus = String(payment.status || 'pending')
  const approved = paymentStatus === 'approved'
  await admin.from('public_booking_reservations').update({ payment_status: paymentStatus, status: approved ? 'confirmed' : 'pending_payment' }).eq('id', reservation.id)
  if (approved && reservation.appointment_id) {
    const { data: workspace } = await admin.from('user_workspaces').select('patients_json, appointments_json, treatment_ledger_json').eq('user_id', reservation.professional_id).maybeSingle()
    const patients = Array.isArray(workspace?.patients_json) ? workspace.patients_json as Array<Record<string, unknown>> : []
    const appointments = Array.isArray(workspace?.appointments_json) ? workspace.appointments_json : []
    const existingAppointment = appointments.find((item: Record<string, unknown>) => item.id === reservation.appointment_id) as Record<string, unknown> | undefined
    const normalizedEmail = String(reservation.patient_email || '').trim().toLowerCase()
    const normalizedDni = String(reservation.patient_dni || '').trim()
    const normalizedName = String(reservation.patient_name || '').trim().toLowerCase()
    const existingPatient = patients.find((patient) => {
      const patientEmail = String(patient.email || '').trim().toLowerCase()
      const patientDni = String(patient.dni || '').trim()
      const patientName = `${String(patient.apellido || '')}, ${String(patient.nombre || '')}`.trim().toLowerCase()
      return Boolean(normalizedDni && patientDni === normalizedDni) ||
        Boolean(normalizedEmail && patientEmail === normalizedEmail) ||
        Boolean(normalizedName && patientName === normalizedName)
    })
    const patientId = String(existingPatient?.id || crypto.randomUUID())
    const nameParts = String(reservation.patient_name || '').split(',')
    const patientRecord = existingPatient || {
      id: patientId, ownerUserId: reservation.professional_id,
      nombre: nameParts.slice(1).join(',').trim(), apellido: nameParts[0]?.trim() || String(reservation.patient_name || '').trim(),
      dni: normalizedDni, email: String(reservation.patient_email || '').trim(), obraSocial: '', numeroAfiliado: '', plan: '',
      birthDate: '', edad: 0, diagnosticoPrincipal: 'Turno reservado por turnera pública', patologiasConocidas: '', patologiasCronicas: '',
      ultimaInternacion: '', cirugiasPrevias: '', direccion: '', documents: [], consultations: [],
      createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    }
    const updatedPatient = { ...patientRecord, email: String(patientRecord.email || reservation.patient_email || '').trim(), dni: String(patientRecord.dni || reservation.patient_dni || '').trim(), updatedAt: new Date().toISOString() }
    const nextPatients = existingPatient ? patients.map((patient) => patient.id === patientId ? updatedPatient : patient) : [...patients, updatedPatient]
    const confirmedAppointment = existingAppointment ?? {
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
    }
    const updated = existingAppointment
      ? appointments.map((appointment: Record<string, unknown>) => appointment.id === reservation.appointment_id ? { ...appointment, patientId, patientEmail: String(reservation.patient_email || appointment.patientEmail || ''), status: 'confirmed', paymentStatus: 'approved', paymentId } : appointment)
      : [...appointments, { ...confirmedAppointment, status: 'confirmed', paymentStatus: 'approved', paymentId }]
    const targetAppointment = existingAppointment ? { ...existingAppointment, patientId, patientEmail: String(reservation.patient_email || existingAppointment.patientEmail || '') } : confirmedAppointment
    const ledger = Array.isArray(workspace?.treatment_ledger_json) ? workspace.treatment_ledger_json : []
    const ledgerId = `mercadopago-${paymentId}`
    const nextLedger = ledger.some((entry: Record<string, unknown>) => entry.id === ledgerId)
      ? ledger
      : [...ledger, {
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
        }]
    let emailConfirmationSentAt: string | undefined
    if (reservation.patient_email && reservation.payment_status !== 'approved') {
      const { data: professional } = await admin.from('professionals').select('full_name, specialty').eq('id', reservation.professional_id).maybeSingle()
      const appointment = targetAppointment
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
            location: appointment?.location || 'Consultorio médico',
            notes: appointment?.notes || 'Pago aprobado por Mercado Pago.',
            amountToCharge: reservation.amount_to_charge,
            amountConcept: reservation.amount_concept || 'sena',
          },
        }),
      })
      if (emailResponse.ok) emailConfirmationSentAt = new Date().toISOString()
    }
    const appointmentsWithEmailStatus = emailConfirmationSentAt
      ? updated.map((appointment: Record<string, unknown>) => appointment.id === reservation.appointment_id ? { ...appointment, emailConfirmationSentAt } : appointment)
      : updated
    await admin.from('user_workspaces').upsert({ user_id: reservation.professional_id, patients_json: nextPatients, appointments_json: appointmentsWithEmailStatus, treatment_ledger_json: nextLedger }, { onConflict: 'user_id' })
  }
  return jsonResponse(200, { success: true, paymentStatus })
})
