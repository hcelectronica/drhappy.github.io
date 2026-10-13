import { serve } from 'https://deno.land/std@0.224.0/http/server.ts'
import { createClient } from 'jsr:@supabase/supabase-js@2'
import type { SupabaseClient } from 'jsr:@supabase/supabase-js@2'
import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
} from 'npm:@simplewebauthn/server@13.2.2'
import type {
  AuthenticationResponseJSON,
  RegistrationResponseJSON,
} from 'npm:@simplewebauthn/server@13.2.2'
import { corsHeaders } from '../_shared/cors.ts'
import { createProfessionalSession, resolveProfessionalId } from '../_shared/professionalSession.ts'

const RP_NAME = 'Dr Happy'
const CHALLENGE_LIFETIME_MS = 5 * 60 * 1000
const PROFESSIONAL_PUBLIC_COLUMNS =
  'id, username, full_name, specialty, license_number, dni, email, network_memberships_json, is_admin, active, enabled_modules_json, trial_started_at, subscription_status, subscription_expires_at'

interface PasskeyRequest {
  action?: string
  username?: string
  challenge?: string
  credentialId?: string
  response?: unknown
}

interface WebAuthnConfig {
  origin: string
  rpID: string
}

function jsonResponse(status: number, body: Record<string, unknown>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders,
      'Content-Type': 'application/json',
    },
  })
}

function getWebAuthnConfig(request: Request): WebAuthnConfig | null {
  const origin = request.headers.get('Origin')
  if (!origin) return null

  let parsed: URL
  try {
    parsed = new URL(origin)
  } catch {
    return null
  }
  if (parsed.origin !== origin) return null

  if (origin === 'https://www.drhappy.com.ar') {
    return { origin, rpID: 'www.drhappy.com.ar' }
  }
  if (parsed.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(parsed.hostname)) {
    return { origin, rpID: parsed.hostname }
  }
  return null
}

function encodeBase64Url(bytes: Uint8Array): string {
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')
}

function decodeBase64Url(value: string) {
  const base64 = value.replace(/-/g, '+').replace(/_/g, '/')
  const binary = atob(base64.padEnd(Math.ceil(base64.length / 4) * 4, '='))
  return Uint8Array.from(binary, (character) => character.charCodeAt(0))
}

async function saveChallenge(
  admin: SupabaseClient,
  professionalId: string | null,
  purpose: 'registration' | 'authentication',
  challenge: string,
  config: WebAuthnConfig,
): Promise<void> {
  const now = new Date().toISOString()
  const { error: cleanupError } = await admin
    .from('professional_passkey_challenges')
    .delete()
    .lt('expires_at', now)
  if (cleanupError) throw new Error(`No se pudieron limpiar los desafíos vencidos: ${cleanupError.message}`)

  const { error } = await admin.from('professional_passkey_challenges').insert({
    professional_id: professionalId,
    purpose,
    challenge,
    expected_origin: config.origin,
    rp_id: config.rpID,
    expires_at: new Date(Date.now() + CHALLENGE_LIFETIME_MS).toISOString(),
  })
  if (error) throw new Error(`No se pudo guardar el desafío de acceso: ${error.message}`)
}

