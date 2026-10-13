import { serve } from 'https://deno.land/std@0.224.0/http/server.ts'
import { createClient } from 'jsr:@supabase/supabase-js@2'
import { corsHeaders } from '../_shared/cors.ts'
import { resolveProfessionalId } from '../_shared/professionalSession.ts'

// Métricas de uso por usuario para el panel de administración.
// IMPORTANTÍSIMO: esta función devuelve SOLO estadísticas agregadas
// (conteos y fechas). Jamás devuelve nombres de pacientes, diagnósticos,
// ni ningún dato clínico — no vulnera la intimidad de nadie.
//
// Solo un usuario administrador puede invocarla: verificamos que el
// requesterId exista en professionals con is_admin = true.

interface RequestBody {
  action: 'user-stats' | 'ai-usage'
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
    if (body.action !== 'user-stats' && body.action !== 'ai-usage') {
      return jsonResponse(400, { success: false, message: 'Acción no soportada.' })
    }

    const requesterId = await resolveProfessionalId(request, admin)
    if (!requesterId) return jsonResponse(401, { success: false, message: 'Sesión profesional requerida.' })

    // Verificación de que quien pide las métricas es administrador.
    const { data: requester, error: requesterError } = await admin
      .from('professionals')
      .select('id, is_admin')
      .eq('id', requesterId)
      .maybeSingle()
    if (requesterError || !requester || requester.is_admin !== true) {
      return jsonResponse(403, { success: false, message: 'Solo el administrador puede ver estas métricas.' })
    }

    if (body.action === 'ai-usage') {
      const [{ data: usageEvents, error: usageError }, { data: professionals, error: professionalsError }] = await Promise.all([
        admin.from('ai_usage_events').select('professional_id, input_tokens, output_tokens, total_tokens, estimated_cost_usd, created_at'),
        admin.from('professionals').select('id, full_name, username'),
      ])
      if (usageError || professionalsError) {
        return jsonResponse(500, { success: false, message: usageError?.message || professionalsError?.message })
      }
      const names = new Map((professionals ?? []).map((professional) => [professional.id, professional]))
      const usageByProfessional = new Map<string, { requests: number; inputTokens: number; outputTokens: number; totalTokens: number; estimatedCostUsd: number; lastUsedAt: string | null }>()
      for (const event of usageEvents ?? []) {
        if (!names.has(event.professional_id)) continue
        const current = usageByProfessional.get(event.professional_id) ?? { requests: 0, inputTokens: 0, outputTokens: 0, totalTokens: 0, estimatedCostUsd: 0, lastUsedAt: null }
        current.requests += 1
        current.inputTokens += Number(event.input_tokens || 0)
        current.outputTokens += Number(event.output_tokens || 0)
        current.totalTokens += Number(event.total_tokens || 0)
        current.estimatedCostUsd += Number(event.estimated_cost_usd || 0)
        if (!current.lastUsedAt || String(event.created_at) > current.lastUsedAt) current.lastUsedAt = event.created_at
        usageByProfessional.set(event.professional_id, current)
      }
      const usage = Array.from(usageByProfessional.entries()).map(([professionalId, values]) => ({
        professionalId,
        fullName: names.get(professionalId)!.full_name,
        username: names.get(professionalId)!.username,
        ...values,
      })).sort((left, right) => right.estimatedCostUsd - left.estimatedCostUsd)
      return jsonResponse(200, {
        success: true,
        usage,
        total: usage.reduce((total, item) => ({
          requests: total.requests + item.requests,
          tokens: total.tokens + item.totalTokens,
          costUsd: total.costUsd + item.estimatedCostUsd,
        }), { requests: 0, tokens: 0, costUsd: 0 }),
      })
    }

    // Datos de profesionales (sin hashes ni contraseñas).
    const { data: professionals, error: professionalsError } = await admin
      .from('professionals')
      .select('id, username, full_name, email, specialty, active, trial_started_at, subscription_status, subscription_expires_at, last_seen_at, created_at')
      .order('full_name', { ascending: true })
    if (professionalsError) {
      return jsonResponse(500, { success: false, message: professionalsError.message })
    }

    // Workspaces: contamos pacientes, turnos y registros clínicos (solo length de arrays JSON).
    const { data: workspaces, error: workspacesError } = await admin
      .from('user_workspaces')
      .select('user_id, patients_json, appointments_json')
    if (workspacesError) {
      return jsonResponse(500, { success: false, message: workspacesError.message })
    }

