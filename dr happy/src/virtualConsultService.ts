import { supabase, isSupabaseConfigured } from './supabaseClient'

export const VIRTUAL_CONSULT_PILOT_EMAILS = ['mudimudialan@gmail.com', 'alan.moodie@hotmail.com']

export function isVirtualConsultPilotEmail(email?: string | null): boolean {
  return VIRTUAL_CONSULT_PILOT_EMAILS.includes(String(email ?? '').trim().toLowerCase())
}

export type VirtualConsultStatus = 'pending_payment' | 'pending_review' | 'answered' | 'declined' | 'cancelled'

export interface VirtualConsultDraft {
  resumenClinico: string
  respuestaPaciente: string
  alertas: string
}

export interface VirtualConsult {
  id: string
  nombre: string
  apellido: string
  dni: string
  email: string
  phone: string | null
  obra_social: string | null
  birth_date: string | null
  question: string
  status: VirtualConsultStatus
  payment_status: string | null
  amount: number
  created_at: string
  paid_at: string | null
  answered_at: string | null
  recorded_in_chart_at: string | null
  response_text: string | null
  decline_reason: string | null
  draft: VirtualConsultDraft | null
  attachmentCount: number
}

export interface VirtualConsultSettings {
  slug: string
  enabled: boolean
  price: number
  paymentReady: boolean
  url: string
}

export interface VirtualConsultAttachment {
  name: string
  type: string
  size: number
  url: string
}

interface VirtualConsultResponse {
  success: boolean
  message?: string
  settings?: VirtualConsultSettings
  consults?: VirtualConsult[]
  attachments?: VirtualConsultAttachment[]
  draft?: VirtualConsultDraft
  emailSent?: boolean
  answeredAt?: string
}

async function invokeVirtualConsult(body: Record<string, unknown>): Promise<VirtualConsultResponse> {
  if (!isSupabaseConfigured || !supabase) return { success: false, message: 'Supabase no está conectado.' }
  const sessionToken = sessionStorage.getItem('drhappy-professional-session') || ''
  const { data, error } = await supabase.functions.invoke('virtual-consultations', {
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
  return (data as VirtualConsultResponse) ?? { success: false, message: 'Respuesta vacía del servidor.' }
}

export const getVirtualConsultSettings = () => invokeVirtualConsult({ action: 'get-settings' })
export const saveVirtualConsultSettings = (enabled: boolean, price: number) => invokeVirtualConsult({ action: 'save-settings', enabled, price })
export const listVirtualConsults = () => invokeVirtualConsult({ action: 'list' })
export const getVirtualConsultAttachments = (id: string) => invokeVirtualConsult({ action: 'attachments', id })
export const markVirtualConsultPaid = (id: string) => invokeVirtualConsult({ action: 'mark-paid', id })
export const markVirtualConsultRecorded = (id: string) => invokeVirtualConsult({ action: 'mark-recorded', id })
export const draftVirtualConsult = (id: string) => invokeVirtualConsult({ action: 'draft', id })
export const publishVirtualConsult = (id: string, responseText: string) => invokeVirtualConsult({ action: 'publish', id, responseText })
export const declineVirtualConsult = (id: string, reason: string) => invokeVirtualConsult({ action: 'decline', id, reason })
