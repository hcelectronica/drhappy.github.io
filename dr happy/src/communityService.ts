import { supabase, isSupabaseConfigured } from './supabaseClient'

export async function communityRequest(body: Record<string, unknown>): Promise<{ success: boolean; message?: string; messages?: unknown[] }> {
  if (!isSupabaseConfigured || !supabase) return { success: false, message: 'Supabase no está conectado.' }
  const token = sessionStorage.getItem('drhappy-professional-session') || ''
  const { data, error } = await supabase.functions.invoke('community-data', { body, headers: token ? { 'x-drhappy-session': token } : undefined })
  if (error) return { success: false, message: error.message || 'No se pudo sincronizar la comunidad.' }
  return data as { success: boolean; message?: string; messages?: unknown[] }
}
