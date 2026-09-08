import { serve } from 'https://deno.land/std@0.224.0/http/server.ts'
import { createClient } from 'jsr:@supabase/supabase-js@2'
import { corsHeaders } from '../_shared/cors.ts'

// Métricas de uso por usuario para el panel de administración.
// IMPORTANTÍSIMO: esta función devuelve SOLO estadísticas agregadas
// (conteos y fechas). Jamás devuelve nombres de pacientes, diagnósticos,
// ni ningún dato clínico — no vulnera la intimidad de nadie.
//
// Solo un usuario administrador puede invocarla: verificamos que el
// requesterId exista en professionals con is_admin = true.

interface RequestBody {
  action: 'user-stats'
  requesterId?: string
}

function jsonResponse(status: number, body: Record<string, unknown>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

serve(async (request) => {
  if (request.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }
  if (request.method !== 'POST') {
    return jsonResponse(405, { success: false, message: 'Método no permitido.' })
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL')
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  if (!supabaseUrl || !serviceRoleKey) {
    return jsonResponse(500, { success: false, message: 'Falta configuración del servidor.' })
  }
  const admin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false },
  })

  let body: RequestBody
  try {
    body = await request.json()
  } catch {
    return jsonResponse(400, { success: false, message: 'Cuerpo JSON inválido.' })
  }

  try {
    if (body.action !== 'user-stats') {
      return jsonResponse(400, { success: false, message: 'Acción no soportada.' })
    }

    const requesterId = body.requesterId?.trim()
    if (!requesterId) {
      return jsonResponse(400, { success: false, message: 'Falta el identificador del solicitante.' })
    }

    // Verificación de que quien pide las métricas es administrador.
    const { data: requester, error: requesterError } = await admin
      .from('professionals')
      .select('id, is_admin')
      .eq('id', requesterId)
      .maybeSingle()
    if (requesterError || !requester || requester.is_admin !== true) {
      return jsonResponse(403, { success: false, message: 'Solo el administrador puede ver estas métricas.' })
    }

    // Datos de profesionales (sin hashes ni contraseñas).
    const { data: professionals, error: professionalsError } = await admin
      .from('professionals')
      .select('id, username, full_name, email, specialty, active, trial_started_at, subscription_status, subscription_expires_at, last_seen_at, created_at')
      .order('full_name', { ascending: true })
    if (professionalsError) {
      return jsonResponse(500, { success: false, message: professionalsError.message })
    }

    // Workspaces: contamos pacientes y turnos por usuario (solo length de los arrays JSON).
    const { data: workspaces, error: workspacesError } = await admin
      .from('user_workspaces')
      .select('user_id, patients_json, appointments_json')
    if (workspacesError) {
      return jsonResponse(500, { success: false, message: workspacesError.message })
    }

    const statsByUser: Record<string, { patientsCount: number; appointmentsCount: number; lastAppointmentDate: string | null }> = {}
    for (const ws of workspaces ?? []) {
      const patients = Array.isArray(ws.patients_json) ? ws.patients_json : []
      const appointments = Array.isArray(ws.appointments_json) ? ws.appointments_json : []
      let lastAppointmentDate: string | null = null
      for (const appt of appointments) {
        const scheduledAt = typeof appt?.scheduledAt === 'string' ? appt.scheduledAt : null
        if (scheduledAt && (!lastAppointmentDate || scheduledAt > lastAppointmentDate)) {
          lastAppointmentDate = scheduledAt
        }
      }
      statsByUser[ws.user_id] = {
        patientsCount: patients.length,
        appointmentsCount: appointments.length,
        lastAppointmentDate,
      }
    }

    const users = (professionals ?? []).map((p) => ({
      id: p.id,
      username: p.username,
      fullName: p.full_name,
      email: p.email,
      specialty: p.specialty,
      active: p.active,
      subscriptionStatus: p.subscription_status,
      subscriptionExpiresAt: p.subscription_expires_at,
      trialStartedAt: p.trial_started_at,
      createdAt: p.created_at,
      lastSeenAt: p.last_seen_at,
      patientsCount: statsByUser[p.id]?.patientsCount ?? 0,
      appointmentsCount: statsByUser[p.id]?.appointmentsCount ?? 0,
      lastAppointmentDate: statsByUser[p.id]?.lastAppointmentDate ?? null,
    }))

    return jsonResponse(200, { success: true, users })
  } catch (error) {
    return jsonResponse(500, {
      success: false,
      message: error instanceof Error ? error.message : 'Error inesperado en el servidor.',
    })
  }
})
