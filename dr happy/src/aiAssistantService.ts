import { supabase, isSupabaseConfigured } from './supabaseClient'

export interface AssistantMessage {
  role: 'user' | 'assistant'
  content: string
}

export interface AssistantPendingConfirmation {
  action: string
  proposal: Record<string, unknown>
}

interface AssistantResult {
  success: boolean
  message?: string
  reply?: string
  pendingConfirmation?: AssistantPendingConfirmation
}

function normalizeSofiaErrorMessage(message: string): string {
  const normalized = message.trim()
  const lower = normalized.toLowerCase()

  if (lower.includes('non-2xx') || lower.includes('edge function returned') || lower.includes('limit') && lower.includes('prueba')) {
    return 'Tus 3 preguntas gratuitas de Sofía ya terminaron. Activá una suscripción para seguir usando a la asistente.'
  }

  if (lower.includes('suscripción activa') || lower.includes('requiere una suscripción')) {
    return 'Sofía requiere una suscripción activa para seguir respondiendo. Activá tu plan para continuar.'
  }

  return normalized || 'No se pudo conectar con Sofía.'
}

export async function askSofia(params: {
  messages: AssistantMessage[]
  professionalId?: string
  professionalName?: string
  context?: string
}): Promise<AssistantResult> {
  if (!isSupabaseConfigured || !supabase) {
    return { success: false, message: 'Sofía todavía no está conectada al servicio de IA en este entorno.' }
  }

  const sessionToken = sessionStorage.getItem('drhappy-professional-session') || ''
  const { data, error } = await supabase.functions.invoke('ai-assistant', {
    body: {
      action: 'chat',
      professionalId: params.professionalId,
      messages: params.messages,
      professionalName: params.professionalName,
      context: params.context,
    },
    headers: sessionToken ? { 'x-drhappy-session': sessionToken } : undefined,
  })

  if (error) {
    const context = (error as { context?: { json?: () => Promise<unknown> } }).context
    if (context && typeof context.json === 'function') {
      try {
        const payload = await context.json() as { message?: string }
        if (payload && typeof payload.message === 'string' && payload.message.trim()) {
          return { success: false, message: normalizeSofiaErrorMessage(payload.message) }
        }
      } catch {
        // Ignoramos el parse fallido y usamos el fallback del error original.
      }
    }

    return {
      success: false,
      message: normalizeSofiaErrorMessage(typeof error.message === 'string' ? error.message : 'No se pudo conectar con Sofía.'),
    }
  }

  return data as AssistantResult
}
