import { supabase, isSupabaseConfigured } from './supabaseClient'

export interface EmailVerificationProfessional {
  id: string
  username: string
  full_name: string
  specialty: string
  license_number: string
  dni: string | null
  email: string
  network_memberships_json: unknown
  is_admin: boolean | null
  active: boolean | null
  enabled_modules_json?: unknown
  trial_started_at: string | null
  subscription_status: string | null
  subscription_expires_at: string | null
}

export interface VerificationResult {
  success: boolean
  message?: string
  professional?: EmailVerificationProfessional
  sessionToken?: string
  email?: string
  professionalId?: string
  resumeToken?: string
  emailSent?: boolean
  retryAfterSeconds?: number
}

async function invokeVerification(body: Record<string, unknown>): Promise<VerificationResult> {
  if (!isSupabaseConfigured || !supabase) {
    return { success: false, message: 'Supabase no está conectado en este entorno.' }
  }
  const { data, error } = await supabase.functions.invoke('auth-email-verification', { body })
  if (error) {
    const context = (error as { context?: Response }).context
    if (context && typeof context.json === 'function') {
      try {
        const payload = await context.json() as Partial<VerificationResult>
        return { ...payload, success: false, message: payload.message || error.message || 'No se pudo validar el email.' }
      } catch {
        // Si la respuesta no contiene JSON, se conserva el mensaje del cliente.
      }
    }
    return { success: false, message: error.message || 'No se pudo validar el email.' }
  }
  return data as VerificationResult
}

export function registerWithEmailVerification(params: {
  username: string
  password: string
  fullName: string
  specialty: string
  licenseNumber: string
  dni?: string
  email: string
  networkMemberships: string[]
}): Promise<VerificationResult> {
  return invokeVerification({ action: 'register', ...params })
}

export function verifyProfessionalEmail(professionalId: string, code: string): Promise<VerificationResult> {
  return invokeVerification({ action: 'verify', professionalId, code })
}

export function resendProfessionalEmailCode(professionalId: string, resumeToken: string): Promise<VerificationResult> {
  return invokeVerification({ action: 'resend', professionalId, resumeToken })
}
