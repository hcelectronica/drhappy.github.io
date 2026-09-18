import { corsHeaders } from '../_shared/cors.ts'
import { createClient } from 'jsr:@supabase/supabase-js@2'
import { resolveProfessionalId } from '../_shared/professionalSession.ts'

function jsonResponse(status: number, body: Record<string, unknown>): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (request.method !== 'POST') return jsonResponse(405, { success: false, message: 'Método no permitido.' })
  const url = Deno.env.get('SUPABASE_URL'); const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  if (!url || !key) return jsonResponse(500, { success: false, message: 'Falta configuración del servidor.' })
  const admin = createClient(url, key, { auth: { persistSession: false } })
  const professionalId = await resolveProfessionalId(request, admin)
  if (!professionalId) return jsonResponse(401, { success: false, message: 'Sesión profesional requerida.' })
  let body: Record<string, unknown> = {}
  try { body = await request.json() } catch { /* list defaults */ }
  if (body.action === 'profile-update') {
    const profile = body.profile && typeof body.profile === 'object' ? body.profile as Record<string, unknown> : {}
    const { error } = await admin.from('professionals').update({ full_name: profile.fullName, specialty: profile.specialty, license_number: profile.licenseNumber, email: profile.email, dni: profile.dni ?? null, network_memberships_json: profile.networkMemberships ?? [], last_seen_at: new Date().toISOString() }).eq('id', professionalId)
    return error ? jsonResponse(500, { success: false, message: error.message }) : jsonResponse(200, { success: true })
  }
  if (body.action === 'get-one') {
    const { data, error } = await admin.from('professionals').select('id, username, full_name, specialty, license_number, dni, email, network_memberships_json, is_admin, active, enabled_modules_json, trial_started_at, subscription_status, subscription_expires_at').eq('id', professionalId).maybeSingle()
    return error ? jsonResponse(500, { success: false, message: error.message }) : jsonResponse(200, { success: true, professional: data })
  }
  const { data, error } = await admin.from('professionals').select('id, username, full_name, specialty, license_number, dni, email, network_memberships_json, is_admin, active, enabled_modules_json, trial_started_at, subscription_status, subscription_expires_at').eq('active', true).order('full_name', { ascending: true })
  return error ? jsonResponse(500, { success: false, message: error.message }) : jsonResponse(200, { success: true, professionals: data || [] })
})
