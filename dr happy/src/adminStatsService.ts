import { supabase, isSupabaseConfigured } from './supabaseClient'

// Métricas de uso por usuario para el panel de administración.
// Solo devuelve conteos y fechas — nunca datos clínicos.

export interface AdminUserStats {
  id: string
  username: string
  fullName: string
  email: string
  specialty: string
  active: boolean | null
  subscriptionStatus: string | null
  subscriptionExpiresAt: string | null
  trialStartedAt: string | null
  createdAt: string | null
  lastSeenAt: string | null
  patientsCount: number
  appointmentsCount: number
  lastAppointmentDate: string | null
}

export interface AdminAIUsageStats {
  professionalId: string
  fullName: string
  username: string
  requests: number
  inputTokens: number
  outputTokens: number
  totalTokens: number
  estimatedCostUsd: number
  lastUsedAt: string | null
}

export async function fetchAdminAIUsage(
  requesterId: string,
): Promise<{ success: boolean; message?: string; usage?: AdminAIUsageStats[]; total?: { requests: number; tokens: number; costUsd: number } }> {
  void requesterId
  if (!isSupabaseConfigured || !supabase) return { success: false, message: 'Supabase no está conectado.' }
  const sessionToken = sessionStorage.getItem('drhappy-professional-session') || ''
  const { data, error } = await supabase.functions.invoke('admin-stats', { body: { action: 'ai-usage' }, headers: sessionToken ? { 'x-drhappy-session': sessionToken } : undefined })
  if (error) return { success: false, message: error.message || 'No se pudo cargar el consumo de Sofía.' }
  return data
}

export async function fetchAdminUserStats(
  requesterId: string,
): Promise<{ success: boolean; message?: string; users?: AdminUserStats[] }> {
  void requesterId
  if (!isSupabaseConfigured || !supabase) {
    return { success: false, message: 'Supabase no está conectado.' }
  }
  const { data, error } = await supabase.functions.invoke('admin-stats', {
    body: { action: 'user-stats' },
    headers: sessionStorage.getItem('drhappy-professional-session') ? { 'x-drhappy-session': sessionStorage.getItem('drhappy-professional-session') as string } : undefined,
  })
  if (error) {
    return { success: false, message: error.message || 'No se pudieron cargar las métricas.' }
  }
  return data
}
