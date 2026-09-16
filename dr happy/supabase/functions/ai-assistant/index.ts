import { corsHeaders } from '../_shared/cors.ts'
import { createClient } from 'jsr:@supabase/supabase-js@2'

interface AssistantMessage {
  role: 'user' | 'assistant'
  content: string
}

const tools = [
  {
    name: 'buscar_turnos',
    description: 'Busca turnos del profesional autenticado. Usala cuando el profesional pregunte por su agenda, turnos de una fecha o próximos turnos.',
    input_schema: {
      type: 'object',
      properties: {
        date: { type: 'string', description: 'Fecha YYYY-MM-DD opcional.' },
        upcoming: { type: 'boolean', description: 'Si es true, devuelve próximos turnos.' },
      },
    },
  },
  {
    name: 'buscar_pacientes',
    description: 'Busca pacientes del profesional autenticado por nombre, apellido o DNI. No devuelve historias clínicas completas.',
    input_schema: {
      type: 'object',
      properties: { query: { type: 'string', description: 'Nombre, apellido o DNI.' } },
      required: ['query'],
    },
  },
  {
    name: 'buscar_vademecum',
    description: 'Busca medicamentos en el vademécum de Dr Happy. Devuelve coincidencias informativas; no reemplaza el criterio profesional.',
    input_schema: {
      type: 'object',
      properties: { query: { type: 'string', description: 'Medicamento, droga, marca o laboratorio.' } },
      required: ['query'],
    },
  },
]

