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
  truncated?: boolean
  pendingConfirmation?: AssistantPendingConfirmation
}

export interface PaperRecordTranscription {
  success: boolean
  message?: string
  transcription?: string
  illegible?: boolean
  truncated?: boolean
}

/** Pide a Sofía que transcriba una foto o PDF de una ficha clínica en papel. */
export async function transcribePaperRecord(params: {
  block: AssistantContentBlock
  professionalName?: string
}): Promise<PaperRecordTranscription> {
  const result = await askSofia({
    mode: 'paper-record-transcription',
    professionalName: params.professionalName,
    messages: [{
      role: 'user',
      content: [{ type: 'text', text: 'Transcribí esta ficha clínica en papel.' }, params.block],
    }],
  })
  if (!result.success) return { success: false, message: result.message }
  const text = (result.reply || '').trim()
  if (!text || /^ILEGIBLE[.!]?$/i.test(text)) return { success: true, illegible: true }
  return { success: true, transcription: text, truncated: result.truncated === true }
}

export async function askSofia(params: {
  messages: AssistantMessage[]
  professionalName?: string
  context?: string
  mode?: 'paper-record-transcription'
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
      mode: params.mode,
      messages: params.messages,
      professionalName: params.professionalName,
      context: params.context,
      confirmation: params.confirmation,
    },
  })

  if (error) {
    const context = (error as { context?: Response }).context
    if (context && typeof context.json === 'function') {
      try {
        const payload = await context.json() as { message?: unknown }
        if (typeof payload.message === 'string' && payload.message.trim()) {
          return { success: false, message: payload.message }
        }
        if (context.status) {
          return { success: false, message: `Sofía devolvió un error HTTP ${context.status}.` }
        }
      } catch {
        // Si la respuesta no contiene JSON, se conserva el mensaje de Supabase.
      }
    }
    return { success: false, message: error.message || 'No se pudo conectar con Sofía.' }
  }

  return data as AssistantResult
}
