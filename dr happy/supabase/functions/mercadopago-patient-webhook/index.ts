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
  const { data: account } = await admin.from('professional_payment_accounts').select('professional_id, access_token_encrypted, status').eq('provider', 'mercadopago').eq('provider_user_id', providerUserId).maybeSingle()
  if (!account || account.status !== 'connected') return jsonResponse(500, { success: false, message: 'Cuenta Mercado Pago del profesional no disponible.' })
  const accessToken = await decryptToken(account.access_token_encrypted)
  const paymentResponse = await fetch(`https://api.mercadopago.com/v1/payments/${encodeURIComponent(paymentId)}`, { headers: { Authorization: `Bearer ${accessToken}` } })
  const payment = await paymentResponse.json().catch(() => null)
  if (!paymentResponse.ok || !payment) return jsonResponse(502, { success: false, message: 'No se pudo validar el pago.' })
  const externalReference = String(payment.external_reference || '').trim()
  const { data: reservation } = await admin.from('public_booking_reservations').select('id, appointment_id, professional_id, patient_name, patient_email, patient_phone, slot_date, slot_time, amount_to_charge, amount_concept, payment_status').eq('professional_id', account.professional_id).eq('appointment_id', externalReference).maybeSingle()
  if (!reservation) return jsonResponse(200, { success: true, ignored: true })

  const paymentStatus = String(payment.status || 'pending')
  const approved = paymentStatus === 'approved'
  await admin.from('public_booking_reservations').update({ payment_status: paymentStatus, status: approved ? 'confirmed' : 'pending_payment' }).eq('id', reservation.id)
  if (approved && reservation.appointment_id) {
    const { data: workspace } = await admin.from('user_workspaces').select('appointments_json').eq('user_id', reservation.professional_id).maybeSingle()
    const appointments = Array.isArray(workspace?.appointments_json) ? workspace.appointments_json : []
    const updated = appointments.map((appointment: Record<string, unknown>) => appointment.id === reservation.appointment_id ? { ...appointment, status: 'confirmed', paymentStatus: 'approved', paymentId } : appointment)
    await admin.from('user_workspaces').upsert({ user_id: reservation.professional_id, appointments_json: updated }, { onConflict: 'user_id' })
    if (reservation.patient_email && reservation.payment_status !== 'approved') {
      const { data: professional } = await admin.from('professionals').select('full_name, specialty').eq('id', reservation.professional_id).maybeSingle()
      const appointment = updated.find((item: Record<string, unknown>) => item.id === reservation.appointment_id) as Record<string, unknown> | undefined
      await fetch(`${supabaseUrl}/functions/v1/send-email`, {
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
    }
  }
  return jsonResponse(200, { success: true, paymentStatus })
})
