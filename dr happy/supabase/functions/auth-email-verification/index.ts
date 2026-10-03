import { serve } from 'https://deno.land/std@0.224.0/http/server.ts'
import { createClient } from 'jsr:@supabase/supabase-js@2'
import bcrypt from 'npm:bcryptjs@2.4.3'
import { corsHeaders } from '../_shared/cors.ts'
import { createProfessionalSession } from '../_shared/professionalSession.ts'
import { notifyAdminRegistration } from '../_shared/adminRegistrationEmail.ts'

// PARCHE LOGIN: queda desactivado hasta habilitarlo explícitamente.

const BCRYPT_ROUNDS = 12
const CODE_TTL_MINUTES = 15
const MAX_ATTEMPTS = 5
const RESUME_TOKEN_BYTES = 32
const PROFESSIONAL_PUBLIC_COLUMNS = 'id, username, full_name, specialty, license_number, dni, email, network_memberships_json, is_admin, active, enabled_modules_json, trial_started_at, subscription_status, subscription_expires_at'

type RequestBody = {
  action: 'register' | 'verify' | 'resend' | 'resume'
  username?: string
  password?: string
  fullName?: string
  specialty?: string
  licenseNumber?: string
  dni?: string
  email?: string
  networkMemberships?: string[]
  professionalId?: string
  code?: string
  resumeToken?: string
}

function jsonResponse(status: number, body: Record<string, unknown>): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character] || character)
}

function createCode(): string {
  const value = new Uint32Array(1)
  const range = 900000
  const ceiling = Math.floor(0x100000000 / range) * range
  do crypto.getRandomValues(value)
  while (value[0] >= ceiling)
  return String(100000 + (value[0] % range))
}

function createResumeToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(RESUME_TOKEN_BYTES))
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')
}

async function hashSecret(scope: string, id: string, value: string): Promise<string> {
  const pepper = Deno.env.get('EMAIL_VERIFICATION_PEPPER')?.trim()
  if (!pepper) throw new Error('Falta EMAIL_VERIFICATION_PEPPER.')
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`${scope}:${id}:${value}:${pepper}`))
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('')
}