async function consumeChallenge(
  admin: SupabaseClient,
  challenge: string,
  purpose: 'registration' | 'authentication',
  professionalId?: string,
): Promise<{ professional_id: string | null; expected_origin: string; rp_id: string } | null> {
  let query = admin
    .from('professional_passkey_challenges')
    .delete()
    .eq('challenge', challenge)
    .eq('purpose', purpose)
    .gt('expires_at', new Date().toISOString())
    .select('professional_id, expected_origin, rp_id')
  if (professionalId) query = query.eq('professional_id', professionalId)
  const { data, error } = await query.maybeSingle()
  if (error) throw new Error(`No se pudo consumir el desafío de acceso: ${error.message}`)
  return data
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
    return jsonResponse(500, { success: false, message: 'Falta configurar el servicio de autenticación.' })
  }
  const admin = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false } })
  const emailVerificationEnabled = Deno.env.get('ENABLE_EMAIL_VERIFICATION')?.trim().toLowerCase() === 'true'

  let body: PasskeyRequest
  try {
    body = await request.json()
  } catch {
    return jsonResponse(400, { success: false, message: 'Cuerpo JSON inválido.' })
  }

  try {
    switch (body.action) {
      case 'registration-options': {
        const professionalId = await resolveProfessionalId(request, admin)
        if (!professionalId) return jsonResponse(401, { success: false, message: 'Iniciá sesión para configurar la biometría.' })

        const { data: professional, error } = await admin
          .from('professionals')
          .select('id, username, full_name, active')
          .eq('id', professionalId)
          .maybeSingle()
        if (error) return jsonResponse(500, { success: false, message: `No se pudo cargar la cuenta: ${error.message}` })
        if (!professional || professional.active === false) return jsonResponse(401, { success: false, message: 'La cuenta no está disponible.' })

        const config = getWebAuthnConfig(request)
        if (!config) return jsonResponse(400, { success: false, message: 'La biometría solo puede configurarse desde Dr Happy en un origen seguro.' })

        const { data: existing, error: credentialsError } = await admin
          .from('professional_passkeys')
          .select('credential_id, transports')
          .eq('professional_id', professionalId)
        if (credentialsError) return jsonResponse(500, { success: false, message: `No se pudieron consultar los dispositivos: ${credentialsError.message}` })

        const options = await generateRegistrationOptions({
          rpName: RP_NAME,
          rpID: config.rpID,
          userID: new TextEncoder().encode(professional.id),
          userName: professional.username,
          userDisplayName: professional.full_name || professional.username,
          attestationType: 'none',
          authenticatorSelection: {
            authenticatorAttachment: 'platform',
            residentKey: 'required',
            userVerification: 'required',
          },
          excludeCredentials: (existing ?? []).map((credential) => ({
            id: credential.credential_id,
            transports: credential.transports,
          })),
        })
        await saveChallenge(admin, professionalId, 'registration', options.challenge, config)
        return jsonResponse(200, { success: true, options })
      }

      case 'registration-verify': {
        const professionalId = await resolveProfessionalId(request, admin)
        if (!professionalId) return jsonResponse(401, { success: false, message: 'Iniciá sesión para configurar la biometría.' })
        if (typeof body.challenge !== 'string' || !body.challenge || !body.response || typeof body.response !== 'object') {
          return jsonResponse(400, { success: false, message: 'La respuesta del dispositivo está incompleta.' })
        }

        const challenge = await consumeChallenge(admin, body.challenge, 'registration', professionalId)
        if (!challenge) return jsonResponse(400, { success: false, message: 'El desafío venció o ya fue utilizado. Intentá nuevamente.' })
        let verification
        try {
          verification = await verifyRegistrationResponse({
            response: body.response as RegistrationResponseJSON,
            expectedChallenge: body.challenge,
            expectedOrigin: challenge.expected_origin,
            expectedRPID: challenge.rp_id,
            requireUserVerification: true,
          })
        } catch (error) {
          console.warn('Se rechazó una respuesta de registro de passkey:', error)
          return jsonResponse(400, { success: false, message: 'No se pudo verificar la biometría de este dispositivo.' })
        }
        if (!verification.verified || !verification.registrationInfo) {
          return jsonResponse(400, { success: false, message: 'No se pudo verificar la biometría de este dispositivo.' })
        }

        const credential = verification.registrationInfo.credential
        const { error } = await admin.from('professional_passkeys').insert({
          professional_id: professionalId,
          credential_id: credential.id,
          public_key: encodeBase64Url(credential.publicKey),
          sign_count: credential.counter,
          transports: credential.transports ?? [],
          device_type: verification.registrationInfo.credentialDeviceType,
          backed_up: verification.registrationInfo.credentialBackedUp,
        })
        if (error?.code === '23505') return jsonResponse(409, { success: false, message: 'Este dispositivo ya está registrado en una cuenta.' })
        if (error) return jsonResponse(500, { success: false, message: `No se pudo guardar el dispositivo: ${error.message}` })
        return jsonResponse(200, { success: true })
      }

      case 'authentication-options': {
        const config = getWebAuthnConfig(request)
        if (!config) return jsonResponse(400, { success: false, message: 'La biometría solo funciona desde Dr Happy en un origen seguro.' })
        const options = await generateAuthenticationOptions({
          rpID: config.rpID,
          userVerification: 'required',
        })
        await saveChallenge(admin, null, 'authentication', options.challenge, config)
        return jsonResponse(200, { success: true, options })
      }

      case 'authentication-verify': {
        if (typeof body.challenge !== 'string' || !body.challenge || !body.response || typeof body.response !== 'object') {
          return jsonResponse(400, { success: false, message: 'La respuesta biométrica está incompleta.' })
        }
        const response = body.response as AuthenticationResponseJSON
        const challenge = await consumeChallenge(admin, body.challenge, 'authentication')
        if (!challenge) return jsonResponse(400, { success: false, message: 'El desafío venció o ya fue utilizado. Intentá nuevamente.' })

        const { data: credential, error: credentialError } = await admin
          .from('professional_passkeys')
          .select('id, professional_id, credential_id, public_key, sign_count, transports')
          .eq('credential_id', response.id)
          .maybeSingle()
        if (credentialError) return jsonResponse(500, { success: false, message: `No se pudo consultar el dispositivo: ${credentialError.message}` })
        if (!credential) return jsonResponse(401, { success: false, message: 'Este dispositivo no está registrado para la cuenta.' })

        let verification
        try {
          verification = await verifyAuthenticationResponse({
            response,
            expectedChallenge: body.challenge,
            expectedOrigin: challenge.expected_origin,
            expectedRPID: challenge.rp_id,
            requireUserVerification: true,
            credential: {
              id: credential.credential_id,
              publicKey: decodeBase64Url(credential.public_key),
              counter: Number(credential.sign_count),
              transports: credential.transports,
            },
          })
        } catch (error) {
          console.warn('Se rechazó una respuesta de autenticación con passkey:', error)
          return jsonResponse(401, { success: false, message: 'No se pudo verificar la biometría del dispositivo.' })
        }
        if (!verification.verified) return jsonResponse(401, { success: false, message: 'No se pudo verificar la biometría del dispositivo.' })

        const { data: professional, error: professionalError } = await admin
          .from('professionals')
          .select(PROFESSIONAL_PUBLIC_COLUMNS)
          .eq('id', credential.professional_id)
          .maybeSingle()
        if (professionalError) return jsonResponse(500, { success: false, message: `No se pudo validar la cuenta: ${professionalError.message}` })
        if (!professional || professional.active === false) {
          return jsonResponse(401, { success: false, message: 'La cuenta no está disponible para iniciar sesión.' })
        }
        if (emailVerificationEnabled) {
          const { data: emailVerification, error: verificationError } = await admin
            .from('professionals')
            .select('email_verification_required, email_verified_at')
            .eq('id', professional.id)
            .maybeSingle()
          if (verificationError) return jsonResponse(500, { success: false, message: `No se pudo verificar el email: ${verificationError.message}` })
          if (emailVerification?.email_verification_required === true && !emailVerification.email_verified_at) {
            return jsonResponse(401, { success: false, message: 'La cuenta no está disponible para iniciar sesión.' })
          }
        }

        const { data: updatedCredential, error: updateError } = await admin
          .from('professional_passkeys')
          .update({
            sign_count: verification.authenticationInfo.newCounter,
            last_used_at: new Date().toISOString(),
          })
          .eq('id', credential.id)
          .eq('sign_count', credential.sign_count)
          .select('id')
          .maybeSingle()
        if (updateError) return jsonResponse(500, { success: false, message: `No se pudo actualizar el dispositivo: ${updateError.message}` })
        if (!updatedCredential) return jsonResponse(409, { success: false, message: 'El dispositivo cambió durante el inicio de sesión. Intentá nuevamente.' })

        const sessionToken = await createProfessionalSession(admin, String(professional.id))
        void admin.from('professionals').update({ last_seen_at: new Date().toISOString() }).eq('id', professional.id)
        return jsonResponse(200, { success: true, professional, sessionToken })
      }

      case 'list': {
        const professionalId = await resolveProfessionalId(request, admin)
        if (!professionalId) return jsonResponse(401, { success: false, message: 'Iniciá sesión para consultar tus dispositivos.' })
        const { data, error } = await admin
          .from('professional_passkeys')
          .select('id, created_at, last_used_at, device_type, backed_up')
          .eq('professional_id', professionalId)
          .order('created_at', { ascending: true })
        if (error) return jsonResponse(500, { success: false, message: `No se pudieron cargar los dispositivos: ${error.message}` })
        return jsonResponse(200, { success: true, credentials: data ?? [] })
      }

      case 'delete': {
        const professionalId = await resolveProfessionalId(request, admin)
        if (!professionalId) return jsonResponse(401, { success: false, message: 'Iniciá sesión para quitar un dispositivo.' })
        if (!body.credentialId || !/^[0-9a-f-]{36}$/i.test(body.credentialId)) {
          return jsonResponse(400, { success: false, message: 'El identificador del dispositivo no es válido.' })
        }
        const { data, error } = await admin
          .from('professional_passkeys')
          .delete()
          .eq('id', body.credentialId)
          .eq('professional_id', professionalId)
          .select('id')
          .maybeSingle()
        if (error) return jsonResponse(500, { success: false, message: `No se pudo quitar el dispositivo: ${error.message}` })
        if (!data) return jsonResponse(404, { success: false, message: 'No se encontró ese dispositivo en tu cuenta.' })
        return jsonResponse(200, { success: true })
      }

      default:
        return jsonResponse(400, { success: false, message: 'Acción de biometría desconocida.' })
    }
  } catch (error) {
    console.error('Error en autenticación con passkey:', error)
    return jsonResponse(500, { success: false, message: 'No se pudo completar la operación de biometría.' })
  }
})