function normalizeSearch(value: unknown): string {
  return String(value || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim()
}

async function runTool(name: string, input: Record<string, unknown>, admin: ReturnType<typeof createClient>, professionalId: string): Promise<unknown> {
  if (name === 'buscar_turnos') {
    const { data } = await admin.from('user_workspaces').select('appointments_json').eq('user_id', professionalId).maybeSingle()
    const appointments = Array.isArray(data?.appointments_json) ? data.appointments_json as Array<Record<string, unknown>> : []
    const date = typeof input.date === 'string' ? input.date : ''
    const upcoming = input.upcoming === true
    const today = new Date().toISOString().slice(0, 10)
    const matches = appointments
      .filter((item) => item.status !== 'cancelled')
      .filter((item) => !date || item.scheduledDate === date)
      .filter((item) => !upcoming || String(item.scheduledDate || '') >= today)
      .sort((a, b) => `${a.scheduledDate}T${a.scheduledTime}`.localeCompare(`${b.scheduledDate}T${b.scheduledTime}`))
      .slice(0, 30)
      .map((item) => ({ date: item.scheduledDate, time: item.scheduledTime, patient: item.patientName, reason: item.reason, location: item.location, status: item.status, modality: item.publicBookingModality }))
    return { count: matches.length, appointments: matches }
  }

  if (name === 'buscar_pacientes') {
    const query = normalizeSearch(input.query)
    if (query.length < 2) return { count: 0, patients: [], message: 'La búsqueda necesita al menos 2 caracteres.' }
    const { data } = await admin.from('user_workspaces').select('patients_json').eq('user_id', professionalId).maybeSingle()
    const patients = Array.isArray(data?.patients_json) ? data.patients_json as Array<Record<string, unknown>> : []
    const matches = patients.filter((patient) => normalizeSearch(`${patient.nombre || ''} ${patient.apellido || ''} ${patient.dni || ''}`).includes(query)).slice(0, 20).map((patient) => ({ id: patient.id, name: `${patient.apellido || ''}, ${patient.nombre || ''}`.trim(), dni: patient.dni, email: patient.email, obraSocial: patient.obraSocial }))
    return { count: matches.length, patients: matches }
  }

  if (name === 'buscar_vademecum') {
    const query = normalizeSearch(input.query)
    if (query.length < 3) return { count: 0, medications: [], message: 'La búsqueda necesita al menos 3 caracteres.' }
    const response = await fetch('https://www.drhappy.com.ar/vademecum.json')
    if (!response.ok) return { count: 0, medications: [], message: 'El vademécum no está disponible ahora.' }
    const catalog = await response.json()
    const entries = Array.isArray(catalog) ? catalog : Array.isArray(catalog?.medications) ? catalog.medications : []
    const matches = entries.filter((entry: unknown) => normalizeSearch(JSON.stringify(entry)).includes(query)).slice(0, 12)
    return { count: matches.length, medications: matches }
  }

  return { error: 'Herramienta no disponible.' }
}

function jsonResponse(status: number, body: Record<string, unknown>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

function cleanMessages(value: unknown): AssistantMessage[] {
  if (!Array.isArray(value)) return []
  return value
    .filter((message): message is AssistantMessage => (
      Boolean(message) &&
      typeof message === 'object' &&
      ((message as AssistantMessage).role === 'user' || (message as AssistantMessage).role === 'assistant') &&
      typeof (message as AssistantMessage).content === 'string'
    ))
    .slice(-20)
    .map((message) => ({
      role: message.role,
      content: message.content.trim().slice(0, 6000),
    }))
    .filter((message) => message.content.length > 0)
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (request.method !== 'POST') return jsonResponse(405, { success: false, message: 'Método no permitido.' })

  const anthropicKey = Deno.env.get('ANTHROPIC_API_KEY')?.trim()
  const model = Deno.env.get('ANTHROPIC_MODEL')?.trim() || 'claude-sonnet-4-5'
  if (!anthropicKey) {
    return jsonResponse(503, {
      success: false,
      message: 'Sofía está preparada, pero falta configurar ANTHROPIC_API_KEY en Supabase.',
    })
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL')
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  if (!supabaseUrl || !serviceRoleKey) return jsonResponse(500, { success: false, message: 'Falta configuración de Supabase.' })

  let payload: { action?: string; messages?: unknown; professionalId?: string; professionalName?: string; context?: string }
  try {
    payload = await request.json()
  } catch {
    return jsonResponse(400, { success: false, message: 'Cuerpo JSON inválido.' })
  }

  if (payload.action !== 'chat') {
    return jsonResponse(400, { success: false, message: 'Acción no soportada.' })
  }

  const professionalId = typeof payload.professionalId === 'string' ? payload.professionalId.trim() : ''
  const admin = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false } })
  if (!professionalId) return jsonResponse(401, { success: false, message: 'Sesión profesional requerida.' })
  const { data: professional } = await admin
    .from('professionals')
    .select('id, active')
    .eq('id', professionalId)
    .maybeSingle()
  if (!professional || professional.active === false) return jsonResponse(401, { success: false, message: 'Profesional no autorizado.' })

  const messages = cleanMessages(payload.messages)
  if (!messages.length || messages[messages.length - 1].role !== 'user') {
    return jsonResponse(400, { success: false, message: 'Sofía necesita una pregunta.' })
  }

  const professionalName = typeof payload.professionalName === 'string' ? payload.professionalName.trim() : 'profesional'
  const context = typeof payload.context === 'string' ? payload.context.trim().slice(0, 8000) : ''
  const system = [
    'Sos Sofía, la secretaria clínica inteligente de Dr Happy.',
    `Asistís de forma privada a ${professionalName}.`,
    'Respondé en español argentino, con tono profesional, cálido, breve y accionable.',
    'En esta primera versión no inventes datos clínicos ni afirmes haber consultado una historia que no recibiste.',
    'No diagnostiques ni indiques tratamientos autónomamente. Separá hechos, sugerencias y datos faltantes.',
    'Cuando el profesional pida una acción que todavía no está conectada, explicá que se incorporará como herramienta en la próxima etapa.',
    context ? `Contexto disponible de la sesión:\n${context}` : '',
  ].filter(Boolean).join('\n\n')

  let anthropicMessages: unknown[] = messages
  let reply = ''
  let inputTokens = 0
  let outputTokens = 0
  for (let iteration = 0; iteration < 4; iteration += 1) {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'x-api-key': anthropicKey, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      body: JSON.stringify({ model, max_tokens: 900, system, tools, messages: anthropicMessages }),
    })
    const result = await response.json().catch(() => null)
    if (!response.ok) {
      console.error('Anthropic request failed', response.status, result)
      const providerMessage = typeof result?.error?.message === 'string' ? result.error.message : 'Respuesta no disponible.'
      return jsonResponse(502, { success: false, message: `Claude rechazó la solicitud (${response.status}): ${providerMessage}` })
    }
    const content = Array.isArray(result?.content) ? result.content : []
    inputTokens += Number(result?.usage?.input_tokens || 0)
    outputTokens += Number(result?.usage?.output_tokens || 0)
    const toolUses = content.filter((item: { type?: string }) => item.type === 'tool_use')
    const text = content.filter((item: { type?: string }) => item.type === 'text').map((item: { text?: string }) => item.text || '').join('\n').trim()
    if (!toolUses.length) { reply = text; break }
    anthropicMessages = [...anthropicMessages, { role: 'assistant', content }]
    const toolResults = []
    for (const toolUse of toolUses) {
      const toolData = await runTool(toolUse.name, toolUse.input || {}, admin, professionalId)
      toolResults.push({ type: 'tool_result', tool_use_id: toolUse.id, content: JSON.stringify(toolData).slice(0, 12000) })
    }
    anthropicMessages = [...anthropicMessages, { role: 'user', content: toolResults }]
  }
  if (!reply) return jsonResponse(502, { success: false, message: 'Sofía recibió una respuesta vacía.' })

  const totalTokens = inputTokens + outputTokens
  const estimatedCostUsd = (inputTokens * 3 + outputTokens * 15) / 1_000_000
  await admin.from('ai_usage_events').insert({ professional_id: professionalId, model, input_tokens: inputTokens, output_tokens: outputTokens, total_tokens: totalTokens, estimated_cost_usd: estimatedCostUsd, request_type: 'chat' })

  return jsonResponse(200, { success: true, reply, usage: { inputTokens, outputTokens, totalTokens, estimatedCostUsd } })
})