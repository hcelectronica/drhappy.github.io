import { supabase, isSupabaseConfigured } from './supabaseClient'

async function requestProfessionals(body: Record<string, unknown>): Promise<{ success: boolean; message?: string; professionals?: unknown[]; professional?: unknown }> {
  if (!isSupabaseConfigured || !supabase) return { success: false, message: 'Supabase no está conectado.' }
  const token = sessionStorage.getItem('drhappy-professional-session') || ''
  const { data, error } = await supabase.functions.invoke('professionals-data', { body, headers: token ? { 'x-drhappy-session': token } : undefined })
  if (error) return { success: false, message: error.message || 'No se pudo consultar profesionales.' }
  return data
}

export async function loadProfessionals(): Promise<{ success: boolean; message?: string; professionals?: unknown[] }> {
  const result = await requestProfessionals({})
  return { success: result.success, message: result.message, professionals: result.professionals }
}

export function updateOwnProfessionalProfile(profile: Record<string, unknown>): Promise<{ success: boolean; message?: string }> {
  return requestProfessionals({ action: 'profile-update', profile }).then(({ success, message }) => ({ success, message }))
}

export function loadOwnProfessional(): Promise<{ success: boolean; message?: string; professional?: unknown }> {
  return requestProfessionals({ action: 'get-one' }).then(({ success, message, professional }) => ({ success, message, professional }))
}
