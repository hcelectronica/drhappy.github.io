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
  let body: Record<string, unknown>
  try { body = await request.json() } catch { return jsonResponse(400, { success: false, message: 'Cuerpo JSON inválido.' }) }
  const action = String(body.action || '')
  if (action === 'thread') {
    const memberId = typeof body.memberId === 'string' ? body.memberId.trim() : ''
    if (!memberId) return jsonResponse(400, { success: false, message: 'Falta el destinatario.' })
    const { data, error } = await admin.from('community_messages').select('id, sender_id, recipient_id, text, attachments_json, sent_at').or(`and(sender_id.eq.${professionalId},recipient_id.eq.${memberId}),and(sender_id.eq.${memberId},recipient_id.eq.${professionalId})`).order('sent_at', { ascending: true })
    return error ? jsonResponse(500, { success: false, message: error.message }) : jsonResponse(200, { success: true, messages: data || [] })
  }
  if (action === 'unread') {
    const { data, error } = await admin.from('community_messages').select('id, sender_id, recipient_id, text, sent_at').eq('recipient_id', professionalId).order('sent_at', { ascending: true })
    return error ? jsonResponse(500, { success: false, message: error.message }) : jsonResponse(200, { success: true, messages: data || [] })
  }
  if (action === 'send') {
    const recipientId = typeof body.recipientId === 'string' ? body.recipientId.trim() : ''
    const text = typeof body.text === 'string' ? body.text.trim().slice(0, 10000) : ''
    const attachments = Array.isArray(body.attachments) ? body.attachments : []
    if (!recipientId || (!text && attachments.length === 0)) return jsonResponse(400, { success: false, message: 'Faltan destinatario o mensaje.' })
    const { error } = await admin.from('community_messages').insert({ sender_id: professionalId, recipient_id: recipientId, text, attachments_json: attachments, sent_at: new Date().toISOString() })
    return error ? jsonResponse(500, { success: false, message: error.message }) : jsonResponse(200, { success: true })
  }
  if (action === 'delete') {
    const messageId = typeof body.messageId === 'string' ? body.messageId.trim() : ''
    if (!messageId) return jsonResponse(400, { success: false, message: 'Falta el mensaje a eliminar.' })
    // Solo el remitente puede borrar su propio mensaje.
    const { error } = await admin.from('community_messages').delete().eq('id', messageId).eq('sender_id', professionalId)
    return error ? jsonResponse(500, { success: false, message: error.message }) : jsonResponse(200, { success: true })
  }
  return jsonResponse(400, { success: false, message: 'Acción no soportada.' })
})