    // Telemetría de actividad diaria de los últimos 30 días (escalable para cientos de profesionales)
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)
    const todayStr = new Date().toISOString().slice(0, 10)

    let dailyActivities: Array<{
      professional_id: string
      activity_date: string
      active_minutes: number
      consultations_count: number
      prescriptions_count: number
      certificates_count: number
      appointments_count: number
      patients_created_count: number
      last_heartbeat_at: string | null
    }> = []

    try {
      const { data: activities, error: actError } = await admin
        .from('professional_daily_activity')
        .select('professional_id, activity_date, active_minutes, consultations_count, prescriptions_count, certificates_count, appointments_count, patients_created_count, last_heartbeat_at')
        .gte('activity_date', thirtyDaysAgo)
      if (!actError && Array.isArray(activities)) {
        dailyActivities = activities
      }
    } catch {
      dailyActivities = []
    }

    const statsByUser: Record<string, {
      patientsCount: number
      appointmentsCount: number
      consultationsCount: number
      prescriptionsCount: number
      lastAppointmentDate: string | null
    }> = {}

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
      let consultationsCount = 0
      let prescriptionsCount = 0
      for (const p of patients) {
        if (p && typeof p === 'object') {
          if (Array.isArray(p.consultations)) consultationsCount += p.consultations.length
          if (Array.isArray(p.prescriptions)) prescriptionsCount += p.prescriptions.length
        }
      }
      statsByUser[ws.user_id] = {
        patientsCount: patients.length,
        appointmentsCount: appointments.length,
        consultationsCount,
        prescriptionsCount,
        lastAppointmentDate,
      }
    }

    interface UserDailyAggregates {
      activeMinutesToday: number
      activeMinutes7d: number
      activeMinutes30d: number
      consultations7d: number
      prescriptions7d: number
      lastHeartbeatAt: string | null
    }

    const activityByProf: Record<string, UserDailyAggregates> = {}

    for (const act of dailyActivities) {
      const pid = act.professional_id
      if (!activityByProf[pid]) {
        activityByProf[pid] = {
          activeMinutesToday: 0,
          activeMinutes7d: 0,
          activeMinutes30d: 0,
          consultations7d: 0,
          prescriptions7d: 0,
          lastHeartbeatAt: null,
        }
      }
      const agg = activityByProf[pid]
      const mins = Number(act.active_minutes || 0)
      agg.activeMinutes30d += mins
      if (act.activity_date >= sevenDaysAgo) {
        agg.activeMinutes7d += mins
        agg.consultations7d += Number(act.consultations_count || 0)
        agg.prescriptions7d += Number(act.prescriptions_count || 0)
      }
      if (act.activity_date === todayStr) {
        agg.activeMinutesToday += mins
      }
      if (act.last_heartbeat_at && (!agg.lastHeartbeatAt || act.last_heartbeat_at > agg.lastHeartbeatAt)) {
        agg.lastHeartbeatAt = act.last_heartbeat_at
      }
    }

    const nowMs = Date.now()
    const fiveMinutesMs = 5 * 60 * 1000

    const users = (professionals ?? []).map((p) => {
      const userStats = statsByUser[p.id] ?? {
        patientsCount: 0,
        appointmentsCount: 0,
        consultationsCount: 0,
        prescriptionsCount: 0,
        lastAppointmentDate: null,
      }
      const act = activityByProf[p.id] ?? {
        activeMinutesToday: 0,
        activeMinutes7d: 0,
        activeMinutes30d: 0,
        consultations7d: 0,
        prescriptions7d: 0,
        lastHeartbeatAt: null,
      }

      let latestSeen = p.last_seen_at
      if (act.lastHeartbeatAt && (!latestSeen || act.lastHeartbeatAt > latestSeen)) {
        latestSeen = act.lastHeartbeatAt
      }

      const isOnline = Boolean(latestSeen && (nowMs - new Date(latestSeen).getTime()) <= fiveMinutesMs)

      let adoptionLevel: 'alta' | 'media' | 'baja' | 'sin_uso' = 'sin_uso'
      if (act.activeMinutes7d >= 60 || userStats.patientsCount >= 10 || userStats.consultationsCount >= 15) {
        adoptionLevel = 'alta'
      } else if (act.activeMinutes7d >= 15 || userStats.patientsCount >= 3 || userStats.consultationsCount >= 3) {
        adoptionLevel = 'media'
      } else if (userStats.patientsCount > 0 || userStats.appointmentsCount > 0 || act.activeMinutes30d > 0) {
        adoptionLevel = 'baja'
      }

      return {
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
        lastSeenAt: latestSeen,
        isOnline,
        patientsCount: userStats.patientsCount,
        appointmentsCount: userStats.appointmentsCount,
        consultationsCount: userStats.consultationsCount,
        prescriptionsCount: userStats.prescriptionsCount,
        lastAppointmentDate: userStats.lastAppointmentDate,
        activeMinutesToday: act.activeMinutesToday,
        activeMinutes7d: act.activeMinutes7d,
        activeMinutes30d: act.activeMinutes30d,
        consultations7d: act.consultations7d,
        prescriptions7d: act.prescriptions7d,
        adoptionLevel,
      }
    })

    const summary = {
      totalProfessionals: users.length,
      onlineCount: users.filter((u) => u.isOnline).length,
      weeklyActiveCount: users.filter((u) => u.activeMinutes7d > 0 || (u.lastSeenAt && (nowMs - new Date(u.lastSeenAt).getTime()) <= 7 * 24 * 60 * 60 * 1000)).length,
      totalPatientsManaged: users.reduce((acc, u) => acc + u.patientsCount, 0),
      totalAppointments: users.reduce((acc, u) => acc + u.appointmentsCount, 0),
      totalConsultations: users.reduce((acc, u) => acc + u.consultationsCount, 0),
      totalActiveMinutes7d: users.reduce((acc, u) => acc + u.activeMinutes7d, 0),
    }

    return jsonResponse(200, { success: true, users, summary })
  } catch (error) {
    return jsonResponse(500, {
      success: false,
      message: error instanceof Error ? error.message : 'Error inesperado en el servidor.',
    })
  }
})
