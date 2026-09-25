import { supabase, isSupabaseConfigured } from './supabaseClient'

export interface AssistantMessage {
  role: 'user' | 'assistant'
  content: string | AssistantContentBlock[]
}

export type AssistantContentBlock =
  | { type: 'text'; text: string }
  | { type: 'image'; source: { type: 'base64'; media_type: string; data: string } }
  | { type: 'document'; source: { type: 'base64'; media_type: 'application/pdf'; data: string } }

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

export async function askSofia(params: {
  messages: AssistantMessage[]
  professionalName?: string
  context?: string
  confirmation?: { action: string; input: Record<string, unknown> }
}): Promise<AssistantResult> {
  if (!isSupabaseConfigured || !supabase) {
    return { success: false, message: 'Sofía todavía no está conectada al servicio de IA en este entorno.' }
  }

  const sessionToken = sessionStorage.getItem('drhappy-professional-session') || ''
  const { data: authData } = await supabase.auth.getSession()
  const headers: Record<string, string> = {}
  if (sessionToken) headers['x-drhappy-session'] = sessionToken
  if (authData.session?.access_token) headers.Authorization = `Bearer ${authData.session.access_token}`
  const { data, error } = await supabase.functions.invoke('ai-assistant', {
    headers: Object.keys(headers).length ? headers : undefined,
    body: {
      action: 'chat',
      messages: params.messages,
      professionalName: params.professionalName,
      context: params.context,
      confirmation: params.confirmation,
    },
  })

  if (error) {
    return { success: false, message: error.message || 'No se pudo conectar con Sofía.' }
  }

  return data as AssistantResult
}
