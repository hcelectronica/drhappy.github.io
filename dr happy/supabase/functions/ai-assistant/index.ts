import { corsHeaders } from '../_shared/cors.ts'
import { createClient } from 'jsr:@supabase/supabase-js@2'

interface AssistantMessage { role: 'user' | 'assistant'; content: string }

function jsonResponse(status: number, body: Record<string, unknown>): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
}

function cleanMessages(value: unknown): AssistantMessage[] {
  if (!Array.isArray(value)) return []
  return value.filter((message): message is AssistantMessage => Boolean(message) && typeof message === 'object' && (((message as AssistantMessage).role === 'user') || ((message as AssistantMessage).role === 'assistant')) && typeof (message as AssistantMessage).content === 'string').slice(-20).map((message) => ({ role: message.role, content: message.content.trim().slice(0, 6000) })).filter((message) => message.content.length > 0)
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (request.method !== 'POST') return jsonResponse(405, { success: false, message: 'Método no permitido.' })
  const anthropicKey = Deno.env.get('ANTHROPIC_API_KEY')?.trim()
  const model = Deno.env.get('ANTHROPIC_MODEL')?.trim() || 'claude-sonnet-4-5'
  if (!anthropicKey) return jsonResponse(503, { success: false, message: 'Sofía está preparada, pero falta configurar ANTHROPIC_API_KEY en Supabase.' })
  const supabaseUrl = Deno.env.get('SUPABASE_URL')
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  if (!supabaseUrl || !serviceRoleKey) return jsonResponse(500, { success: false, message: 'Falta configuración de Supabase.' })
  let payload: { action?: string; messages?: unknown; professionalId?: string; professionalName?: string; context?: string }
  try { payload = await request.json() } catch { return jsonResponse(400, { success: false, message: 'Cuerpo JSON inválido.' }) }
  if (payload.action !== 'chat') return jsonResponse(400, { success: false, message: 'Acción no soportada.' })
  const professionalId = typeof payload.professionalId === 'string' ? payload.professionalId.trim() : ''
  const admin = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false } })
  if (!professionalId) return jsonResponse(401, { success: false, message: 'Sesión profesional requerida.' })
  const { data: professional } = await admin.from('professionals').select('id, active').eq('id', professionalId).maybeSingle()
  if (!professional || professional.active === false) return jsonResponse(401, { success: false, message: 'Profesional no autorizado.' })
  const messages = cleanMessages(payload.messages)
  if (!messages.length || messages[messages.length - 1].role !== 'user') return jsonResponse(400, { success: false, message: 'Sofía necesita una pregunta.' })
  const professionalName = typeof payload.professionalName === 'string' ? payload.professionalName.trim() : 'profesional'
  const context = typeof payload.context === 'string' ? payload.context.trim().slice(0, 8000) : ''
  const system = ['Sos Sofía, la secretaria clínica inteligente de Dr Happy.', `Asistís de forma privada a ${professionalName}.`, 'Respondé en español argentino, con tono profesional, cálido, breve y accionable.', 'En esta primera versión no inventes datos clínicos ni afirmes haber consultado una historia que no recibiste.', 'No diagnostiques ni indiques tratamientos autónomamente. Separá hechos, sugerencias y datos faltantes.', 'Cuando el profesional pida una acción que todavía no está conectada, explicá que se incorporará como herramienta en la próxima etapa.', context ? `Contexto disponible de la sesión:\n${context}` : ''].filter(Boolean).join('\n\n')
  const response = await fetch('https://api.anthropic.com/v1/messages', { method: 'POST', headers: { 'x-api-key': anthropicKey, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' }, body: JSON.stringify({ model, max_tokens: 900, system, messages }) })
  const result = await response.json().catch(() => null)
  if (!response.ok) { console.error('Anthropic request failed', response.status, result); return jsonResponse(502, { success: false, message: 'Claude no pudo responder en este momento.' }) }
  const reply = Array.isArray(result?.content) ? result.content.filter((item: { type?: string }) => item.type === 'text').map((item: { text?: string }) => item.text || '').join('\n').trim() : ''
  if (!reply) return jsonResponse(502, { success: false, message: 'Sofía recibió una respuesta vacía.' })
  return jsonResponse(200, { success: true, reply })
})