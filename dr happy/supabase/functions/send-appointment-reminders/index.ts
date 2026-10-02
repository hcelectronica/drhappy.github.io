import { serve } from 'https://deno.land/std@0.224.0/http/server.ts'
import { createClient } from 'jsr:@supabase/supabase-js@2'
import { corsHeaders } from '../_shared/cors.ts'
import { nightlyReminderDate, reminderMessage } from '../_shared/nightlyReminder.ts'

serve(async (request) => {
  const respond = (status: number, body: Record<string, unknown>) =>
    new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (request.method !== 'POST') return respond(405, { success: false, message: 'Método no permitido.' })
  const secret = Deno.env.get('APPOINTMENT_REMINDERS_CRON_SECRET')?.trim()
  if (!secret || request.headers.get('x-cron-secret')?.trim() !== secret) {
    return respond(401, { success: false, message: 'No autorizado.' })
  }
  const url = Deno.env.get('SUPABASE_URL')
  const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  if (!url || !key) return respond(500, { success: false, message: 'Falta configuración del servidor.' })
  const date = nightlyReminderDate(new Date())
  if (!date) return respond(200, { success: true, skipped: 'Fuera del horario nocturno de Argentina.' })
  const admin = createClient(url, key, { auth: { persistSession: false } })
  const { data: candidates, error } = await admin.rpc('nightly_reminder_candidates', { p_date: date })
  if (error) return respond(500, { success: false, message: error.message })
  let sent = 0
  let failed = 0
  let skipped = 0
  for (const candidate of candidates ?? []) {
    const { data: claim, error: claimError } = await admin.rpc('claim_nightly_reminder', {
      p_professional_id: candidate.professional_id, p_appointment_id: candidate.appointment_id, p_date: date,
    })
    if (claimError) return respond(500, { success: false, message: claimError.message, sent, failed })
    if (!claim) { skipped++; continue }
    const appointment = claim.appointment
    const text = reminderMessage(appointment, claim.professionalName)
    let status = 'unknown'
    let message: string | null = null
    try {
      const response = await fetch(`${url}/functions/v1/send-email`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
        body: JSON.stringify({
          to: appointment.patientEmail.trim(),
          subject: `Tu turno de mañana - ${appointment.scheduledTime} hs`,
          type: 'custom', text,
          templateData: { message: text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('\n', '<br>') },
        }),
      })
      const result = await response.json()
      status = response.ok && result.success ? 'sent' : 'failed'
      message = status === 'failed' ? String(result.message || `Error HTTP ${response.status}`) : null
    } catch (error) {
      message = error instanceof Error ? error.message : String(error)
    }
    const { error: recordError } = await admin.from('appointment_reminder_deliveries').update({
      status, sent_at: status === 'sent' ? new Date().toISOString() : null, error_message: message,
    }).eq('id', claim.deliveryId)
    if (recordError) return respond(500, { success: false, message: recordError.message, sent, failed })
    if (status === 'sent') sent++
    else {
      failed++
      console.error('[nightly-reminders] Envío no confirmado', { deliveryId: claim.deliveryId, status, message })
    }
  }
  return respond(failed ? 502 : 200, { success: failed === 0, date, sent, skipped, failed })
})
