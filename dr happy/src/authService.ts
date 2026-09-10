import { supabase, isSupabaseConfigured } from './supabaseClient'

export interface AuthProfessionalPublic {
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

interface AuthActionResult {
  success: boolean
  message?: string
  professional?: AuthProfessionalPublic
}

async function invokeAuthProfessional(body: Record<string, unknown>): Promise<AuthActionResult> {
  if (!isSupabaseConfigured || !supabase) {
    return { success: false, message: 'Supabase no está conectado en este entorno.' }
  }
  const { data, error } = await supabase.functions.invoke('auth-professional', { body })
  if (error) {
    return { success: false, message: error.message || 'Error invocando el servicio de autenticación.' }
  }
  const result = data as AuthActionResult
  return result
}

/**
 * Registra un nuevo profesional. La contraseña se hashea con bcrypt en el
 * servidor (Edge Function); nunca se almacena ni transmite en texto plano
 * a la base de datos.
 */
export async function registerProfessional(params: {
  username: string
  password: string
  fullName: string
  specialty: string
  licenseNumber: string
  dni?: string
  email: string
  networkMemberships: string[]
}): Promise<AuthActionResult> {
  return invokeAuthProfessional({
    action: 'register',
    username: params.username,
    password: params.password,
    fullName: params.fullName,
    specialty: params.specialty,
    licenseNumber: params.licenseNumber,
    dni: params.dni ?? null,
    email: params.email,
    networkMemberships: params.networkMemberships,
  })
}

/**
 * Valida usuario/contraseña contra el hash bcrypt almacenado en el servidor.
 * Retorna el perfil público del profesional si las credenciales son correctas.
 */
export async function loginProfessional(params: {
  username: string
  password: string
}): Promise<AuthActionResult> {
  return invokeAuthProfessional({
    action: 'login',
    username: params.username,
    password: params.password,
  })
}

/**
 * Cambia la contraseña de un profesional autenticado, validando la
 * contraseña actual antes de aplicar el nuevo hash.
 */
export async function changeProfessionalPassword(params: {
  userId: string
  currentPassword: string
  newPassword: string
}): Promise<AuthActionResult> {
  return invokeAuthProfessional({
    action: 'change-password',
    userId: params.userId,
    currentPassword: params.currentPassword,
    newPassword: params.newPassword,
  })
}

/**
 * Establece una nueva contraseña sin requerir la anterior. Sólo debe
 * invocarse luego de validar un código de recuperación de 6 dígitos.
 */
export async function setProfessionalPassword(params: {
  userId: string
  newPassword: string
}): Promise<AuthActionResult> {
  return invokeAuthProfessional({
    action: 'set-password',
    userId: params.userId,
    newPassword: params.newPassword,
  })
}
