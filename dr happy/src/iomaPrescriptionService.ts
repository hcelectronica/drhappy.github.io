import { isSupabaseConfigured, supabase } from './supabaseClient'

export interface IomaRequest {
  id: string
  patient_first_name: string
  patient_last_name: string
  patient_dni: string
  patient_email: string
  patient_phone: string
  patient_birth_date: string
  insurance_member_number: string
  medication: string
  created_at: string
  status: 'pending_review' | 'completed'
  email_status: string
}
export type IomaAction =
  | { action: 'public-info'; slug: string }
  | { action: 'submit'; slug: string; patientFirstName: string; patientLastName: string; patientDni: string; patientEmail: string; patientPhone: string; birthDate: string; insuranceMemberNumber: string; medication: string; consent: boolean; website: string }
  | { action: 'get-settings' }
  | { action: 'list'; offset: number }
  | { action: 'save-settings'; enabled: boolean }
  | { action: 'complete'; id: string }
export interface IomaResponse {
  success: boolean
  message?: string
  professionalName?: string
  enabled?: boolean
  slug?: string
  emailSent?: boolean
  requests?: IomaRequest[]
}

export const iomaUrl = (slug: string) => `${window.location.origin}${import.meta.env.BASE_URL}?ioma=${encodeURIComponent(slug)}`

export async function callIoma(body: IomaAction): Promise<IomaResponse> {
  if (!isSupabaseConfigured || !supabase) return { success: false, message: 'El servicio no está disponible.' }
  const isPublic = body.action === 'public-info' || body.action === 'submit'
  const token = isPublic ? null : sessionStorage.getItem('drhappy-professional-session')
  try {
    const { data, error } = await supabase.functions.invoke('ioma-prescriptions', {
      body, headers: token ? { 'x-drhappy-session': token } : undefined,
    })
    if (error) {
      if (!isPublic && error.context instanceof Response && [401, 403].includes(error.context.status)) {
        return { success: false, message: 'La sesión profesional puede haber vencido o no tener acceso. Iniciá sesión nuevamente.' }
      }
      if (error.context instanceof Response && error.context.status < 500) {
        const response = await error.context.json().catch(() => null)
        if (typeof response?.message === 'string') return { success: false, message: response.message }
      }
      return { success: false, message: body.action === 'submit'
        ? 'No se pudo confirmar el envío. Contactá al consultorio antes de volver a enviar para evitar duplicados.'
        : 'No se pudo contactar con el servicio. Intentá nuevamente.' }
    }
    return data && typeof data.success === 'boolean' ? data as IomaResponse : { success: false, message: body.action === 'submit'
      ? 'No se pudo confirmar el envío. Contactá al consultorio antes de volver a enviar para evitar duplicados.'
      : 'Respuesta inválida del servicio.' }
  } catch {
    return { success: false, message: body.action === 'submit'
      ? 'No se pudo confirmar el envío. Contactá al consultorio antes de volver a enviar para evitar duplicados.'
      : 'No se pudo contactar con el servicio. Intentá nuevamente.' }
  }
}
