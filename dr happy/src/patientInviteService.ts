import { supabase, isSupabaseConfigured } from './supabaseClient'

export interface PatientInviteSubmission {
  id: string
  nombre: string
  apellido: string
  dni: string
  birth_date: string | null
  obra_social: string | null
  numero_afiliado: string | null
  email: string | null
  phone: string | null
  created_at: string
}

interface InviteResponse {
  success: boolean
  message?: string
  token?: string
  submissions?: PatientInviteSubmission[]
}

async function invokeInvite(body: Record<string, unknown>): Promise<InviteResponse> {
  if (!isSupabaseConfigured || !supabase) return { success: false, message: 'Supabase no está conectado.' }
  const sessionToken = sessionStorage.getItem('drhappy-professional-session') || ''
  const { data, error } = await supabase.functions.invoke('patient-invite', {
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
  return (data as InviteResponse) ?? { success: false, message: 'Respuesta vacía del servidor.' }
}

// El paciente siempre debe abrir el sitio público, aunque el profesional use la app desde otro origen.
const PUBLIC_SITE_URL = 'https://drhappy.com.ar'

export function buildPatientInviteUrl(token: string): string {
  return `${PUBLIC_SITE_URL}/registro/${encodeURIComponent(token)}`
}

export function getPatientInviteLink(regenerate = false): Promise<InviteResponse> {
  return invokeInvite({ action: regenerate ? 'regenerate-link' : 'get-link' })
}

export function pullPatientInviteSubmissions(): Promise<InviteResponse> {
  return invokeInvite({ action: 'pull' })
}

export function acknowledgePatientInviteSubmissions(ids: string[]): Promise<InviteResponse> {
  return invokeInvite({ action: 'ack', ids })
}
