import { serve } from 'https://deno.land/std@0.224.0/http/server.ts'
import { createClient } from 'jsr:@supabase/supabase-js@2'
import { createProfessionalSession, resolveProfessionalId } from '../_shared/professionalSession.ts'
import { corsHeaders } from '../_shared/cors.ts'

const reply = (status: number, body: Record<string, unknown>) => new Response(JSON.stringify(body), {
  status,
  headers: { ...corsHeaders, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
})
async function hash(value: string): Promise<string> {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))
  return Array.from(new Uint8Array(bytes), byte => byte.toString(16).padStart(2, '0')).join('')
}
serve(async request => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (request.method !== 'POST') return reply(405, { error: 'Metodo no permitido.' })
  let body: unknown
  try { body = await request.json() }
  catch { return reply(400, { error: 'Solicitud JSON invalida.' }) }
  if (!body || typeof body !== 'object' || !('action' in body)) return reply(400, { error: 'Accion requerida.' })
  const url = Deno.env.get('SUPABASE_URL')
  const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  if (!url || !key) return reply(503, { error: 'Autorizacion no configurada.' })
  try {
    const admin = createClient(url, key, { auth: { persistSession: false } })
    if (body.action === 'create') {
      const session = request.headers.get('x-drhappy-session')?.trim()
      if (!session || session.length > 256) return reply(401, { error: 'Volve a iniciar sesion en Dr Happy.' })
      const id = await resolveProfessionalId(request, admin)
      if (!id) return reply(401, { error: 'La sesion de Dr Happy vencio. Volve a iniciar sesion.' })
      const { data, error } = await admin.from('professionals').select('is_admin, active').eq('id', id).maybeSingle()
      if (error) throw error
      if (data?.is_admin !== true || data.active === false) return reply(403, { error: 'El piloto es exclusivo para administradores.' })
      const token = Array.from(crypto.getRandomValues(new Uint8Array(32)), byte => byte.toString(16).padStart(2, '0')).join('')
      const { data: issued, error: issueError } = await admin.rpc('issue_video_handoff', {
        p_token_hash: await hash(token), p_source_hash: await hash(session),
      })
      if (issueError) throw issueError
      if (issued !== true) return reply(401, { error: 'La sesion ya no tiene permiso para abrir la videoconsulta.' })
      return reply(200, { token, expiresInSeconds: 60 })
    }
    if (body.action === 'exchange') {
      if (!('token' in body) || typeof body.token !== 'string' || !/^[a-f0-9]{64}$/.test(body.token)) {
        return reply(400, { error: 'Pase temporal invalido.' })
      }
      const { data: id, error } = await admin.rpc('consume_video_handoff', { p_token_hash: await hash(body.token) })
      if (error) throw error
      if (typeof id !== 'string' || !id) return reply(401, { error: 'El pase vencio, ya se uso o perdio su permiso. Abri la videoconsulta nuevamente desde Dr Happy.' })
      const sessionToken = await createProfessionalSession(admin, id)
      return reply(200, { sessionToken })
    }
    return reply(400, { error: 'Accion no reconocida.' })
  } catch (error) {
    console.error('video-handoff: fallo de autorizacion', error instanceof Error ? error.message : 'Error de base de datos')
    return reply(503, { error: 'No se pudo preparar el acceso a videoconsulta. Reintenta desde Dr Happy.' })
  }
})
