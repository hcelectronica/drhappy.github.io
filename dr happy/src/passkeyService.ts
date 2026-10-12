import { startAuthentication, startRegistration } from '@simplewebauthn/browser'
import { isSupabaseConfigured, supabase } from './supabaseClient'
import type { AuthProfessionalPublic } from './authService'

export interface PasskeySummary {
  id: string
  created_at: string
  last_used_at: string | null
  device_type: 'singleDevice' | 'multiDevice'
  backed_up: boolean
}

type CreationOptionsJSON = Parameters<typeof startRegistration>[0]['optionsJSON']
type RequestOptionsJSON = Parameters<typeof startAuthentication>[0]['optionsJSON']

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

async function invokePasskey<T extends Record<string, unknown>>(body: Record<string, unknown>): Promise<T> {
  if (!isSupabaseConfigured || !supabase) {
    throw new Error('La autenticación biométrica requiere conexión con el servidor.')
  }
  const { data, error } = await supabase.functions.invoke('passkey-auth', { body })
  if (error) {
    const context = (error as { context?: Response }).context
    if (context && typeof context.json === 'function') {
      let payload: unknown = null
      try {
        payload = await context.json()
      } catch {
        payload = null
      }
      if (isRecord(payload) && typeof payload.message === 'string' && payload.message.trim()) {
        throw new Error(payload.message)
      }
    }
    throw new Error(error.message || 'No se pudo completar la operación biométrica.')
  }
  if (!isRecord(data) || data.success !== true) {
    throw new Error('El servidor no confirmó la operación biométrica.')
  }
  return data as T
}

export function isPasskeySupported(): boolean {
  return typeof window !== 'undefined'
    && window.isSecureContext
    && typeof window.PublicKeyCredential !== 'undefined'
    && typeof navigator.credentials?.create === 'function'
    && typeof navigator.credentials?.get === 'function'
}

export async function registerPasskey(): Promise<void> {
  const optionsResult = await invokePasskey<{ options: CreationOptionsJSON }>({
    action: 'registration-options',
  })
  const response = await startRegistration({ optionsJSON: optionsResult.options })
  await invokePasskey<{ success: true }>({
    action: 'registration-verify',
    challenge: optionsResult.options.challenge,
    response,
  })
}

export async function authenticateWithPasskey(): Promise<{
  professional: AuthProfessionalPublic
  sessionToken: string
}> {
  const optionsResult = await invokePasskey<{ options: RequestOptionsJSON }>({
    action: 'authentication-options',
  })
  const response = await startAuthentication({ optionsJSON: optionsResult.options })
  const result = await invokePasskey<{
    professional: AuthProfessionalPublic
    sessionToken: string
  }>({
    action: 'authentication-verify',
    challenge: optionsResult.options.challenge,
    response,
  })
  if (!result.professional || typeof result.sessionToken !== 'string' || !result.sessionToken) {
    throw new Error('El servidor no devolvió una sesión válida.')
  }
  return { professional: result.professional, sessionToken: result.sessionToken }
}

export async function listPasskeys(): Promise<PasskeySummary[]> {
  const result = await invokePasskey<{ credentials: PasskeySummary[] }>({ action: 'list' })
  if (!Array.isArray(result.credentials)) throw new Error('El servidor devolvió una lista de dispositivos inválida.')
  return result.credentials
}

export async function removePasskey(credentialId: string): Promise<void> {
  await invokePasskey<{ success: true }>({ action: 'delete', credentialId })
}
