import { supabase, isSupabaseConfigured } from './supabaseClient'

export interface AdminPatientStatsData {
  summary: {
    total: number; verified: number; pending: number; registrations7d: number; registrations30d: number
    active_today: number; active7d: number; active30d: number; minutes30d: number; games30d: number; invites30d: number
  }
  documents: { count: number; bytes: number; patients: number }
  pressure: { count: number; patients: number }
  shares: { doctor: number; link: number }
  notices: { sent: number; pending: number }
  daily: { date: string; registrations: number; verified: number; active: number }[]
  features: Record<string, number>
  recent: { id: string; full_name: string; email: string; created_at: string; email_verified_at: string | null; last_login_at: string | null; last_seen_at: string | null; active: boolean }[]
  trackingSince: string | null
  generatedAt: string
}

export async function fetchAdminPatientStats(page = 0): Promise<{ success: boolean; message?: string; stats?: AdminPatientStatsData }> {
  if (!isSupabaseConfigured || !supabase) return { success: false, message: 'Supabase no está conectado.' }
  const { data, error } = await supabase.functions.invoke('admin-stats', { body: { action: 'patient-stats', page } })
  if (error) return { success: false, message: error.message || 'No se pudieron cargar las estadísticas de pacientes.' }
  return data
}

export async function retryPatientNotices(): Promise<{ success: boolean; message?: string; sent?: number }> {
  if (!isSupabaseConfigured || !supabase) return { success: false, message: 'Supabase no está conectado.' }
  const { data, error } = await supabase.functions.invoke('admin-stats', { body: { action: 'patient-notice-retry' } })
  if (error) return { success: false, message: error.message || 'No se pudieron reintentar los avisos.' }
  return data
}

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
  isOnline?: boolean
  patientsCount: number
  appointmentsCount: number
  consultationsCount?: number
  prescriptionsCount?: number
  lastAppointmentDate: string | null
  activeMinutesToday?: number
  activeMinutes7d?: number
  activeMinutes30d?: number
  consultations7d?: number
  prescriptions7d?: number
  adoptionLevel?: 'alta' | 'media' | 'baja' | 'sin_uso'
}

export interface AdminStatsSummary {
  totalProfessionals: number
  onlineCount: number
  weeklyActiveCount: number
  totalPatientsManaged: number
  totalAppointments: number
  totalConsultations: number
  totalActiveMinutes7d: number
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
  _requesterId: string,
): Promise<{ success: boolean; message?: string; usage?: AdminAIUsageStats[]; total?: { requests: number; tokens: number; costUsd: number } }> {
  void _requesterId
  if (!isSupabaseConfigured || !supabase) return { success: false, message: 'Supabase no está conectado.' }
  const sessionToken = sessionStorage.getItem('drhappy-professional-session') || ''
  const { data, error } = await supabase.functions.invoke('admin-stats', { body: { action: 'ai-usage' }, headers: sessionToken ? { 'x-drhappy-session': sessionToken } : undefined })
  if (error) return { success: false, message: error.message || 'No se pudo cargar el consumo de Sofía.' }
  return data
}

export async function fetchAdminUserStats(
  _requesterId: string,
): Promise<{ success: boolean; message?: string; users?: AdminUserStats[]; summary?: AdminStatsSummary }> {
  void _requesterId
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
