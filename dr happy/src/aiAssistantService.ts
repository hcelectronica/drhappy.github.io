import { supabase, isSupabaseConfigured } from './supabaseClient'

export interface AssistantMessage {
  role: 'user' | 'assistant'
  content: string
}

interface AssistantResult {
  success: boolean
  message?: string
  reply?: string
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

  const { data, error } = await supabase.functions.invoke('ai-assistant', {
    body: {
      action: 'chat',
      professionalId: params.professionalId,
      messages: params.messages,
      professionalName: params.professionalName,
      context: params.context,
    },
  })

  if (error) {
    return { success: false, message: error.message || 'No se pudo conectar con Sofía.' }
  }

  return data as AssistantResult
}