async function sendCode(supabaseUrl: string, serviceRoleKey: string, email: string, code: string): Promise<boolean> {
  try {
    const response = await fetch(`${supabaseUrl}/functions/v1/send-email`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${serviceRoleKey}`, apikey: serviceRoleKey, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        to: email,
        subject: 'Confirmá tu email para crear tu cuenta en Dr Happy',
        type: 'custom',
        html: `<p>Tu código de verificación de Dr Happy es:</p><div style="font-size:34px;font-weight:800;letter-spacing:6px;text-align:center;color:#1e3a8a;margin:24px 0;">${escapeHtml(code)}</div><p>Vence en ${CODE_TTL_MINUTES} minutos. Si no solicitaste esta cuenta, podés ignorar este mensaje.</p>`,
      }),
    })
    if (!response.ok) return false
    const result = await response.json().catch(() => null) as { success?: unknown } | null
    return result?.success === true
  } catch {
    return false
  }
}

function mapRpcError(error: { code?: string; message?: string }): string {
  if (error.code === '23505') {
    return (error.message || '').toLowerCase().includes('email')
      ? 'Ese email ya está asociado a otro usuario.'
      : 'Ese nombre de usuario ya existe.'
  }
  return 'No se pudo completar el registro. Intentá nuevamente.'
}

serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (request.method !== 'POST') return jsonResponse(405, { success: false, message: 'Método no permitido.' })
  if (Deno.env.get('ENABLE_EMAIL_VERIFICATION')?.trim().toLowerCase() !== 'true') {
    return jsonResponse(409, { success: false, code: 'EMAIL_VERIFICATION_DISABLED', message: 'La verificación por email todavía no está habilitada.' })
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL')?.trim()
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')?.trim()
  if (!supabaseUrl || !serviceRoleKey) return jsonResponse(500, { success: false, message: 'Falta configuración del servidor.' })
  if (!Deno.env.get('EMAIL_VERIFICATION_PEPPER')?.trim()) return jsonResponse(500, { success: false, message: 'Falta configuración del servidor.' })
  const admin = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false } })
  let body: RequestBody
  try { body = await request.json() } catch { return jsonResponse(400, { success: false, message: 'Cuerpo JSON inválido.' }) }

  if (body.action === 'register') {
    const username = body.username?.trim().toLowerCase()
    const password = body.password
    const fullName = body.fullName?.trim()
    const email = body.email?.trim().toLowerCase()
    if (!username || !password || !fullName || !email) return jsonResponse(400, { success: false, message: 'Faltan datos obligatorios.' })
    if (username.length > 80 || fullName.length > 200 || email.length > 254 || password.length > 1024) return jsonResponse(400, { success: false, message: 'Alguno de los datos supera el largo permitido.' })
    if (password.length < 6) return jsonResponse(400, { success: false, message: 'La contraseña debe tener al menos 6 caracteres.' })
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return jsonResponse(400, { success: false, message: 'El email no es válido.' })
    if (body.networkMemberships && (!Array.isArray(body.networkMemberships) || body.networkMemberships.length > 50)) return jsonResponse(400, { success: false, message: 'Los datos de cobertura no son válidos.' })

    const createdAt = new Date()
    const challengeId = crypto.randomUUID()
    const resumeToken = createResumeToken()
    const code = createCode()
    const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS)
    const [{ data: duplicateUsername, error: usernameError }, { data: duplicateEmail, error: emailError }] = await Promise.all([
      admin.from('professionals').select('id').eq('username', username).limit(1).maybeSingle(),
      admin.from('professionals').select('id').eq('email', email).limit(1).maybeSingle(),
    ])
    if (usernameError || emailError) return jsonResponse(500, { success: false, message: 'No se pudo validar la cuenta.' })
    if (duplicateUsername) return jsonResponse(409, { success: false, message: 'Ese nombre de usuario ya existe.' })
    if (duplicateEmail) return jsonResponse(409, { success: false, message: 'Ese email ya está asociado a otro usuario.' })

    const { data: professionalId, error } = await admin.rpc('create_professional_email_verification_registration', {
      p_username: username,
      p_password_hash: passwordHash,
      p_full_name: fullName,
      p_specialty: body.specialty?.trim() || '',
      p_license_number: body.licenseNumber?.trim() || '',
      p_dni: body.dni?.trim() || null,
      p_email: email,
      p_network_memberships: body.networkMemberships || [],
      p_challenge_id: challengeId,
      p_code_hash: await hashSecret('code', challengeId, code),
      p_expires_at: new Date(createdAt.getTime() + CODE_TTL_MINUTES * 60 * 1000).toISOString(),
      p_resume_token_hash: await hashSecret('resume', username, resumeToken),
      p_created_at: createdAt.toISOString(),
    })
    if (error || !professionalId) return jsonResponse(error?.code === '23505' ? 409 : 500, { success: false, message: error ? mapRpcError(error) : 'No se pudo crear la cuenta.' })

    const adminEmailSent = await notifyAdminRegistration(supabaseUrl, serviceRoleKey, {
      id: String(professionalId), username, full_name: fullName, email,
      specialty: body.specialty?.trim(), license_number: body.licenseNumber?.trim(),
    }, 'email-verification')
    const emailSent = await sendCode(supabaseUrl, serviceRoleKey, email, code).catch(() => false)
    return jsonResponse(200, { success: true, professionalId, email, resumeToken, emailSent, adminEmailSent })
  }

  if (body.action === 'resume') {
    const username = body.username?.trim().toLowerCase()
    const password = body.password
    if (!username || !password || password.length > 1024) {
      return jsonResponse(400, { success: false, message: 'Ingresá tu usuario y contraseña para recuperar el código.' })
    }

    const [{ data: byUsername, error: usernameError }, { data: byEmail, error: emailError }] = await Promise.all([
      admin.from('professionals').select('id, username, email, password_hash, active, email_verification_required, email_verified_at').eq('username', username).maybeSingle(),
      admin.from('professionals').select('id, username, email, password_hash, active, email_verification_required, email_verified_at').eq('email', username).maybeSingle(),
    ])
    if (usernameError || emailError) return jsonResponse(500, { success: false, message: 'No se pudo validar la cuenta.' })
    const professional = byUsername || byEmail
    if (!professional || professional.active === false || !professional.password_hash) {
      return jsonResponse(401, { success: false, message: 'Usuario o contraseña incorrectos.' })
    }
    if (!(await bcrypt.compare(password, professional.password_hash))) {
      return jsonResponse(401, { success: false, message: 'Usuario o contraseña incorrectos.' })
    }
    if (professional.email_verified_at || professional.email_verification_required !== true) {
      return jsonResponse(409, { success: false, code: 'EMAIL_ALREADY_VERIFIED', message: 'La cuenta no tiene una confirmación pendiente. Iniciá sesión normalmente.' })
    }

    const challengeId = crypto.randomUUID()
    const resumeToken = createResumeToken()
    const code = createCode()
    const { data: status, error } = await admin.rpc('recover_professional_email_verification_challenge', {
      p_professional_id: professional.id,
      p_resume_token_hash: await hashSecret('resume', professional.username, resumeToken),
      p_challenge_id: challengeId,
      p_code_hash: await hashSecret('code', challengeId, code),
      p_expires_at: new Date(Date.now() + CODE_TTL_MINUTES * 60 * 1000).toISOString(),
    })
    if (error) return jsonResponse(500, { success: false, message: 'No se pudo recuperar el código.' })
    if (typeof status === 'string' && status.startsWith('cooldown:')) {
      return jsonResponse(429, { success: false, retryAfterSeconds: Number(status.slice(9)), message: 'Esperá antes de solicitar otro código.' })
    }
    if (status === 'limit') return jsonResponse(429, { success: false, message: 'Alcanzaste el límite de reenvíos. Intentá nuevamente dentro de 24 horas.' })
    if (status === 'verified') return jsonResponse(409, { success: false, code: 'EMAIL_ALREADY_VERIFIED', message: 'El email ya fue confirmado. Iniciá sesión.' })
    if (status !== 'ready') return jsonResponse(401, { success: false, message: 'No se pudo recuperar el código para esta cuenta.' })

    const emailSent = await sendCode(supabaseUrl, serviceRoleKey, professional.email, code).catch(() => false)
    return jsonResponse(200, {
      success: true,
      professionalId: professional.id,
      email: professional.email,
      resumeToken,
      fullName: professional.full_name,
      specialty: professional.specialty,
      emailSent,
    })
  }

  const professionalId = body.professionalId?.trim()
  if (!professionalId || !/^[0-9a-f-]{36}$/i.test(professionalId)) return jsonResponse(400, { success: false, message: 'El identificador de cuenta no es válido.' })
  const { data: professional } = await admin.from('professionals').select(`${PROFESSIONAL_PUBLIC_COLUMNS}, email_verified_at`).eq('id', professionalId).maybeSingle()
  if (!professional) return jsonResponse(404, { success: false, message: 'No se encontró la cuenta.' })
  if (professional.email_verified_at) return jsonResponse(409, { success: false, code: 'EMAIL_ALREADY_VERIFIED', message: 'Este email ya fue confirmado. Iniciá sesión.' })

  if (body.action === 'resend') {
    const resumeToken = body.resumeToken?.trim() || ''
    if (!/^[0-9a-f]{64}$/i.test(resumeToken)) return jsonResponse(401, { success: false, message: 'No se pudo autorizar el reenvío. Iniciá nuevamente el registro.' })
    const code = createCode()
    const challengeId = crypto.randomUUID()
    const { data: status, error } = await admin.rpc('rotate_professional_email_verification_challenge', {
      p_professional_id: professionalId,
      p_resume_token_hash: await hashSecret('resume', professional.username, resumeToken),
      p_challenge_id: challengeId,
      p_code_hash: await hashSecret('code', challengeId, code),
      p_expires_at: new Date(Date.now() + CODE_TTL_MINUTES * 60 * 1000).toISOString(),
    })
    if (error) return jsonResponse(500, { success: false, message: 'No se pudo procesar el reenvío.' })
    if (status === 'invalid') return jsonResponse(401, { success: false, message: 'No se pudo autorizar el reenvío.' })
    if (typeof status === 'string' && status.startsWith('cooldown:')) return jsonResponse(429, { success: false, retryAfterSeconds: Number(status.slice(9)), message: 'Esperá antes de solicitar otro código.' })
    if (status === 'limit') return jsonResponse(429, { success: false, message: 'Alcanzaste el límite de reenvíos. Intentá nuevamente dentro de 24 horas.' })
    if (status === 'verified') return jsonResponse(409, { success: false, message: 'Este email ya fue confirmado. Iniciá sesión.' })
    const emailSent = await sendCode(supabaseUrl, serviceRoleKey, professional.email, code).catch(() => false)
    return jsonResponse(200, { success: true, email: professional.email, emailSent })
  }

  if (body.action === 'verify') {
    const code = body.code?.trim() || ''
    if (!/^\d{6}$/.test(code)) return jsonResponse(400, { success: false, message: 'El código debe tener 6 dígitos.' })
    const { data: challenge } = await admin.from('professional_email_verification_challenges').select('id').eq('professional_id', professionalId).is('consumed_at', null).order('created_at', { ascending: false }).limit(1).maybeSingle()
    if (!challenge) return jsonResponse(400, { success: false, message: 'El código venció. Solicitá uno nuevo.' })
    const { data: status, error } = await admin.rpc('verify_professional_email_challenge', {
      p_professional_id: professionalId,
      p_challenge_id: challenge.id,
      p_code_hash: await hashSecret('code', challenge.id, code),
      p_now: new Date().toISOString(),
      p_max_attempts: MAX_ATTEMPTS,
    })
    if (error) return jsonResponse(500, { success: false, message: 'No se pudo validar el código.' })
    if (status === 'expired') return jsonResponse(400, { success: false, message: 'El código venció. Solicitá uno nuevo.' })
    if (status === 'locked') return jsonResponse(429, { success: false, message: 'Superaste los intentos permitidos. Solicitá un código nuevo.' })
    if (status === 'invalid') return jsonResponse(400, { success: false, message: 'El código no es válido.' })
    if (status !== 'verified' && status !== 'already_verified') return jsonResponse(500, { success: false, message: 'No se pudo confirmar el email.' })

    const [{ data: publicProfessional, error: professionalError }, sessionResult] = await Promise.all([
      admin.from('professionals').select(PROFESSIONAL_PUBLIC_COLUMNS).eq('id', professionalId).single(),
      createProfessionalSession(admin, professionalId).then((sessionToken) => ({ sessionToken, error: null })).catch((sessionError: unknown) => ({ sessionToken: '', error: sessionError })),
    ])
    if (professionalError || !publicProfessional || sessionResult.error || !sessionResult.sessionToken) {
      return jsonResponse(500, { success: false, message: 'El email quedó confirmado, pero no se pudo iniciar sesión. Ingresá con tu usuario y contraseña.' })
    }
    return jsonResponse(200, { success: true, professional: publicProfessional, sessionToken: sessionResult.sessionToken })
  }

  return jsonResponse(400, { success: false, message: 'Acción no soportada.' })
})
