import { isSupabaseConfigured, supabase } from './supabaseClient'

export type PaidClinicalDocumentType = 'certificate' | 'study-order'
export type PaidClinicalDocumentStatus = 'pending_payment' | 'pending_review' | 'completed' | 'cancelled'

export interface PaidClinicalDocumentServiceOption {
  enabled: boolean
  price: number
}

export interface PaidClinicalDocumentSettings {
  slug: string
  professionalName: string
  services: {
    certificate: PaidClinicalDocumentServiceOption
    studyOrder: PaidClinicalDocumentServiceOption
  }
  paymentReady: boolean
}

export interface PaidClinicalDocumentRequest {
  id: string
  service_type: PaidClinicalDocumentType
  requested_purpose: string
  patient_first_name: string
  patient_last_name: string
  patient_dni: string
  patient_email: string
  patient_phone: string
  patient_birth_date: string | null
  reason: string
  amount: number
  status: PaidClinicalDocumentStatus
  payment_status: string
  paid_at: string | null
  completed_at: string | null
  created_at: string
}

interface FunctionResponse {
  success: boolean
  message?: string
  settings?: PaidClinicalDocumentSettings
  requests?: PaidClinicalDocumentRequest[]
  professionalName?: string
  services?: PaidClinicalDocumentSettings['services']
  paymentReady?: boolean
  paymentUrl?: string
  trackingToken?: string
  request?: {
    status: PaidClinicalDocumentStatus
    paymentStatus: string
    paymentUrl: string
    serviceType: PaidClinicalDocumentType
    purpose: string
    amount: number
    professionalName: string
    createdAt: string
  }
}

async function invokePaidClinicalDocuments(body: Record<string, unknown>): Promise<FunctionResponse> {
  if (!isSupabaseConfigured || !supabase) return { success: false, message: 'Supabase no está conectado.' }
  const sessionToken = sessionStorage.getItem('drhappy-professional-session') || ''
  const { data, error } = await supabase.functions.invoke('paid-clinical-documents', {
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
        // El SDK puede responder sin cuerpo JSON.
      }
    }
    return { success: false, message: error.message || 'No se pudo completar la operación.' }
  }
  return (data as FunctionResponse) ?? { success: false, message: 'Respuesta vacía del servidor.' }
}

export function getPaidClinicalDocumentSettings(): Promise<FunctionResponse> {
  return invokePaidClinicalDocuments({ action: 'get-settings' })
}

export function savePaidClinicalDocumentSettings(settings: {
  certificateEnabled: boolean
  certificatePrice: number
  studyOrderEnabled: boolean
  studyOrderPrice: number
}): Promise<FunctionResponse> {
  return invokePaidClinicalDocuments({ action: 'save-settings', ...settings })
}

export function listPaidClinicalDocumentRequests(): Promise<FunctionResponse> {
  return invokePaidClinicalDocuments({ action: 'list-requests' })
}

export function completePaidClinicalDocumentRequest(id: string): Promise<FunctionResponse> {
  return invokePaidClinicalDocuments({ action: 'complete-request', id })
}

export function buildPaidClinicalDocumentsUrl(slug: string): string {
  return `https://drhappy.com.ar/documentos/${encodeURIComponent(slug)}`
}

export function getPublicPaidClinicalDocuments(slug: string): Promise<FunctionResponse> {
  return invokePaidClinicalDocuments({ action: 'public-info', slug })
}

export function submitPaidClinicalDocumentRequest(input: {
  slug: string
  serviceType: PaidClinicalDocumentType
  purpose: string
  patientFirstName: string
  patientLastName: string
  patientDni: string
  patientEmail: string
  patientPhone: string
  birthDate: string
  reason: string
  consent: boolean
  website: string
}): Promise<FunctionResponse> {
  return invokePaidClinicalDocuments({ action: 'submit', ...input })
}

export function getPaidClinicalDocumentStatus(trackingToken: string): Promise<FunctionResponse> {
  return invokePaidClinicalDocuments({ action: 'status', trackingToken })
}
