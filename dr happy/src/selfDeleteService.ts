import { supabase, isSupabaseConfigured } from './supabaseClient'

// Auto-eliminación de cuenta por el propio usuario (requisito de Google Play).
// Genera el archivo legal, lo envía por email y elimina la cuenta. Irreversible.

export async function selfDeleteAccount(params: {
  userId: string
  password: string
}): Promise<{ success: boolean; message?: string }> {
  if (!isSupabaseConfigured || !supabase) {
    return { success: false, message: 'Supabase no está conectado.' }
  }
  const sessionToken = sessionStorage.getItem('drhappy-professional-session')
    || localStorage.getItem('drhappy-professional-session')
    || ''
  if (!sessionToken) {
    return { success: false, message: 'No se encontró una sesión profesional válida. Iniciá sesión de nuevo e intentá otra vez.' }
  }
  const { data, error } = await supabase.functions.invoke('self-delete-account', {
    body: { action: 'self-delete', userId: params.userId, password: params.password },
    headers: { 'x-drhappy-session': sessionToken },
  })
  if (error) {
    const context = (error as { context?: Response }).context
    if (context && typeof context.json === 'function') {
      try {
        const payload = await context.json() as { message?: unknown }
        if (typeof payload.message === 'string' && payload.message.trim()) {
          return { success: false, message: payload.message }
        }
      } catch {
        // Si la respuesta no contiene JSON, se conserva el mensaje del cliente.
      }
    }
    return { success: false, message: error.message || 'No se pudo procesar la baja.' }
  }
  return data
}
