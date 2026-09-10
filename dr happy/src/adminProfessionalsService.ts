import { supabase, isSupabaseConfigured } from './supabaseClient'

// Operaciones privilegiadas sobre usuarios (rol de admin, estado de cuenta,
// suscripción, módulos y baja). Pasan por una Edge Function con Service Role
// que valida que el solicitante sea administrador.
//
// Antes esto se hacía con UPDATE directo desde el navegador usando la clave
// pública: cualquiera podía auto-otorgarse permisos de administrador.

interface AdminActionResult {
  success: boolean
  message?: string
}

async function invokeAdminAction(body: Record<string, unknown>): Promise<AdminActionResult> {
  if (!isSupabaseConfigured || !supabase) {
    return { success: false, message: 'Supabase no está conectado.' }
  }
  const { data, error } = await supabase.functions.invoke('admin-professionals', { body })
  if (error) {
    // Las respuestas de error traen el motivo en el cuerpo; lo recuperamos para
    // mostrar un mensaje útil en lugar de un genérico "non-2xx status code".
    const context = (error as { context?: Response }).context
    if (context && typeof context.json === 'function') {
      try {
        const payload = await context.json()
        if (payload?.message) {
          return { success: false, message: payload.message }
        }
      } catch {
        // sin cuerpo JSON: se usa el mensaje genérico
      }
    }
    return { success: false, message: error.message || 'No se pudo completar la acción.' }
  }
  return (data as AdminActionResult) ?? { success: false, message: 'Respuesta vacía del servidor.' }
}

export function setProfessionalAdmin(
  requesterId: string,
  targetId: string,
  isAdmin: boolean,
): Promise<AdminActionResult> {
  return invokeAdminAction({ action: 'set-admin', requesterId, targetId, isAdmin })
}

export function setProfessionalActive(
  requesterId: string,
  targetId: string,
  active: boolean,
): Promise<AdminActionResult> {
  return invokeAdminAction({ action: 'set-active', requesterId, targetId, active })
}

export function setProfessionalSubscription(
  requesterId: string,
  targetId: string,
  subscriptionStatus: string,
  subscriptionExpiresAt: string | null,
): Promise<AdminActionResult> {
  return invokeAdminAction({
    action: 'set-subscription',
    requesterId,
    targetId,
    subscriptionStatus,
    subscriptionExpiresAt,
  })
}

export function setProfessionalModules(
  requesterId: string,
  targetId: string,
  enabledModules: string[] | null,
): Promise<AdminActionResult> {
  return invokeAdminAction({ action: 'set-modules', requesterId, targetId, enabledModules })
}

export function deleteProfessionalAsAdmin(
  requesterId: string,
  targetId: string,
): Promise<AdminActionResult> {
  return invokeAdminAction({ action: 'delete-professional', requesterId, targetId })
}
