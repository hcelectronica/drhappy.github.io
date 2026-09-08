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

export async function fetchAdminUserStats(
  requesterId: string,
): Promise<{ success: boolean; message?: string; users?: AdminUserStats[] }> {
  if (!isSupabaseConfigured || !supabase) {
    return { success: false, message: 'Supabase no está conectado.' }
  }
  const { data, error } = await supabase.functions.invoke('admin-stats', {
    body: { action: 'user-stats', requesterId },
  })
  if (error) {
    return { success: false, message: error.message || 'No se pudieron cargar las métricas.' }
  }
  return data
}
