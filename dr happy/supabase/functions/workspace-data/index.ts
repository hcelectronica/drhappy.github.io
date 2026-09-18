import { corsHeaders } from '../_shared/cors.ts'
import { createClient } from 'jsr:@supabase/supabase-js@2'
import { resolveProfessionalId } from '../_shared/professionalSession.ts'

function jsonResponse(status: number, body: Record<string, unknown>): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (request.method !== 'POST') return jsonResponse(405, { success: false, message: 'Método no permitido.' })
  const supabaseUrl = Deno.env.get('SUPABASE_URL')
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  if (!supabaseUrl || !serviceRoleKey) return jsonResponse(500, { success: false, message: 'Falta configuración del servidor.' })
  const admin = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false } })
  const professionalId = await resolveProfessionalId(request, admin)
  if (!professionalId) return jsonResponse(401, { success: false, message: 'Sesión profesional requerida.' })

  let body: Record<string, unknown>
  try { body = await request.json() } catch { return jsonResponse(400, { success: false, message: 'Cuerpo JSON inválido.' }) }
  if (body.action === 'load') {
    const [{ data: workspace, error: workspaceError }, { data: professional, error: professionalError }] = await Promise.all([
      admin.from('user_workspaces').select('user_id, profile_json, patients_json, appointments_json, treatment_ledger_json').eq('user_id', professionalId).maybeSingle(),
      admin.from('professionals').select('id, username, full_name, specialty, license_number, dni, email, network_memberships_json, is_admin, active, enabled_modules_json, trial_started_at, subscription_status, subscription_expires_at').eq('id', professionalId).maybeSingle(),
    ])
    if (workspaceError || professionalError) return jsonResponse(500, { success: false, message: workspaceError?.message || professionalError?.message })
    return jsonResponse(200, { success: true, professional, workspace })
  }
  if (body.action === 'save') {
    const profile = body.profile && typeof body.profile === 'object' ? body.profile : {}
    const patients = Array.isArray(body.patients) ? body.patients : []
    const appointments = Array.isArray(body.appointments) ? body.appointments : []
    const treatmentLedger = Array.isArray(body.treatmentLedger) ? body.treatmentLedger : []
    const { error } = await admin.from('user_workspaces').upsert({ user_id: professionalId, profile_json: profile, patients_json: patients, appointments_json: appointments, treatment_ledger_json: treatmentLedger }, { onConflict: 'user_id' })
    if (error) return jsonResponse(500, { success: false, message: error.message })
    return jsonResponse(200, { success: true })
  }
  return jsonResponse(400, { success: false, message: 'Acción no soportada.' })
})
