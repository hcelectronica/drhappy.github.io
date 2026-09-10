import { serve } from 'https://deno.land/std@0.224.0/http/server.ts'
import { createClient } from 'jsr:@supabase/supabase-js@2'
import bcrypt from 'npm:bcryptjs@2.4.3'
import { corsHeaders } from '../_shared/cors.ts'

// Esta función es la ÚNICA parte del sistema que puede leer o escribir el hash
// de contraseña de un profesional. Usa la Service Role Key (nunca expuesta al
// cliente) y jamás devuelve el hash ni la contraseña en texto plano.
//
// Acciones soportadas (action):
// - register:        crea un profesional nuevo con password_hash (bcrypt).
// - login:            valida usuario/contraseña y retorna el perfil (sin hash).
// - change-password:  requiere la contraseña actual para actualizarla.
// - set-password:     actualiza sin contraseña actual (usada tras validar un
//                      código de recuperación ya verificado por el llamador).

const BCRYPT_ROUNDS = 12

interface AuthRequestBody {
  action: 'register' | 'login' | 'change-password' | 'set-password'
  username?: string
  password?: string
  currentPassword?: string
  newPassword?: string
  userId?: string
  fullName?: string
  specialty?: string
  licenseNumber?: string
  dni?: string
  email?: string
  networkMemberships?: string[]
}

const PROFESSIONAL_PUBLIC_COLUMNS =
  'id, username, full_name, specialty, license_number, dni, email, network_memberships_json, is_admin, active, enabled_modules_json, trial_started_at, subscription_status, subscription_expires_at'

function jsonResponse(status: number, body: Record<string, unknown>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders,
      'Content-Type': 'application/json',
    },
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
    return jsonResponse(500, {
      success: false,
      message: 'Falta configurar SUPABASE_SERVICE_ROLE_KEY en los secrets de la función.',
    })
  }
  const admin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false },
  })

  let body: AuthRequestBody
  try {
    body = await request.json()
  } catch {
    return jsonResponse(400, { success: false, message: 'Cuerpo JSON inválido.' })
  }

  try {
    switch (body.action) {
      case 'register': {
        const username = body.username?.trim()
        const password = body.password
        const fullName = body.fullName?.trim()
        const specialty = body.specialty?.trim() ?? ''
        const licenseNumber = body.licenseNumber?.trim() ?? ''
        const dni = body.dni?.trim() ?? null
        const email = body.email?.trim()
        const networkMemberships = body.networkMemberships ?? []

        if (!username || !password || !fullName || !email) {
          return jsonResponse(400, { success: false, message: 'Faltan campos obligatorios para registrar el usuario.' })
        }
        if (password.length < 8) {
          return jsonResponse(400, { success: false, message: 'La contraseña debe tener al menos 8 caracteres.' })
        }

        const { data: existing, error: existingError } = await admin
          .from('professionals')
          .select('id')
          .ilike('username', username)
          .maybeSingle()
        if (existingError) {
          return jsonResponse(500, { success: false, message: `No se pudo validar el usuario: ${existingError.message}` })
        }
        if (existing) {
          return jsonResponse(409, { success: false, message: 'Ese nombre de usuario ya existe.' })
        }

        const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS)
        const trialStartedAt = new Date().toISOString()

        const { data: inserted, error: insertError } = await admin
          .from('professionals')
          .insert({
            username,
            password_hash: passwordHash,
            full_name: fullName,
            specialty,
            license_number: licenseNumber,
            dni,
            email,
            network_memberships_json: networkMemberships,
            trial_started_at: trialStartedAt,
            subscription_status: 'trial',
          })
          .select(PROFESSIONAL_PUBLIC_COLUMNS)
          .single()

        if (insertError) {
          return jsonResponse(500, { success: false, message: `No se pudo crear el usuario: ${insertError.message}` })
        }

        return jsonResponse(200, { success: true, professional: inserted })
      }

      case 'login': {
        const username = body.username?.trim()
        const password = body.password
        if (!username || !password) {
          return jsonResponse(400, { success: false, message: 'Usuario y contraseña son requeridos.' })
        }

        const { data, error } = await admin
          .from('professionals')
          .select(`${PROFESSIONAL_PUBLIC_COLUMNS}, password_hash`)
          .ilike('username', username)
          .maybeSingle()

        if (error) {
          return jsonResponse(500, { success: false, message: `No se pudo validar el usuario: ${error.message}` })
        }
        if (!data || data.active === false || !data.password_hash) {
          return jsonResponse(401, { success: false, message: 'Usuario o contraseña inválidos o usuario inactivo.' })
        }

        const passwordMatches = await bcrypt.compare(password, data.password_hash as string)
        if (!passwordMatches) {
          return jsonResponse(401, { success: false, message: 'Usuario o contraseña inválidos o usuario inactivo.' })
        }

        const { password_hash: _omit, ...sanitized } = data as Record<string, unknown>
        return jsonResponse(200, { success: true, professional: sanitized })
      }

      case 'change-password': {
        const userId = body.userId
        const currentPassword = body.currentPassword
        const newPassword = body.newPassword
        if (!userId || !currentPassword || !newPassword) {
          return jsonResponse(400, { success: false, message: 'Faltan campos para cambiar la contraseña.' })
        }
        if (newPassword.length < 8) {
          return jsonResponse(400, { success: false, message: 'La nueva contraseña debe tener al menos 8 caracteres.' })
        }

        const { data, error } = await admin
          .from('professionals')
          .select('id, password_hash')
          .eq('id', userId)
          .maybeSingle()
        if (error) {
          return jsonResponse(500, { success: false, message: `No se pudo validar el usuario: ${error.message}` })
        }
        if (!data || !data.password_hash) {
          return jsonResponse(404, { success: false, message: 'Usuario no encontrado.' })
        }
        const matches = await bcrypt.compare(currentPassword, data.password_hash as string)
        if (!matches) {
          return jsonResponse(401, { success: false, message: 'La contraseña actual no es correcta.' })
        }

        const newHash = await bcrypt.hash(newPassword, BCRYPT_ROUNDS)
        const { error: updateError } = await admin
          .from('professionals')
          .update({ password_hash: newHash })
          .eq('id', userId)
        if (updateError) {
          return jsonResponse(500, { success: false, message: `No se pudo actualizar la contraseña: ${updateError.message}` })
        }
        return jsonResponse(200, { success: true })
      }

      case 'set-password': {
        // Usada por el flujo de recuperación de contraseña, luego de que el
        // llamador ya validó el código de 6 dígitos contra password_recovery_challenges.
        const userId = body.userId
        const newPassword = body.newPassword
        if (!userId || !newPassword) {
          return jsonResponse(400, { success: false, message: 'Faltan campos para restablecer la contraseña.' })
        }
        if (newPassword.length < 8) {
          return jsonResponse(400, { success: false, message: 'La nueva contraseña debe tener al menos 8 caracteres.' })
        }
        const newHash = await bcrypt.hash(newPassword, BCRYPT_ROUNDS)
        const { error: updateError } = await admin
          .from('professionals')
          .update({ password_hash: newHash })
          .eq('id', userId)
        if (updateError) {
          return jsonResponse(500, { success: false, message: `No se pudo actualizar la contraseña: ${updateError.message}` })
        }
        return jsonResponse(200, { success: true })
      }

      default:
        return jsonResponse(400, { success: false, message: 'Acción no reconocida.' })
    }
  } catch (error) {
    console.error('[auth-professional] Error inesperado:', error)
    return jsonResponse(500, {
      success: false,
      message: error instanceof Error ? error.message : 'Error inesperado en el servicio de autenticación.',
    })
  }
})
