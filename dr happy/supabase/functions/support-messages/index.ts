import { serve } from 'https://deno.land/std@0.224.0/http/server.ts'
import { createClient } from 'jsr:@supabase/supabase-js@2'
import { corsHeaders } from '../_shared/cors.ts'
import { resolveProfessionalId } from '../_shared/professionalSession.ts'

const MAX_MESSAGE_LENGTH = 300
const PER_EMAIL_LIMIT = 3
const PER_EMAIL_WINDOW_MS = 10 * 60 * 1000
const GLOBAL_LIMIT = 30
const GLOBAL_WINDOW_MS = 60 * 1000

type RequestBody = {
  action?: 'send' | 'list' | 'set-status' | 'delete'
  name?: string
  email?: string
  message?: string
  website?: string
  id?: string
  status?: 'pending' | 'read'
}

function jsonResponse(status: number, body: Record<string, unknown>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

// Deja solo texto plano en una línea por párrafo: sin caracteres de control ni marcas HTML.
function toPlainText(value: unknown, maxLength: number): string {
  return String(value ?? '')
    .replace(/<[^>]*>/g, '')
    .replace(/[\u0000-\u0009\u000B-\u001F\u007F]/g, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
    .slice(0, maxLength)
}

serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (request.method !== 'POST') return jsonResponse(405, { success: false, message: 'Método no permitido.' })

  const supabaseUrl = Deno.env.get('SUPABASE_URL')
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  if (!supabaseUrl || !serviceRoleKey) return jsonResponse(500, { success: false, message: 'Falta configuración del servidor.' })
  const admin = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false } })

  let body: RequestBody
  try {
    body = await request.json()
  } catch {
    return jsonResponse(400, { success: false, message: 'Cuerpo JSON inválido.' })
  }

  if (body.action === 'send') {
    // Campo trampa: las personas no lo ven; si viene completo es un bot.
    if (typeof body.website === 'string' && body.website.trim()) {
      return jsonResponse(200, { success: true })
    }

    const name = toPlainText(body.name, 80).replace(/\s+/g, ' ')
    const email = toPlainText(body.email, 160).toLowerCase()
    const message = toPlainText(body.message, MAX_MESSAGE_LENGTH + 1)

    if (!name) return jsonResponse(400, { success: false, message: 'Ingresá tu nombre.' })
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return jsonResponse(400, { success: false, message: 'Ingresá un email válido.' })
    if (!message) return jsonResponse(400, { success: false, message: 'Escribí tu mensaje.' })
    if (message.length > MAX_MESSAGE_LENGTH) {
      return jsonResponse(400, { success: false, message: `El mensaje no puede superar los ${MAX_MESSAGE_LENGTH} caracteres.` })
    }

    const now = Date.now()
    const { count: emailCount } = await admin
      .from('support_messages')
      .select('id', { count: 'exact', head: true })
      .eq('email', email)
      .gte('created_at', new Date(now - PER_EMAIL_WINDOW_MS).toISOString())
    if ((emailCount ?? 0) >= PER_EMAIL_LIMIT) {
      return jsonResponse(429, { success: false, message: 'Ya recibimos tus mensajes. Esperá unos minutos antes de enviar otro.' })
    }
    const { count: globalCount } = await admin
      .from('support_messages')
      .select('id', { count: 'exact', head: true })
      .gte('created_at', new Date(now - GLOBAL_WINDOW_MS).toISOString())
    if ((globalCount ?? 0) >= GLOBAL_LIMIT) {
      return jsonResponse(429, { success: false, message: 'Hay muchos mensajes en este momento. Probá de nuevo en un minuto.' })
    }

    const professionalId = await resolveProfessionalId(request, admin)
    const { error } = await admin.from('support_messages').insert({
      name,
      email,
      message,
      professional_id: professionalId,
    })
    if (error) return jsonResponse(500, { success: false, message: 'No se pudo enviar el mensaje. Probá de nuevo.' })
    return jsonResponse(200, { success: true })
  }

  const requesterId = await resolveProfessionalId(request, admin)
  if (!requesterId) return jsonResponse(401, { success: false, message: 'Sesión profesional requerida.' })
  const { data: requester } = await admin
    .from('professionals')
    .select('is_admin, active')
    .eq('id', requesterId)
    .maybeSingle()
  if (!requester || requester.is_admin !== true || requester.active === false) {
    return jsonResponse(403, { success: false, message: 'Solo un administrador puede ver los mensajes de soporte.' })
  }

  if (body.action === 'list') {
    const { data, error } = await admin
      .from('support_messages')
      .select('id, name, email, message, professional_id, status, created_at')
      .order('created_at', { ascending: false })
      .limit(200)
    if (error) return jsonResponse(500, { success: false, message: error.message })
    return jsonResponse(200, { success: true, messages: data ?? [] })
  }

  const id = typeof body.id === 'string' ? body.id.trim() : ''
  if (!id) return jsonResponse(400, { success: false, message: 'Falta el mensaje.' })

  if (body.action === 'set-status') {
    if (body.status !== 'pending' && body.status !== 'read') {
      return jsonResponse(400, { success: false, message: 'Estado inválido.' })
    }
    const { error } = await admin.from('support_messages').update({ status: body.status }).eq('id', id)
    if (error) return jsonResponse(500, { success: false, message: error.message })
    return jsonResponse(200, { success: true })
  }

  if (body.action === 'delete') {
    const { error } = await admin.from('support_messages').delete().eq('id', id)
    if (error) return jsonResponse(500, { success: false, message: error.message })
    return jsonResponse(200, { success: true })
  }

  return jsonResponse(400, { success: false, message: 'Acción no reconocida.' })
})
