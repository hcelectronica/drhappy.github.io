import { serve } from 'https://deno.land/std@0.224.0/http/server.ts'
import { createClient } from 'jsr:@supabase/supabase-js@2'
import { corsHeaders } from '../_shared/cors.ts'

// Operaciones privilegiadas sobre professionals que ANTES hacía el navegador
// con la clave pública. Eso permitía que cualquiera se auto-otorgara is_admin
// o se activara la suscripción. Ahora solo pasan por acá, y solo si quien las
// pide es realmente administrador (verificado contra la base con Service Role).

type Action =
  | 'set-admin'
  | 'set-active'
  | 'set-subscription'
  | 'set-modules'
  | 'delete-professional'

interface RequestBody {
  action: Action
  requesterId?: string
  targetId?: string
  isAdmin?: boolean
  active?: boolean
  subscriptionStatus?: string
  subscriptionExpiresAt?: string | null
  enabledModules?: string[] | null
}

const ALLOWED_SUBSCRIPTION_STATUS = new Set(['trial', 'active', 'expired', 'cancelled'])
const ALLOWED_MODULES = new Set(['attention', 'appointments', 'tools', 'ambulance', 'community', 'ledger'])

function jsonResponse(status: number, body: Record<string, unknown>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

serve(async (request) => {
  if (request.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }
  if (request.method !== 'POST') {
    return jsonResponse(405, { success: false, message: 'Método no permitido.' })
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL')
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  if (!supabaseUrl || !serviceRoleKey) {
    return jsonResponse(500, { success: false, message: 'Falta configuración del servidor.' })
  }
  const admin = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false } })

  let body: RequestBody
  try {
    body = await request.json()
  } catch {
    return jsonResponse(400, { success: false, message: 'Cuerpo JSON inválido.' })
  }

  try {
    const requesterId = body.requesterId?.trim()
    const targetId = body.targetId?.trim()
    if (!requesterId) {
      return jsonResponse(400, { success: false, message: 'Falta el identificador del solicitante.' })
    }
    if (!targetId) {
      return jsonResponse(400, { success: false, message: 'Falta el usuario a modificar.' })
    }

    const { data: requester, error: requesterError } = await admin
      .from('professionals')
      .select('id, is_admin, active')
      .eq('id', requesterId)
      .maybeSingle()
    if (requesterError) {
      return jsonResponse(500, { success: false, message: requesterError.message })
    }
    if (!requester || requester.is_admin !== true || requester.active === false) {
      return jsonResponse(403, { success: false, message: 'Solo un administrador activo puede realizar esta acción.' })
    }

    const { data: target, error: targetError } = await admin
      .from('professionals')
      .select('id, username, is_admin')
      .eq('id', targetId)
      .maybeSingle()
    if (targetError) {
      return jsonResponse(500, { success: false, message: targetError.message })
    }
    if (!target) {
      return jsonResponse(404, { success: false, message: 'No se encontró el usuario a modificar.' })
    }

    switch (body.action) {
      case 'set-admin': {
        if (typeof body.isAdmin !== 'boolean') {
          return jsonResponse(400, { success: false, message: 'Valor de administrador inválido.' })
        }
        // Nadie puede quitarse a sí mismo el rol: evita quedarse sin ningún admin.
        if (targetId === requesterId && body.isAdmin === false) {
          return jsonResponse(400, {
            success: false,
            message: 'No podés quitarte a vos mismo los permisos de administrador.',
          })
        }
        const { error } = await admin.from('professionals').update({ is_admin: body.isAdmin }).eq('id', targetId)
        if (error) return jsonResponse(500, { success: false, message: error.message })
        return jsonResponse(200, { success: true })
      }

      case 'set-active': {
        if (typeof body.active !== 'boolean') {
          return jsonResponse(400, { success: false, message: 'Valor de estado inválido.' })
        }
        if (targetId === requesterId && body.active === false) {
          return jsonResponse(400, { success: false, message: 'No podés desactivar tu propia cuenta.' })
        }
        const { error } = await admin.from('professionals').update({ active: body.active }).eq('id', targetId)
        if (error) return jsonResponse(500, { success: false, message: error.message })
        return jsonResponse(200, { success: true })
      }

      case 'set-subscription': {
        const status = body.subscriptionStatus?.trim()
        if (!status || !ALLOWED_SUBSCRIPTION_STATUS.has(status)) {
          return jsonResponse(400, { success: false, message: 'Estado de suscripción inválido.' })
        }
        const { error } = await admin
          .from('professionals')
          .update({
            subscription_status: status,
            subscription_expires_at: body.subscriptionExpiresAt ?? null,
          })
          .eq('id', targetId)
        if (error) return jsonResponse(500, { success: false, message: error.message })
        return jsonResponse(200, { success: true })
      }

      case 'set-modules': {
        let modules: string[] | null = null
        if (Array.isArray(body.enabledModules)) {
          modules = [...new Set(body.enabledModules.filter((m) => ALLOWED_MODULES.has(m)))]
        }
        const { error } = await admin
          .from('professionals')
          .update({ enabled_modules_json: modules })
          .eq('id', targetId)
        if (error) return jsonResponse(500, { success: false, message: error.message })
        return jsonResponse(200, { success: true })
      }

      case 'delete-professional': {
        if (targetId === requesterId) {
          return jsonResponse(400, { success: false, message: 'No podés eliminar tu propia cuenta desde el panel.' })
        }
        if (target.is_admin === true) {
          return jsonResponse(400, { success: false, message: 'No se puede eliminar a otro administrador.' })
        }
        const { error } = await admin.from('professionals').delete().eq('id', targetId)
        if (error) return jsonResponse(500, { success: false, message: error.message })
        return jsonResponse(200, { success: true })
      }

      default:
        return jsonResponse(400, { success: false, message: 'Acción no soportada.' })
    }
  } catch (error) {
    return jsonResponse(500, {
      success: false,
      message: error instanceof Error ? error.message : 'Error inesperado en el servidor.',
    })
  }
})
