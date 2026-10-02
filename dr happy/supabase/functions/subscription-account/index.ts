import { createClient } from 'jsr:@supabase/supabase-js@2'
import { corsHeaders } from '../_shared/cors.ts'
import { resolveProfessionalId } from '../_shared/professionalSession.ts'

Deno.serve(async (request) => {
  const respond = (status: number, body: Record<string, unknown>) =>
    new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (request.method !== 'POST') return respond(405, { success: false, message: 'Método no permitido.' })
  const url = Deno.env.get('SUPABASE_URL')
  const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  if (!url || !key) return respond(500, { success: false, message: 'Falta configuración del servidor.' })
  const admin = createClient(url, key, { auth: { persistSession: false } })
  const professionalId = await resolveProfessionalId(request, admin)
  if (!professionalId) return respond(401, { success: false, message: 'Sesión profesional requerida.' })
  const { data, error } = await admin.rpc('subscription_account', { p_professional_id: professionalId })
  if (error) return respond(500, { success: false, message: `No se pudo consultar la suscripción: ${error.message}` })
  return respond(200, { success: true, account: data })
})
