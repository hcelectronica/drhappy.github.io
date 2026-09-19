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
  const sessionToken = sessionStorage.getItem('drhappy-professional-session') || ''
  const { data, error } = await supabase.functions.invoke('admin-professionals', { body, headers: sessionToken ? { 'x-drhappy-session': sessionToken } : undefined })
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
  _requesterId: string,
  targetId: string,
  isAdmin: boolean,
): Promise<AdminActionResult> {
  void requesterId
  return invokeAdminAction({ action: 'set-admin', targetId, isAdmin })
}

export function setProfessionalActive(
  _requesterId: string,
  targetId: string,
  active: boolean,
): Promise<AdminActionResult> {
  void requesterId
  return invokeAdminAction({ action: 'set-active', targetId, active })
}

export function setProfessionalSubscription(
  _requesterId: string,
  targetId: string,
  subscriptionStatus: string,
  subscriptionExpiresAt: string | null,
): Promise<AdminActionResult> {
  void requesterId
  return invokeAdminAction({
    action: 'set-subscription',
    targetId,
    subscriptionStatus,
    subscriptionExpiresAt,
  })
}

export function setProfessionalModules(
  _requesterId: string,
  targetId: string,
  enabledModules: string[] | null,
): Promise<AdminActionResult> {
  void requesterId
  return invokeAdminAction({ action: 'set-modules', targetId, enabledModules })
}

export function deleteProfessionalAsAdmin(
  _requesterId: string,
  targetId: string,
): Promise<AdminActionResult> {
  void requesterId
  return invokeAdminAction({ action: 'delete-professional', targetId })
}

export function archiveAndDeleteProfessional(targetId: string): Promise<AdminActionResult> {
  return invokeAdminAction({ action: 'archive-delete-professional', targetId })
}
