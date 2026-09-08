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
  const { data, error } = await supabase.functions.invoke('self-delete-account', {
    body: { action: 'self-delete', userId: params.userId, password: params.password },
  })
  if (error) {
    return { success: false, message: error.message || 'No se pudo procesar la baja.' }
  }
  return data
}
