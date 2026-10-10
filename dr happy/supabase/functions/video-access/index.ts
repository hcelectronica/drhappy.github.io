import { serve } from 'https://deno.land/std@0.224.0/http/server.ts'
import { createClient } from 'jsr:@supabase/supabase-js@2'
import { resolveProfessionalId } from '../_shared/professionalSession.ts'
import { corsHeaders } from '../_shared/cors.ts'
import { hasMedicalToolRowAccess, MEDICAL_TOOL_ACCESS_COLUMNS } from '../_shared/medicalToolAccess.ts'

const reply = (status: number, body: Record<string, unknown>) => new Response(JSON.stringify(body), {
  status,
  headers: { ...corsHeaders, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
})

serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (request.method !== 'POST') return reply(405, { error: 'Metodo no permitido.' })
  const url = Deno.env.get('SUPABASE_URL')
  const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  if (!url || !key) return reply(503, { error: 'Autorizacion no configurada.' })
  try {
    const admin = createClient(url, key, { auth: { persistSession: false } })
    const id = await resolveProfessionalId(request, admin)
    if (!id) return reply(401, { error: 'La sesion vencio o no es valida. Volve a iniciar sesion.' })
    const { data, error } = await admin.from('professionals')
      .select(MEDICAL_TOOL_ACCESS_COLUMNS).eq('id', id).maybeSingle()
    if (error) throw error
    if (!hasMedicalToolRowAccess(data)) {
      return reply(403, { error: 'La videoconsulta requiere acceso medico vigente y el modulo de atencion habilitado.' })
    }
    return reply(200, { id: data.id })
  } catch (error) {
    console.error('video-access: fallo de validacion', error instanceof Error ? error.message : 'Error de base de datos')
    return reply(503, { error: 'No se pudo comprobar el permiso de videoconsulta. Reintenta.' })
  }
})
