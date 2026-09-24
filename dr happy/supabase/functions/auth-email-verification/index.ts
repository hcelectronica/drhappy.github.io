import { serve } from 'https://deno.land/std@0.224.0/http/server.ts'
import { createClient } from 'jsr:@supabase/supabase-js@2'
import bcrypt from 'npm:bcryptjs@2.4.3'
import { corsHeaders } from '../_shared/cors.ts'
import { createProfessionalSession } from '../_shared/professionalSession.ts'

// PARCHE LOGIN: queda desactivado hasta habilitarlo explícitamente.

const BCRYPT_ROUNDS = 12
const CODE_TTL_MINUTES = 15
const MAX_ATTEMPTS = 5
const PROFESSIONAL_PUBLIC_COLUMNS = 'id, username, full_name, specialty, license_number, dni, email, network_memberships_json, is_admin, active, enabled_modules_json, trial_started_at, subscription_status, subscription_expires_at'

type RequestBody = {
  action: 'register' | 'verify' | 'resend'
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
}

function jsonResponse(status: number, body: Record<string, unknown>): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character] || character)
}

function createCode(): string {
  return String(Math.floor(100000 + Math.random() * 900000))
}

async function hashCode(challengeId: string, code: string): Promise<string> {
  const pepper = Deno.env.get('EMAIL_VERIFICATION_PEPPER')?.trim()
  if (!pepper) throw new Error('Falta EMAIL_VERIFICATION_PEPPER.')
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`${challengeId}:${code}:${pepper}`))
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('')
}

async function sendCode(supabaseUrl: string, serviceRoleKey: string, email: string, code: string): Promise<boolean> {
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
  return response.ok
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
  const admin = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false } })
  let body: RequestBody
  try { body = await request.json() } catch { return jsonResponse(400, { success: false, message: 'Cuerpo JSON inválido.' }) }

  if (body.action === 'register') {
    const username = body.username?.trim().toLowerCase()
    const password = body.password
    const fullName = body.fullName?.trim()
    const email = body.email?.trim().toLowerCase()
    if (!username || !password || !fullName || !email) return jsonResponse(400, { success: false, message: 'Faltan datos obligatorios.' })
    if (password.length < 6) return jsonResponse(400, { success: false, message: 'La contraseña debe tener al menos 6 caracteres.' })
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return jsonResponse(400, { success: false, message: 'El email no es válido.' })

    const { data: duplicate } = await admin.from('professionals').select('id').or(`username.ilike.${username},email.ilike.${email}`).limit(1).maybeSingle()
    if (duplicate) return jsonResponse(409, { success: false, message: 'El usuario o email ya está registrado.' })
    const { data: professional, error } = await admin.from('professionals').insert({ username, password_hash: await bcrypt.hash(password, BCRYPT_ROUNDS), full_name: fullName, specialty: body.specialty?.trim() || '', license_number: body.licenseNumber?.trim() || '', dni: body.dni?.trim() || null, email, network_memberships_json: body.networkMemberships || [], email_verified_at: null, subscription_status: 'trial', trial_started_at: new Date().toISOString() }).select('id, email').single()
    if (error || !professional) return jsonResponse(500, { success: false, message: error?.message || 'No se pudo crear la cuenta.' })
    const challengeId = crypto.randomUUID()
    const code = createCode()
    const { error: challengeError } = await admin.from('professional_email_verification_challenges').insert({ id: challengeId, professional_id: professional.id, email, code_hash: await hashCode(challengeId, code), expires_at: new Date(Date.now() + CODE_TTL_MINUTES * 60 * 1000).toISOString() })
    if (challengeError || !(await sendCode(supabaseUrl, serviceRoleKey, email, code))) return jsonResponse(502, { success: false, message: 'La cuenta quedó pendiente, pero no se pudo enviar el código. Usá reenviar código.' })
    return jsonResponse(200, { success: true, professionalId: professional.id, email })
  }

  const professionalId = body.professionalId?.trim()
  if (!professionalId) return jsonResponse(400, { success: false, message: 'Falta el profesional.' })
  const { data: professional } = await admin.from('professionals').select(`${PROFESSIONAL_PUBLIC_COLUMNS}, email_verified_at`).eq('id', professionalId).maybeSingle()
  if (!professional) return jsonResponse(404, { success: false, message: 'No se encontró la cuenta.' })
  if (professional.email_verified_at) return jsonResponse(200, { success: true, alreadyVerified: true })

  if (body.action === 'resend') {
    const code = createCode()
    const challengeId = crypto.randomUUID()
    await admin.from('professional_email_verification_challenges').update({ consumed_at: new Date().toISOString() }).eq('professional_id', professionalId).is('consumed_at', null)
    const { error } = await admin.from('professional_email_verification_challenges').insert({ id: challengeId, professional_id: professionalId, email: professional.email, code_hash: await hashCode(challengeId, code), expires_at: new Date(Date.now() + CODE_TTL_MINUTES * 60 * 1000).toISOString() })
    if (error || !(await sendCode(supabaseUrl, serviceRoleKey, professional.email, code))) return jsonResponse(502, { success: false, message: 'No se pudo reenviar el código.' })
    return jsonResponse(200, { success: true, email: professional.email })
  }

  if (body.action === 'verify') {
    const code = body.code?.trim() || ''
    if (!/^\d{6}$/.test(code)) return jsonResponse(400, { success: false, message: 'El código debe tener 6 dígitos.' })
    const { data: challenge } = await admin.from('professional_email_verification_challenges').select('id, code_hash, attempts, expires_at').eq('professional_id', professionalId).is('consumed_at', null).gt('expires_at', new Date().toISOString()).order('created_at', { ascending: false }).limit(1).maybeSingle()
    if (!challenge || challenge.attempts >= MAX_ATTEMPTS) return jsonResponse(400, { success: false, message: 'El código venció o superó el límite de intentos.' })
    const expectedHash = await hashCode(challenge.id, code)
    if (expectedHash !== challenge.code_hash) {
      await admin.from('professional_email_verification_challenges').update({ attempts: challenge.attempts + 1 }).eq('id', challenge.id)
      return jsonResponse(400, { success: false, message: 'El código no es válido.' })
    }
    await admin.from('professional_email_verification_challenges').update({ consumed_at: new Date().toISOString() }).eq('id', challenge.id)
    await admin.from('professionals').update({ email_verified_at: new Date().toISOString() }).eq('id', professionalId)
    const { data: publicProfessional } = await admin.from('professionals').select(PROFESSIONAL_PUBLIC_COLUMNS).eq('id', professionalId).single()
    return jsonResponse(200, { success: true, professional: publicProfessional, sessionToken: await createProfessionalSession(admin, professionalId) })
  }

  return jsonResponse(400, { success: false, message: 'Acción no soportada.' })
})
