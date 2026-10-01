import { supabase, isSupabaseConfigured } from './supabaseClient'

export const SUPPORT_MESSAGE_MAX_LENGTH = 300

export interface SupportMessage {
  id: string
  name: string
  email: string
  message: string
  professional_id: string | null
  status: 'pending' | 'read'
  created_at: string
}

interface SupportResponse {
  success: boolean
  message?: string
  messages?: SupportMessage[]
}

async function invokeSupport(body: Record<string, unknown>): Promise<SupportResponse> {
  if (!isSupabaseConfigured || !supabase) return { success: false, message: 'Supabase no está conectado.' }
  const sessionToken = sessionStorage.getItem('drhappy-professional-session') || ''
  const { data, error } = await supabase.functions.invoke('support-messages', {
    body,
    headers: sessionToken ? { 'x-drhappy-session': sessionToken } : undefined,
  })
  if (error) {
    const context = (error as { context?: Response }).context
    if (context && typeof context.json === 'function') {
      try {
        const payload = await context.json()
        if (payload?.message) return { success: false, message: payload.message }
      } catch {
        // sin cuerpo JSON: se usa el mensaje genérico
      }
    }
    return { success: false, message: error.message || 'No se pudo completar la acción.' }
  }
  return (data as SupportResponse) ?? { success: false, message: 'Respuesta vacía del servidor.' }
}

export function sendSupportMessage(params: { name: string; email: string; message: string; website: string }): Promise<SupportResponse> {
  return invokeSupport({ action: 'send', ...params })
}

export function listSupportMessages(): Promise<SupportResponse> {
  return invokeSupport({ action: 'list' })
}

export function setSupportMessageStatus(id: string, status: 'pending' | 'read'): Promise<SupportResponse> {
  return invokeSupport({ action: 'set-status', id, status })
}

export function deleteSupportMessage(id: string): Promise<SupportResponse> {
  return invokeSupport({ action: 'delete', id })
}
