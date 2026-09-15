import { serve } from 'https://deno.land/std@0.224.0/http/server.ts'
import { createClient } from 'jsr:@supabase/supabase-js@2'
import { corsHeaders } from '../_shared/cors.ts'

interface Appointment {
  id?: string
  patientName?: string
  patientEmail?: string
  scheduledDate?: string
  scheduledTime?: string
  scheduledAt?: string
  reason?: string
  location?: string
  status?: string
  reminder24hSentAt?: string
  reminder2hSentAt?: string
}

interface WorkspaceRow {
  user_id: string
  profile_json: unknown
  appointments_json: unknown
}

function jsonResponse(status: number, body: Record<string, unknown>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

function parseAppointmentDate(appointment: Appointment): Date | null {
  const rawValue = appointment.scheduledAt ||
    (appointment.scheduledDate && appointment.scheduledTime
      ? `${appointment.scheduledDate}T${appointment.scheduledTime}:00`
      : '')
  // La Turnera guarda horarios locales de Argentina sin offset.
  const value = rawValue && !/[zZ]|[+-]\d{2}:?\d{2}$/.test(rawValue)
    ? `${rawValue}-03:00`
    : rawValue
  if (!value) return null
  const parsed = new Date(value)
  return Number.isNaN(parsed.getTime()) ? null : parsed
}

function profileEmail(profile: unknown): string {
  if (!profile || typeof profile !== 'object') return ''
  const email = (profile as { email?: unknown }).email
  return typeof email === 'string' ? email.trim() : ''
}

serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (request.method !== 'POST') return jsonResponse(405, { success: false, message: 'Método no permitido.' })

  const cronSecret = Deno.env.get('APPOINTMENT_REMINDERS_CRON_SECRET')?.trim()
  const requestSecret = request.headers.get('x-cron-secret')?.trim()
  if (!cronSecret || requestSecret !== cronSecret) {
    return jsonResponse(401, { success: false, message: 'No autorizado.' })
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL')
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  if (!supabaseUrl || !serviceRoleKey) return jsonResponse(500, { success: false, message: 'Falta configuración del servidor.' })

  const admin = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false } })
  const now = Date.now()
  const windows = [
    { key: 'reminder24hSentAt' as const, label: '24 horas', targetMs: 24 * 60 * 60 * 1000 },
    { key: 'reminder2hSentAt' as const, label: '2 horas', targetMs: 2 * 60 * 60 * 1000 },
  ]
  let sent = 0
  let skipped = 0
  let failed = 0

  const { data: workspaces, error: workspaceError } = await admin
    .from('user_workspaces')
    .select('user_id, profile_json, appointments_json')
  if (workspaceError) return jsonResponse(500, { success: false, message: workspaceError.message })

  for (const workspace of (workspaces ?? []) as WorkspaceRow[]) {
    const appointments = Array.isArray(workspace.appointments_json)
      ? workspace.appointments_json as Appointment[]
      : []
    const profile = profileEmail(workspace.profile_json)
    let changed = false

    for (const appointment of appointments) {
      if (!appointment.id || !appointment.patientEmail?.trim() || appointment.status === 'cancelled') {
        skipped++
        continue
      }
      const appointmentAt = parseAppointmentDate(appointment)?.getTime()
      if (!appointmentAt || appointmentAt <= now) {
        skipped++
        continue
      }

      for (const window of windows) {
        if (appointment[window.key]) continue
        const difference = appointmentAt - now
        if (difference < window.targetMs - 10 * 60 * 1000 || difference > window.targetMs + 10 * 60 * 1000) continue

        const dateLabel = appointment.scheduledDate ?? new Date(appointmentAt).toLocaleDateString('es-AR')
        const timeLabel = appointment.scheduledTime ?? new Date(appointmentAt).toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' })
        const emailResponse = await fetch(`${supabaseUrl}/functions/v1/send-email`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${serviceRoleKey}` },
          body: JSON.stringify({
            to: appointment.patientEmail.trim(),
            subject: `Recordatorio de turno - ${dateLabel} a las ${timeLabel}`,
            type: 'custom',
            text: `Hola ${appointment.patientName ?? ''}. Te recordamos tu turno para ${dateLabel} a las ${timeLabel}. ${appointment.location ? `Lugar: ${appointment.location}. ` : ''}${appointment.reason ? `Motivo: ${appointment.reason}. ` : ''}${profile ? `Profesional: ${profile}.` : ''}`,
          }),
        })
        const result = await emailResponse.json().catch(() => null)
        if (!emailResponse.ok || !result?.success) {
          failed++
          continue
        }

        appointment[window.key] = new Date().toISOString()
        changed = true
        sent++
      }
    }

    if (changed) {
      const { error } = await admin
        .from('user_workspaces')
        .update({ appointments_json: appointments })
        .eq('user_id', workspace.user_id)
      if (error) return jsonResponse(500, { success: false, message: error.message, sent, failed })
    }
  }

  return jsonResponse(200, { success: true, sent, skipped, failed })
})
