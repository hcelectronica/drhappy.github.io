import { supabase, isSupabaseConfigured } from './supabaseClient'

export async function loadProfessionals(): Promise<{ success: boolean; message?: string; professionals?: unknown[] }> {
  if (!isSupabaseConfigured || !supabase) return { success: false, message: 'Supabase no está conectado.' }
  const token = sessionStorage.getItem('drhappy-professional-session') || ''
  const { data, error } = await supabase.functions.invoke('professionals-data', { body: {}, headers: token ? { 'x-drhappy-session': token } : undefined })
  if (error) return { success: false, message: error.message || 'No se pudo cargar profesionales.' }
  return data as { success: boolean; message?: string; professionals?: unknown[] }
}
