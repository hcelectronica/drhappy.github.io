import { serve } from 'https://deno.land/std@0.224.0/http/server.ts'
import { createClient, type SupabaseClient } from 'jsr:@supabase/supabase-js@2'
import bcrypt from 'npm:bcryptjs@2.4.3'
import { corsHeaders as baseCorsHeaders } from '../_shared/cors.ts'
import { resolveProfessionalId } from '../_shared/professionalSession.ts'
import { sendPatientRegistrationNotice } from '../_shared/patientRegistrationEmail.ts'
import { GlucoseInputError, parseGlucoseReading, parseDiabetesTreatment } from '../_shared/patientGlucose.ts'

// Carpeta de Salud: cuentas de pacientes separadas de los profesionales.
// Toda la lectura/escritura pasa por esta función con service_role; el bucket es privado.

const BUCKET = 'patient-folders'
const SESSION_HEADER = 'x-drhappy-patient-session'
const SESSION_DURATION_MS = 1000 * 60 * 60 * 24 * 30
const BCRYPT_ROUNDS = 10
const CODE_TTL_MINUTES = 15
const MAX_CODE_ATTEMPTS = 5
const MAX_LOGIN_FAILURES = 8
const LOCK_MINUTES = 15
const MAX_FILE_BYTES = 10 * 1024 * 1024
const ALLOWED_MIME: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'application/pdf': 'pdf',
}
const CATEGORIES = new Set(['laboratorio', 'imagenes', 'informes', 'vacunas', 'otros'])
const CONSENT_VERSION = 'v1'
const SHARE_URL_TTL_SECONDS = 600
const MAX_ACTIVE_LINKS = 20
const MAX_SHARE_CODE_FAILURES = 10
const SHARE_DAYS = new Set([1, 7, 30])
const PUBLIC_SITE_URL = 'https://www.drhappy.com.ar'
const LINK_RETRY_DAYS = 7

const corsHeaders = {
  ...baseCorsHeaders,
  'Access-Control-Allow-Headers': `${baseCorsHeaders['Access-Control-Allow-Headers']}, ${SESSION_HEADER}`,
}

type Body = Record<string, unknown> & { action?: string }

type PatientRow = {
  id: string
  email: string
  password_hash: string
  full_name: string
  first_name: string | null
  last_name: string | null
  dni: string
  birth_date: string | null
  phone: string | null
  email_verified_at: string | null
  storage_used_bytes: number
  storage_quota_bytes: number
  failed_login_count: number
  locked_until: string | null
  active: boolean
  created_at: string
}

const PATIENT_COLUMNS = 'id, email, password_hash, full_name, first_name, last_name, dni, birth_date, phone, email_verified_at, storage_used_bytes, storage_quota_bytes, failed_login_count, locked_until, active, created_at'

function reply(status: number, body: Record<string, unknown>): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
}

function text(value: unknown, max: number): string {
  return typeof value === 'string' ? value.trim().slice(0, max) : ''
}

function normalizeEmail(value: unknown): string {
  return text(value, 254).toLowerCase()
}

function normalizeDni(value: unknown): string {
  return text(value, 20).replace(/\D/g, '')
}

function validDate(value: unknown): string | null {
  const raw = text(value, 10)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) return null
  const date = new Date(`${raw}T00:00:00Z`)
  if (Number.isNaN(date.getTime()) || date.getUTCFullYear() < 1900 || date.getTime() > Date.now() + 86400000) return null
  return raw
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character] || character)
}

async function sha256(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('')
}

function createCode(): string {
  const value = new Uint32Array(1)
  const range = 900000
  const ceiling = Math.floor(0x100000000 / range) * range
  do crypto.getRandomValues(value)
  while (value[0] >= ceiling)
  return String(100000 + (value[0] % range))
}

function publicPatient(row: PatientRow) {
  return {
    id: row.id,
    email: row.email,
    fullName: row.full_name,
    firstName: row.first_name ?? '',
    lastName: row.last_name ?? '',
    dni: row.dni,
    birthDate: row.birth_date,
    phone: row.phone,
    storageUsedBytes: Number(row.storage_used_bytes) || 0,
    storageQuotaBytes: Number(row.storage_quota_bytes) || 0,
    createdAt: row.created_at,
  }
}

serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (request.method !== 'POST') return reply(405, { success: false, message: 'Método no permitido.' })

  const supabaseUrl = Deno.env.get('SUPABASE_URL')?.trim()
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')?.trim()
  if (!supabaseUrl || !serviceRoleKey) return reply(500, { success: false, message: 'Falta configuración del servidor.' })
  const admin = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false } })
  const pepper = Deno.env.get('EMAIL_VERIFICATION_PEPPER')?.trim() || serviceRoleKey

  let body: Body
  try { body = await request.json() } catch { return reply(400, { success: false, message: 'Cuerpo JSON inválido.' }) }
  const action = text(body.action, 40)

  const hashCode = (patientId: string, purpose: string, code: string) => sha256(`patient-code:${purpose}:${patientId}:${code}:${pepper}`)

  async function sendEmail(to: string, subject: string, html: string): Promise<boolean> {
    try {
      const response = await fetch(`${supabaseUrl}/functions/v1/send-email`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${serviceRoleKey}`, apikey: serviceRoleKey!, 'Content-Type': 'application/json' },
        body: JSON.stringify({ to, subject, type: 'custom', html }),
      })
      if (!response.ok) return false
      const result = await response.json().catch(() => null) as { success?: unknown } | null
      return result?.success === true
    } catch {
      return false
    }
  }

  async function issueCode(patient: PatientRow, purpose: 'verify' | 'reset'): Promise<boolean> {
    const code = createCode()
    await admin.from('patient_email_codes').update({ consumed_at: new Date().toISOString() })
      .eq('patient_id', patient.id).eq('purpose', purpose).is('consumed_at', null)
    const { error } = await admin.from('patient_email_codes').insert({
      patient_id: patient.id,
      purpose,
      code_hash: await hashCode(patient.id, purpose, code),
      expires_at: new Date(Date.now() + CODE_TTL_MINUTES * 60000).toISOString(),
    })
    if (error) return false
    const intro = purpose === 'verify'
      ? 'Tu código para activar tu Carpeta de Salud en Dr Happy es:'
      : 'Tu código para crear una nueva contraseña de tu Carpeta de Salud es:'
    return sendEmail(
      patient.email,
      purpose === 'verify' ? 'Activá tu Carpeta de Salud — Dr Happy' : 'Recuperá tu contraseña — Carpeta de Salud Dr Happy',
      `<p>Hola ${escapeHtml(patient.full_name.split(' ')[0] || '')},</p><p>${intro}</p><div style="font-size:34px;font-weight:800;letter-spacing:6px;text-align:center;color:#0f766e;margin:24px 0;">${code}</div><p>Vence en ${CODE_TTL_MINUTES} minutos. Si no lo pediste, podés ignorar este mensaje.</p>`,
    )
  }

  async function consumeCode(patient: PatientRow, purpose: 'verify' | 'reset', code: string): Promise<string | null> {
    const { data: challenge } = await admin.from('patient_email_codes')
      .select('id, code_hash, attempts, expires_at')
      .eq('patient_id', patient.id).eq('purpose', purpose).is('consumed_at', null)
      .order('created_at', { ascending: false }).limit(1).maybeSingle()
    if (!challenge || new Date(challenge.expires_at).getTime() < Date.now()) return 'El código venció. Pedí uno nuevo.'
    if (challenge.attempts >= MAX_CODE_ATTEMPTS) return 'Superaste los intentos permitidos. Pedí un código nuevo.'
    if (await hashCode(patient.id, purpose, code) !== challenge.code_hash) {
      await admin.from('patient_email_codes').update({ attempts: challenge.attempts + 1 }).eq('id', challenge.id)
      return 'El código no es correcto.'
    }
    await admin.from('patient_email_codes').update({ consumed_at: new Date().toISOString() }).eq('id', challenge.id)
    return null
  }

  async function createSession(patientId: string): Promise<string> {
    const token = `${crypto.randomUUID()}-${crypto.randomUUID()}`
    const { error } = await admin.from('patient_sessions').insert({
      patient_id: patientId,
      token_hash: await sha256(token),
      expires_at: new Date(Date.now() + SESSION_DURATION_MS).toISOString(),
    })
    if (error) throw new Error('No se pudo iniciar la sesión.')
    await admin.from('patient_accounts').update({ last_login_at: new Date().toISOString(), failed_login_count: 0, locked_until: null }).eq('id', patientId)
    return token
  }

  async function findByEmail(email: string): Promise<PatientRow | null> {
    const { data } = await admin.from('patient_accounts').select(PATIENT_COLUMNS).ilike('email', email).limit(1).maybeSingle()
    return (data as PatientRow | null) ?? null
  }

  async function resolveSession(): Promise<PatientRow | null> {
    const token = request.headers.get(SESSION_HEADER)?.trim()
    if (!token) return null
    const { data } = await admin.from('patient_sessions')
      .select('patient_id')
      .eq('token_hash', await sha256(token))
      .is('revoked_at', null)
      .gt('expires_at', new Date().toISOString())
      .maybeSingle()
    if (!data?.patient_id) return null
    const { data: patient } = await admin.from('patient_accounts').select(PATIENT_COLUMNS).eq('id', data.patient_id).maybeSingle()
    const row = patient as PatientRow | null
    return row?.active && row.email_verified_at ? row : null
  }

  async function log(patientId: string, logAction: string, documentId?: string) {
    await admin.from('patient_access_log').insert({ patient_id: patientId, action: logAction, document_id: documentId ?? null })
  }

  async function recalcUsage(client: SupabaseClient, patientId: string): Promise<number> {
    const { data } = await client.from('patient_documents').select('size_bytes')
      .eq('patient_id', patientId).eq('status', 'ready').is('deleted_at', null)
    const total = (data ?? []).reduce((sum, row) => sum + (Number(row.size_bytes) || 0), 0)
    await client.from('patient_accounts').update({ storage_used_bytes: total, updated_at: new Date().toISOString() }).eq('id', patientId)
    return total
  }

  type ShareRow = {
    id: string
    patient_id: string
    kind: 'doctor' | 'link'
    professional_id: string | null
    token: string | null
    code_hash: string | null
    failed_attempts: number
    all_documents: boolean
    document_ids: string[] | null
    expires_at: string | null
    revoked_at: string | null
    last_accessed_at: string | null
    access_count: number
    include_pressure: boolean
    include_glucose: boolean
    created_at: string
  }
  const SHARE_COLUMNS = 'id, patient_id, kind, professional_id, token, code_hash, failed_attempts, all_documents, document_ids, expires_at, revoked_at, last_accessed_at, access_count, include_pressure, include_glucose, created_at'

  async function glucoseRecord(patientId: string) {
    const { data: readings, count, error } = await admin.from('patient_glucose_readings')
      .select('id, measured_at, value, context, method, note', { count: 'exact' }).eq('patient_id', patientId).is('deleted_at', null)
      .order('measured_at', { ascending: false }).limit(1000)
    if (error) throw error
    const { data: profile, error: profileError } = await admin.from('patient_diabetes_profiles')
      .select('treatment, updated_at').eq('patient_id', patientId).maybeSingle()
    if (profileError) throw profileError
    return { readings: (readings ?? []).map(row => ({ id: row.id, measuredAt: row.measured_at, value: row.value,
      context: row.context, method: row.method, note: row.note })), totalReadings: count ?? 0, treatment: profile?.treatment ?? null, updatedAt: profile?.updated_at ?? null }
  }

  async function pressureReadings(patientId: string, days = 365) {
    const { data, error } = await admin.from('patient_bp_readings')
      .select('id, measured_at, systolic, diastolic, pulse, note')
      .eq('patient_id', patientId).is('deleted_at', null)
      .gte('measured_at', new Date(Date.now() - days * 86400000).toISOString())
      .order('measured_at', { ascending: false }).limit(1000)
    if (error) throw error
    return (data ?? []).map((row) => ({
      id: row.id, measuredAt: row.measured_at, systolic: row.systolic, diastolic: row.diastolic, pulse: row.pulse, note: row.note,
    }))
  }
  const hashShareCode = (shareId: string, code: string) => sha256(`patient-share:${shareId}:${code}:${pepper}`)

  function splitName(row: Pick<PatientRow, 'full_name' | 'first_name' | 'last_name'>): { nombre: string; apellido: string } {
    if (row.first_name && row.last_name) return { nombre: row.first_name, apellido: row.last_name }
    const parts = row.full_name.trim().split(/\s+/)
    if (parts.length < 2) return { nombre: parts[0] || '', apellido: parts[0] || '' }
    return { nombre: parts.slice(0, -1).join(' '), apellido: parts[parts.length - 1] }
  }

  async function sharedDocuments(share: Pick<ShareRow, 'patient_id' | 'all_documents' | 'document_ids'>) {
    let query = admin.from('patient_documents')
      .select('id, title, category, study_date, notes, mime_type, size_bytes, file_path, created_at')
      .eq('patient_id', share.patient_id).eq('status', 'ready').is('deleted_at', null)
    if (!share.all_documents) {
      const ids = share.document_ids ?? []
      if (!ids.length) return []
      query = query.in('id', ids)
    }
    const { data, error } = await query.order('study_date', { ascending: false, nullsFirst: false }).order('created_at', { ascending: false }).limit(500)
    if (error) throw error
    return data ?? []
  }

  function documentFileName(title: string, path: string): string {
    return `${title.replace(/[^\p{L}\p{N} _-]/gu, '').trim().slice(0, 60) || 'estudio'}.${path.split('.').pop()}`
  }

  async function signedViewUrl(path: string, title: string, download = false): Promise<string> {
    const { data, error } = await admin.storage.from(BUCKET)
      .createSignedUrl(path, SHARE_URL_TTL_SECONDS, download ? { download: documentFileName(title, path) } : undefined)
    if (error || !data) throw error || new Error('No se pudo abrir el archivo.')
    return data.signedUrl
  }

  async function validDocumentIds(patientId: string, raw: unknown): Promise<string[]> {
    const ids = Array.isArray(raw) ? raw.filter((id): id is string => typeof id === 'string' && /^[0-9a-f-]{36}$/i.test(id)).slice(0, 500) : []
    if (!ids.length) return []
    const { data } = await admin.from('patient_documents').select('id')
      .eq('patient_id', patientId).eq('status', 'ready').is('deleted_at', null).in('id', ids)
    return (data ?? []).map((row) => row.id)
  }

  async function findProfessional(rawQuery: string) {
    const raw = rawQuery.trim()
    if (!raw) return null
    let professionalId: string | null = null
    if (raw.includes('@') && !raw.includes('/')) {
      const { data } = await admin.from('professionals').select('id').ilike('email', raw.toLowerCase()).limit(1).maybeSingle()
      professionalId = data?.id ?? null
    } else {
      const token = (raw.match(/registro\/([a-z0-9-]+)/i)?.[1] ?? raw).toLowerCase()
      if (/^[a-z0-9-]{6,80}$/.test(token)) {
        const { data } = await admin.from('patient_invite_links').select('professional_id').eq('token', token).maybeSingle()
        professionalId = data?.professional_id ?? null
      }
    }
    if (!professionalId) return null
    const { data: professional } = await admin.from('professionals').select('id, full_name, specialty, email, active').eq('id', professionalId).maybeSingle()
    return professional && professional.active !== false ? professional : null
  }

  try {
    // ---------- Acciones públicas ----------
    if (action === 'register') {
      const email = normalizeEmail(body.email)
      const password = typeof body.password === 'string' ? body.password : ''
      const firstName = text(body.firstName, 80)
      const lastName = text(body.lastName, 80)
      const fullName = firstName && lastName ? `${firstName} ${lastName}` : text(body.fullName, 160)
      const dni = normalizeDni(body.dni)
      const birthDate = validDate(body.birthDate)
      const phone = text(body.phone, 40) || null
      if (!fullName || !email || !password || !dni) return reply(400, { success: false, message: 'Completá nombre, apellido, DNI, email y contraseña.' })
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return reply(400, { success: false, message: 'El email no es válido.' })
      if (dni.length < 6 || dni.length > 10) return reply(400, { success: false, message: 'Revisá el DNI (solo números).' })
      if (password.length < 8 || password.length > 200) return reply(400, { success: false, message: 'La contraseña debe tener al menos 8 caracteres.' })
      if (body.consent !== true) return reply(400, { success: false, message: 'Necesitamos que aceptes los términos de privacidad.' })

      const existing = await findByEmail(email)
      if (existing?.email_verified_at) return reply(409, { success: false, message: 'Ese email ya tiene una Carpeta de Salud. Ingresá o recuperá tu contraseña.' })
      if (existing) {
        const { data: last } = await admin.from('patient_email_codes').select('created_at')
          .eq('patient_id', existing.id).order('created_at', { ascending: false }).limit(1).maybeSingle()
        if (last && Date.now() - new Date(last.created_at).getTime() < 45000) {
          return reply(429, { success: false, message: 'Ya te enviamos un código. Esperá unos segundos antes de pedir otro.' })
        }
      }
      const now = new Date().toISOString()
      const values = {
        email, password_hash: await bcrypt.hash(password, BCRYPT_ROUNDS), full_name: fullName,
        first_name: firstName || null, last_name: lastName || null, dni, birth_date: birthDate, phone,
        consent_accepted_at: now, consent_version: CONSENT_VERSION, updated_at: now,
      }
      let patient: PatientRow
      if (existing) {
        const { data, error } = await admin.from('patient_accounts').update(values).eq('id', existing.id).select(PATIENT_COLUMNS).single()
        if (error) throw error
        patient = data as PatientRow
      } else {
        const { data, error } = await admin.from('patient_accounts').insert(values).select(PATIENT_COLUMNS).single()
        if (error) {
          if (error.code === '23505') return reply(409, { success: false, message: 'Ese email ya está registrado.' })
          throw error
        }
        patient = data as PatientRow
      }
      if (!await issueCode(patient, 'verify')) return reply(502, { success: false, message: 'No pudimos enviar el código por email. Intentá nuevamente en unos minutos.' })
      return reply(200, { success: true, step: 'verify', email })
    }

    if (action === 'resend-code') {
      const email = normalizeEmail(body.email)
      const purpose = body.purpose === 'reset' ? 'reset' : 'verify'
      const patient = email ? await findByEmail(email) : null
      if (patient && patient.active && (purpose === 'reset' ? Boolean(patient.email_verified_at) : !patient.email_verified_at)) {
        const { data: last } = await admin.from('patient_email_codes').select('created_at')
          .eq('patient_id', patient.id).eq('purpose', purpose).order('created_at', { ascending: false }).limit(1).maybeSingle()
        if (last && Date.now() - new Date(last.created_at).getTime() < 45000) {
          return reply(429, { success: false, message: 'Esperá unos segundos antes de pedir otro código.' })
        }
        await issueCode(patient, purpose)
      }
      return reply(200, { success: true, message: 'Si el email está registrado, te enviamos un código nuevo.' })
    }

    if (action === 'verify') {
      const email = normalizeEmail(body.email)
      const code = text(body.code, 6)
      const patient = email ? await findByEmail(email) : null
      if (!patient || !patient.active || !/^\d{6}$/.test(code)) return reply(400, { success: false, message: 'El código no es correcto.' })
      if (patient.email_verified_at) return reply(400, { success: false, message: 'Tu cuenta ya está activa. Ingresá con tu email y contraseña.' })
      const problem = await consumeCode(patient, 'verify', code)
      if (problem) return reply(400, { success: false, message: problem })
      const { data: verified, error: verifyError } = await admin.from('patient_accounts')
        .update({ email_verified_at: new Date().toISOString() }).eq('id', patient.id)
        .is('email_verified_at', null).select('id').maybeSingle()
      if (verifyError) throw verifyError
      if (!verified) return reply(409, { success: false, message: 'Tu cuenta ya está activa. Ingresá con tu email y contraseña.' })
      await log(patient.id, 'account_verified')
      const token = await createSession(patient.id)
      let adminEmailSent = false
      try {
        adminEmailSent = await sendPatientRegistrationNotice(admin, supabaseUrl, serviceRoleKey, patient.id)
      } catch (error) {
        console.error('[patient-registration-email] No se pudo procesar el aviso', error)
      }
      return reply(200, { success: true, sessionToken: token, patient: publicPatient(patient), adminEmailSent })
    }

    if (action === 'login') {
      const email = normalizeEmail(body.email)
      const password = typeof body.password === 'string' ? body.password : ''
      const invalid = () => reply(401, { success: false, message: 'Email o contraseña incorrectos.' })
      if (!email || !password || password.length > 200) return invalid()
      const patient = await findByEmail(email)
      if (!patient || !patient.active) {
        await bcrypt.hash(password, BCRYPT_ROUNDS)
        return invalid()
      }
      if (patient.locked_until && new Date(patient.locked_until).getTime() > Date.now()) {
        return reply(429, { success: false, message: 'Demasiados intentos. Probá de nuevo en unos minutos o recuperá tu contraseña.' })
      }
      if (!await bcrypt.compare(password, patient.password_hash)) {
        const failures = (patient.failed_login_count || 0) + 1
        const locked = failures >= MAX_LOGIN_FAILURES
        await admin.from('patient_accounts').update({
          failed_login_count: locked ? 0 : failures,
          locked_until: locked ? new Date(Date.now() + LOCK_MINUTES * 60000).toISOString() : null,
        }).eq('id', patient.id)
        return invalid()
      }
      if (!patient.email_verified_at) {
        await issueCode(patient, 'verify')
        return reply(200, { success: true, step: 'verify', email: patient.email, message: 'Te enviamos un código para activar tu cuenta.' })
      }
      const token = await createSession(patient.id)
      await log(patient.id, 'login')
      return reply(200, { success: true, sessionToken: token, patient: publicPatient(patient) })
    }

    if (action === 'request-reset') {
      const email = normalizeEmail(body.email)
      const patient = email ? await findByEmail(email) : null
      if (patient?.active && patient.email_verified_at) {
        const { data: last } = await admin.from('patient_email_codes').select('created_at')
          .eq('patient_id', patient.id).eq('purpose', 'reset').order('created_at', { ascending: false }).limit(1).maybeSingle()
        if (!last || Date.now() - new Date(last.created_at).getTime() >= 45000) await issueCode(patient, 'reset')
      }
      return reply(200, { success: true, message: 'Si el email está registrado, te enviamos un código.' })
    }

    if (action === 'reset-password') {
      const email = normalizeEmail(body.email)
      const code = text(body.code, 6)
      const password = typeof body.password === 'string' ? body.password : ''
      if (password.length < 8 || password.length > 200) return reply(400, { success: false, message: 'La contraseña debe tener al menos 8 caracteres.' })
      const patient = email ? await findByEmail(email) : null
      if (!patient?.active || !patient.email_verified_at || !/^\d{6}$/.test(code)) return reply(400, { success: false, message: 'El código no es correcto.' })
      const problem = await consumeCode(patient, 'reset', code)
      if (problem) return reply(400, { success: false, message: problem })
      await admin.from('patient_accounts').update({ password_hash: await bcrypt.hash(password, BCRYPT_ROUNDS), updated_at: new Date().toISOString() }).eq('id', patient.id)
      await admin.from('patient_sessions').update({ revoked_at: new Date().toISOString() }).eq('patient_id', patient.id).is('revoked_at', null)
      await log(patient.id, 'password_reset')
      const token = await createSession(patient.id)
      return reply(200, { success: true, sessionToken: token, patient: publicPatient(patient) })
    }

    // ---------- Link público (médico externo) ----------
    if (action === 'open-share') {
      const token = text(body.token, 60)
      const code = text(body.code, 6)
      const notFound = () => reply(404, { success: false, message: 'Este link no existe, venció o el paciente dejó de compartirlo.' })
      if (!/^[A-Za-z0-9_-]{16,60}$/.test(token)) return notFound()
      const { data: shareData } = await admin.from('patient_shares').select(SHARE_COLUMNS).eq('token', token).eq('kind', 'link').maybeSingle()
      const share = shareData as ShareRow | null
      if (!share || share.revoked_at || !share.expires_at || new Date(share.expires_at).getTime() < Date.now()) return notFound()
      if (share.failed_attempts >= MAX_SHARE_CODE_FAILURES) return notFound()
      if (!/^\d{6}$/.test(code)) return reply(400, { success: false, step: 'code', message: 'Ingresá el código de 6 números que te dio el paciente.' })
      if (await hashShareCode(share.id, code) !== share.code_hash) {
        const failures = share.failed_attempts + 1
        await admin.from('patient_shares').update({
          failed_attempts: failures,
          ...(failures >= MAX_SHARE_CODE_FAILURES ? { revoked_at: new Date().toISOString() } : {}),
        }).eq('id', share.id)
        return reply(400, { success: false, step: 'code', message: 'El código no es correcto.' })
      }
      const { data: owner } = await admin.from('patient_accounts').select('full_name, birth_date, active').eq('id', share.patient_id).maybeSingle()
      if (!owner?.active) return notFound()
      const docs = await sharedDocuments(share)
      const documents = await Promise.all(docs.map(async (row) => ({
        id: row.id, title: row.title, category: row.category, studyDate: row.study_date, notes: row.notes,
        mimeType: row.mime_type, sizeBytes: Number(row.size_bytes) || 0,
        url: await signedViewUrl(row.file_path, row.title),
        downloadUrl: await signedViewUrl(row.file_path, row.title, true),
      })))
      await admin.from('patient_shares').update({
        access_count: share.access_count + 1, last_accessed_at: new Date().toISOString(), failed_attempts: 0,
      }).eq('id', share.id)
      await log(share.patient_id, 'share_link_opened')
      return reply(200, {
        success: true,
        patientName: owner.full_name,
        birthDate: owner.birth_date,
        expiresAt: share.expires_at,
        urlTtlSeconds: SHARE_URL_TTL_SECONDS,
        documents,
        pressure: share.include_pressure ? await pressureReadings(share.patient_id) : [],
        glucose: share.include_glucose ? await glucoseRecord(share.patient_id) : null,
      })
    }

    // ---------- Acciones del profesional (app Dr Happy) ----------
    if (action.startsWith('doctor-')) {
      const professionalId = await resolveProfessionalId(request, admin)
      if (!professionalId) return reply(401, { success: false, message: 'Sesión profesional requerida.' })

      if (action === 'doctor-pull-links') {
        const { data, error } = await admin.from('patient_shares')
          .select('id, created_at, patient_accounts!inner(full_name, first_name, last_name, dni, birth_date, phone, email, active)')
          .eq('kind', 'doctor').eq('professional_id', professionalId).is('revoked_at', null).is('imported_at', null)
          .order('created_at', { ascending: true }).limit(200)
        if (error) throw error
        const links = (data ?? []).flatMap((row) => {
          const account = row.patient_accounts as unknown as Pick<PatientRow, 'full_name' | 'first_name' | 'last_name' | 'dni' | 'birth_date' | 'phone' | 'email' | 'active'>
          if (!account?.active) return []
          const { nombre, apellido } = splitName(account)
          return [{
            id: row.id, created_at: row.created_at, nombre, apellido, dni: account.dni,
            birth_date: account.birth_date, phone: account.phone, email: account.email,
          }]
        })
        return reply(200, { success: true, links })
      }

      if (action === 'doctor-ack-links') {
        const ids = Array.isArray(body.ids) ? body.ids.filter((id): id is string => typeof id === 'string' && /^[0-9a-f-]{36}$/i.test(id)).slice(0, 200) : []
        if (ids.length) {
          const { error } = await admin.from('patient_shares').update({ imported_at: new Date().toISOString() })
            .eq('kind', 'doctor').eq('professional_id', professionalId).in('id', ids)
          if (error) throw error
        }
        return reply(200, { success: true })
      }

      // Solo informa si el DNI está agendado por este profesional, para no revelar quién tiene carpeta.
      async function doctorHasDni(dni: string): Promise<boolean> {
        const { data, error } = await admin.rpc('professionals_with_patient_dni', { p_dni: dni, p_email: null })
        if (error) throw error
        return ((data ?? []) as Array<{ professional_id: string }>).some((row) => row.professional_id === professionalId)
      }

      async function verifiedAccountsByDni(dni: string) {
        const { data } = await admin.from('patient_accounts').select('id, full_name, email, email_verified_at')
          .eq('dni', dni).eq('active', true).not('email_verified_at', 'is', null).limit(5)
        return data ?? []
      }

      if (action === 'doctor-folder') {
        const dni = normalizeDni(body.dni)
        const noAccount = { hasAccount: false, status: 'none', canRequest: false }
        if (dni.length < 6) return reply(200, { success: true, folders: [], carpeta: noAccount })
        const { data: accounts } = await admin.from('patient_accounts').select('id, full_name').eq('dni', dni).eq('active', true).limit(5)
        if (!accounts?.length) return reply(200, { success: true, folders: [], carpeta: noAccount })
        const { data: shares, error } = await admin.from('patient_shares').select(SHARE_COLUMNS)
          .eq('kind', 'doctor').eq('professional_id', professionalId).is('revoked_at', null)
          .in('patient_id', accounts.map((account) => account.id))
        if (error) throw error
        const folders = await Promise.all(((shares ?? []) as ShareRow[]).map(async (share) => ({
          shareId: share.id,
          patientName: accounts.find((account) => account.id === share.patient_id)?.full_name ?? '',
          sharedAt: share.created_at,
          documents: (await sharedDocuments(share)).map((row) => ({
            id: row.id, title: row.title, category: row.category, studyDate: row.study_date, notes: row.notes,
            mimeType: row.mime_type, sizeBytes: Number(row.size_bytes) || 0,
          })),
          pressure: share.include_pressure ? await pressureReadings(share.patient_id) : [],
          glucose: share.include_glucose ? await glucoseRecord(share.patient_id) : null,
        })))
        let carpeta = noAccount
        if (!folders.length && await doctorHasDni(dni)) {
          const verified = await verifiedAccountsByDni(dni)
          if (verified.length) {
            const { data: requests } = await admin.from('patient_link_requests').select('status, responded_at')
              .eq('professional_id', professionalId).in('patient_id', verified.map((account) => account.id))
            const pending = (requests ?? []).some((row) => row.status === 'pending')
            const lastDecline = (requests ?? []).filter((row) => row.status !== 'pending' && row.responded_at)
              .map((row) => new Date(row.responded_at as string).getTime()).sort((a, b) => b - a)[0]
            const recentlyDeclined = Boolean(lastDecline && Date.now() - lastDecline < LINK_RETRY_DAYS * 86400000)
            carpeta = {
              hasAccount: true,
              status: pending ? 'pending' : recentlyDeclined ? 'declined' : 'none',
              canRequest: !pending && !recentlyDeclined,
            }
          }
        }
        return reply(200, { success: true, folders, carpeta })
      }

      if (action === 'doctor-request-access') {
        const dni = normalizeDni(body.dni)
        if (dni.length < 6 || !await doctorHasDni(dni)) return reply(404, { success: false, message: 'Ese paciente no está en tu lista.' })
        const verified = await verifiedAccountsByDni(dni)
        if (!verified.length) return reply(404, { success: false, message: 'El paciente no tiene Carpeta de Salud.' })
        const { data: professional } = await admin.from('professionals').select('full_name, specialty').eq('id', professionalId).maybeSingle()
        const doctorName = String(professional?.full_name || 'Tu médico').trim()
        for (const account of verified) {
          const { data: existing } = await admin.from('patient_link_requests').select('id, status, responded_at')
            .eq('patient_id', account.id).eq('professional_id', professionalId).maybeSingle()
          if (existing?.status === 'pending') continue
          if (existing?.responded_at && Date.now() - new Date(existing.responded_at).getTime() < LINK_RETRY_DAYS * 86400000) {
            return reply(429, { success: false, message: `El paciente respondió hace poco. Podés volver a pedirlo en ${LINK_RETRY_DAYS} días.` })
          }
          const row = { patient_id: account.id, professional_id: professionalId, source: 'doctor_request', status: 'pending', created_at: new Date().toISOString(), responded_at: null }
          const { error } = existing
            ? await admin.from('patient_link_requests').update(row).eq('id', existing.id)
            : await admin.from('patient_link_requests').insert(row)
          if (error) throw error
          await log(account.id, 'link_requested')
          await sendEmail(
            account.email,
            `${doctorName} te pide ver tu Carpeta de Salud — Dr Happy`,
            `<p>Hola ${escapeHtml(account.full_name)},</p><p><strong>${escapeHtml(doctorName)}</strong>${professional?.specialty ? ` (${escapeHtml(professional.specialty)})` : ''}, que te tiene como paciente en Dr Happy, te pide ver los estudios y el registro de presión de tu Carpeta de Salud.</p><p>Entrá a tu carpeta para aceptar o rechazar el pedido. Si aceptás, podés dejar de compartir cuando quieras.</p><p><a href="${PUBLIC_SITE_URL}/paciente" style="display:inline-block;background:#0f766e;color:#fff;padding:12px 20px;border-radius:10px;text-decoration:none;font-weight:700;">Abrir mi Carpeta de Salud</a></p>`,
          )
        }
        return reply(200, { success: true })
      }

      if (action === 'doctor-document-url') {
        const shareId = text(body.shareId, 40)
        const documentId = text(body.documentId, 40)
        const { data: shareData } = await admin.from('patient_shares').select(SHARE_COLUMNS)
          .eq('id', shareId).eq('kind', 'doctor').eq('professional_id', professionalId).is('revoked_at', null).maybeSingle()
        const share = shareData as ShareRow | null
        if (!share) return reply(404, { success: false, message: 'El paciente dejó de compartir su carpeta.' })
        if (!share.all_documents && !(share.document_ids ?? []).includes(documentId)) return reply(404, { success: false, message: 'Ese estudio ya no está compartido.' })
        const { data: doc } = await admin.from('patient_documents').select('id, file_path, title, mime_type')
          .eq('id', documentId).eq('patient_id', share.patient_id).eq('status', 'ready').is('deleted_at', null).maybeSingle()
        if (!doc) return reply(404, { success: false, message: 'El paciente borró ese estudio.' })
        const url = await signedViewUrl(doc.file_path, doc.title, body.download === true)
        await admin.from('patient_shares').update({ access_count: share.access_count + 1, last_accessed_at: new Date().toISOString() }).eq('id', share.id)
        await log(share.patient_id, 'doctor_viewed', doc.id)
        return reply(200, { success: true, url, mimeType: doc.mime_type })
      }

      return reply(400, { success: false, message: 'Acción no válida.' })
    }

    // ---------- Acciones con sesión de paciente ----------
    const patient = await resolveSession()
    if (!patient) return reply(401, { success: false, code: 'SESSION_EXPIRED', message: 'Tu sesión terminó. Ingresá nuevamente.' })

    if (action === 'activity') {
      const event = text(body.event, 30)
      const feature = text(body.feature, 30) || null
      if (!['heartbeat', 'view', 'game_completed', 'invite_clicked'].includes(event)
        || (event === 'view' && !['home', 'folder', 'upload', 'pressure', 'glucose', 'memory', 'share', 'account'].includes(feature || ''))) {
        return reply(400, { success: false, message: 'Evento de actividad inválido.' })
      }
      const { error } = await admin.rpc('record_patient_activity', { p_patient_id: patient.id, p_event: event, p_feature: feature })
      if (error) throw error
      return reply(200, { success: true })
    }

    if (action === 'me') {
      return reply(200, { success: true, patient: publicPatient(patient) })
    }

    if (action === 'logout') {
      const token = request.headers.get(SESSION_HEADER)?.trim() || ''
      await admin.from('patient_sessions').update({ revoked_at: new Date().toISOString() }).eq('token_hash', await sha256(token))
      return reply(200, { success: true })
    }

    if (action === 'update-profile') {
      const firstName = text(body.firstName, 80)
      const lastName = text(body.lastName, 80)
      const fullName = firstName && lastName ? `${firstName} ${lastName}` : text(body.fullName, 160)
      const phone = text(body.phone, 40) || null
      const birthDate = body.birthDate ? validDate(body.birthDate) : null
      if (!fullName) return reply(400, { success: false, message: 'El nombre es obligatorio.' })
      const { data, error } = await admin.from('patient_accounts')
        .update({
          full_name: fullName, first_name: firstName || patient.first_name, last_name: lastName || patient.last_name,
          phone, birth_date: birthDate, updated_at: new Date().toISOString(),
        })
        .eq('id', patient.id).select(PATIENT_COLUMNS).single()
      if (error) throw error
      return reply(200, { success: true, patient: publicPatient(data as PatientRow) })
    }

    if (action === 'change-password') {
      const current = typeof body.currentPassword === 'string' ? body.currentPassword : ''
      const next = typeof body.newPassword === 'string' ? body.newPassword : ''
      if (next.length < 8 || next.length > 200) return reply(400, { success: false, message: 'La nueva contraseña debe tener al menos 8 caracteres.' })
      if (!await bcrypt.compare(current, patient.password_hash)) return reply(400, { success: false, message: 'La contraseña actual no es correcta.' })
      await admin.from('patient_accounts').update({ password_hash: await bcrypt.hash(next, BCRYPT_ROUNDS), updated_at: new Date().toISOString() }).eq('id', patient.id)
      await log(patient.id, 'password_changed')
      return reply(200, { success: true, message: 'Contraseña actualizada.' })
    }

    if (action === 'list-documents') {
      const { data, error } = await admin.from('patient_documents')
        .select('id, title, category, study_date, notes, mime_type, size_bytes, created_at')
        .eq('patient_id', patient.id).eq('status', 'ready').is('deleted_at', null)
        .order('study_date', { ascending: false, nullsFirst: false }).order('created_at', { ascending: false })
        .limit(500)
      if (error) throw error
      return reply(200, {
        success: true,
        patient: publicPatient(patient),
        documents: (data ?? []).map((row) => ({
          id: row.id, title: row.title, category: row.category, studyDate: row.study_date, notes: row.notes,
          mimeType: row.mime_type, sizeBytes: Number(row.size_bytes) || 0, createdAt: row.created_at,
        })),
      })
    }

    if (action === 'create-upload') {
      const title = text(body.title, 140)
      const category = text(body.category, 30)
      const mimeType = text(body.mimeType, 60).toLowerCase()
      const sizeBytes = Number(body.sizeBytes)
      const studyDate = body.studyDate ? validDate(body.studyDate) : null
      const notes = text(body.notes, 500) || null
      if (!title) return reply(400, { success: false, message: 'Poné un nombre al estudio.' })
      if (!CATEGORIES.has(category)) return reply(400, { success: false, message: 'Elegí una categoría.' })
      if (!ALLOWED_MIME[mimeType]) return reply(400, { success: false, message: 'Solo se aceptan fotos (JPG, PNG, WEBP) o PDF.' })
      if (!Number.isFinite(sizeBytes) || sizeBytes <= 0 || sizeBytes > MAX_FILE_BYTES) return reply(400, { success: false, message: 'Cada archivo puede pesar hasta 10 MB.' })
      const used = await recalcUsage(admin, patient.id)
      if (used + sizeBytes > Number(patient.storage_quota_bytes)) return reply(400, { success: false, message: 'Llegaste al límite de espacio de tu carpeta (50 MB). Borrá estudios que ya no necesites.' })

      // Limpia subidas abandonadas de más de un día.
      const stale = new Date(Date.now() - 86400000).toISOString()
      const { data: abandoned } = await admin.from('patient_documents').select('id, file_path')
        .eq('patient_id', patient.id).eq('status', 'pending').lt('created_at', stale).limit(50)
      if (abandoned?.length) {
        await admin.storage.from(BUCKET).remove(abandoned.map((row) => row.file_path))
        await admin.from('patient_documents').delete().in('id', abandoned.map((row) => row.id))
      }

      const documentId = crypto.randomUUID()
      const path = `${patient.id}/${documentId}.${ALLOWED_MIME[mimeType]}`
      const { error: insertError } = await admin.from('patient_documents').insert({
        id: documentId, patient_id: patient.id, title, category, study_date: studyDate, notes,
        file_path: path, mime_type: mimeType, size_bytes: sizeBytes, status: 'pending',
      })
      if (insertError) throw insertError
      const { data: signed, error: signError } = await admin.storage.from(BUCKET).createSignedUploadUrl(path)
      if (signError || !signed) {
        await admin.from('patient_documents').delete().eq('id', documentId)
        throw signError || new Error('No se pudo preparar la subida.')
      }
      return reply(200, { success: true, documentId, path, uploadToken: signed.token })
    }

    if (action === 'confirm-upload') {
      const documentId = text(body.documentId, 40)
      const { data: doc } = await admin.from('patient_documents').select('id, file_path, status')
        .eq('id', documentId).eq('patient_id', patient.id).is('deleted_at', null).maybeSingle()
      if (!doc) return reply(404, { success: false, message: 'No encontramos ese estudio.' })
      const fileName = doc.file_path.split('/').pop()!
      const { data: objects } = await admin.storage.from(BUCKET).list(patient.id, { search: fileName, limit: 5 })
      const object = objects?.find((item) => item.name === fileName)
      const size = Number((object?.metadata as { size?: number } | undefined)?.size) || 0
      if (!object || size <= 0) return reply(400, { success: false, message: 'El archivo no llegó a subirse. Intentá nuevamente.' })
      if (doc.status !== 'ready') {
        await admin.from('patient_documents').update({ status: 'ready', size_bytes: size, updated_at: new Date().toISOString() }).eq('id', doc.id)
        const total = await recalcUsage(admin, patient.id)
        if (size > MAX_FILE_BYTES || total > Number(patient.storage_quota_bytes)) {
          await admin.storage.from(BUCKET).remove([doc.file_path])
          await admin.from('patient_documents').delete().eq('id', doc.id)
          await recalcUsage(admin, patient.id)
          return reply(400, { success: false, message: 'Llegaste al límite de espacio de tu carpeta (50 MB). Borrá estudios que ya no necesites.' })
        }
        await log(patient.id, 'document_uploaded', doc.id)
      }
      return reply(200, { success: true })
    }

    if (action === 'update-document') {
      const documentId = text(body.documentId, 40)
      const title = text(body.title, 140)
      const category = text(body.category, 30)
      if (!title || !CATEGORIES.has(category)) return reply(400, { success: false, message: 'Revisá nombre y categoría.' })
      const { error } = await admin.from('patient_documents').update({
        title, category, study_date: body.studyDate ? validDate(body.studyDate) : null,
        notes: text(body.notes, 500) || null, updated_at: new Date().toISOString(),
      }).eq('id', documentId).eq('patient_id', patient.id).is('deleted_at', null)
      if (error) throw error
      return reply(200, { success: true })
    }

    if (action === 'delete-document') {
      const documentId = text(body.documentId, 40)
      const { data: doc } = await admin.from('patient_documents').select('id, file_path')
        .eq('id', documentId).eq('patient_id', patient.id).is('deleted_at', null).maybeSingle()
      if (!doc) return reply(404, { success: false, message: 'No encontramos ese estudio.' })
      await admin.storage.from(BUCKET).remove([doc.file_path])
      await admin.from('patient_documents').update({ deleted_at: new Date().toISOString() }).eq('id', doc.id)
      await recalcUsage(admin, patient.id)
      await log(patient.id, 'document_deleted', doc.id)
      return reply(200, { success: true })
    }

    if (action === 'document-url') {
      const documentId = text(body.documentId, 40)
      const { data: doc } = await admin.from('patient_documents').select('id, file_path, title, mime_type')
        .eq('id', documentId).eq('patient_id', patient.id).eq('status', 'ready').is('deleted_at', null).maybeSingle()
      if (!doc) return reply(404, { success: false, message: 'No encontramos ese estudio.' })
      const extension = doc.file_path.split('.').pop()
      const download = body.download === true
        ? `${doc.title.replace(/[^\p{L}\p{N} _-]/gu, '').trim().slice(0, 60) || 'estudio'}.${extension}`
        : undefined
      const { data, error } = await admin.storage.from(BUCKET).createSignedUrl(doc.file_path, 600, download ? { download } : undefined)
      if (error || !data) throw error || new Error('No se pudo abrir el archivo.')
      await log(patient.id, download ? 'document_downloaded' : 'document_viewed', doc.id)
      return reply(200, { success: true, url: data.signedUrl, mimeType: doc.mime_type })
    }

    if (action === 'bp-list') {
      return reply(200, { success: true, readings: await pressureReadings(patient.id, 3650) })
    }

    if (action === 'glucose-list') return reply(200, { success: true, glucose: await glucoseRecord(patient.id) })
    if (action === 'news-preference' || action === 'news-preference-save') {
      if (action === 'news-preference-save') {
        if (typeof body.enabled !== 'boolean') return reply(400, { success: false, message: 'Elegí si querés recibir novedades.' })
        const { error } = await admin.from('patient_email_preferences').upsert({
          email: patient.email.trim().toLowerCase(), opted_in: body.enabled, opted_out: !body.enabled, updated_at: new Date().toISOString(),
        }, { onConflict: 'email' })
        if (error) throw error
      }
      const { data, error } = await admin.from('patient_email_preferences').select('opted_in,opted_out').eq('email', patient.email.trim().toLowerCase()).maybeSingle()
      if (error) throw error
      return reply(200, { success: true, newsEnabled: data?.opted_in === true && data?.opted_out !== true })
    }
    if (action === 'glucose-add') {
      const values = parseGlucoseReading(body)
      const { error } = await admin.from('patient_glucose_readings').insert({ ...values, patient_id: patient.id })
      if (error) throw error
      return reply(200, { success: true, glucose: await glucoseRecord(patient.id) })
    }
    if (action === 'glucose-delete') {
      const { data, error } = await admin.from('patient_glucose_readings').update({ deleted_at: new Date().toISOString() })
        .eq('id', text(body.readingId, 40)).eq('patient_id', patient.id).is('deleted_at', null).select('id')
      if (error) throw error
      if (!data?.length) return reply(404, { success: false, message: 'Esa medición ya no existe.' })
      return reply(200, { success: true })
    }
    if (action === 'diabetes-save') {
      const treatment = parseDiabetesTreatment(body.treatment)
      const { error } = await admin.from('patient_diabetes_profiles').upsert({ patient_id: patient.id, treatment, updated_at: new Date().toISOString() })
      if (error) throw error
      return reply(200, { success: true, glucose: await glucoseRecord(patient.id) })
    }

    if (action === 'bp-add') {
      const systolic = Math.round(Number(body.systolic))
      const diastolic = Math.round(Number(body.diastolic))
      const pulse = body.pulse === null || body.pulse === undefined || body.pulse === '' ? null : Math.round(Number(body.pulse))
      if (!Number.isFinite(systolic) || systolic < 50 || systolic > 300) return reply(400, { success: false, message: 'La presión máxima (sistólica) tiene que estar entre 50 y 300.' })
      if (!Number.isFinite(diastolic) || diastolic < 30 || diastolic > 200) return reply(400, { success: false, message: 'La presión mínima (diastólica) tiene que estar entre 30 y 200.' })
      if (diastolic >= systolic) return reply(400, { success: false, message: 'La mínima tiene que ser menor que la máxima. Revisá si los cargaste al revés.' })
      if (pulse !== null && (!Number.isFinite(pulse) || pulse < 25 || pulse > 250)) return reply(400, { success: false, message: 'El pulso tiene que estar entre 25 y 250.' })
      const measured = body.measuredAt ? new Date(String(body.measuredAt)) : new Date()
      if (Number.isNaN(measured.getTime()) || measured.getTime() > Date.now() + 5 * 60000 || measured.getTime() < Date.now() - 366 * 86400000) {
        return reply(400, { success: false, message: 'Revisá la fecha y hora de la toma.' })
      }
      const { data, error } = await admin.from('patient_bp_readings').insert({
        patient_id: patient.id, measured_at: measured.toISOString(), systolic, diastolic, pulse, note: text(body.note, 200) || null,
      }).select('id, measured_at, systolic, diastolic, pulse, note').single()
      if (error) throw error
      return reply(200, {
        success: true,
        reading: { id: data.id, measuredAt: data.measured_at, systolic: data.systolic, diastolic: data.diastolic, pulse: data.pulse, note: data.note },
      })
    }

    if (action === 'bp-delete') {
      const readingId = text(body.readingId, 40)
      const { data, error } = await admin.from('patient_bp_readings').update({ deleted_at: new Date().toISOString() })
        .eq('id', readingId).eq('patient_id', patient.id).is('deleted_at', null).select('id')
      if (error) throw error
      if (!data?.length) return reply(404, { success: false, message: 'Esa toma ya no existe.' })
      return reply(200, { success: true })
    }

    if (action === 'find-doctor') {
      const professional = await findProfessional(text(body.query, 300))
      if (!professional) return reply(404, { success: false, message: 'No encontramos un médico de Dr Happy con ese email o link. Revisalo o compartí con un link temporal.' })
      return reply(200, { success: true, doctor: { id: professional.id, name: professional.full_name ?? '', specialty: professional.specialty ?? '' } })
    }

    async function shareWithProfessional(
      professional: { id: string; full_name: string | null; email: string | null },
      allDocuments: boolean,
      documentIds: string[],
      includePressure: boolean,
      includeGlucose: boolean,
    ): Promise<boolean> {
      const { data: existing } = await admin.from('patient_shares').select('id')
        .eq('patient_id', patient!.id).eq('kind', 'doctor').eq('professional_id', professional.id).is('revoked_at', null).maybeSingle()
      if (existing) {
        const { error } = await admin.from('patient_shares').update({ all_documents: allDocuments, document_ids: documentIds, include_pressure: includePressure, include_glucose: includeGlucose }).eq('id', existing.id)
        if (error) throw error
        await log(patient!.id, 'share_doctor_updated')
        return true
      }
      const { error } = await admin.from('patient_shares').insert({
        patient_id: patient!.id, kind: 'doctor', professional_id: professional.id, all_documents: allDocuments, document_ids: documentIds,
        include_pressure: includePressure,
        include_glucose: includeGlucose,
      })
      if (error) throw error
      await log(patient!.id, 'share_doctor_created')
      await admin.from('patient_link_requests').update({ status: 'accepted', responded_at: new Date().toISOString() })
        .eq('patient_id', patient!.id).eq('professional_id', professional.id).eq('status', 'pending')
      if (professional.email) {
        const doctorName = escapeHtml(String(professional.full_name || '').trim())
        await sendEmail(
          professional.email,
          `${patient!.full_name} compartió su Carpeta de Salud con vos — Dr Happy`,
          `<p>Hola${doctorName ? ` ${doctorName}` : ''},</p><p><strong>${escapeHtml(patient!.full_name)}</strong> (DNI ${escapeHtml(patient!.dni)}) compartió con vos sus estudios desde su Carpeta de Salud.</p><p>Al abrir Dr Happy lo vas a encontrar en tu lista de pacientes, con sus estudios en la sección <strong>Documentos adjuntos</strong> de la ficha.</p><p><a href="${PUBLIC_SITE_URL}/" style="display:inline-block;background:#0f766e;color:#fff;padding:12px 20px;border-radius:10px;text-decoration:none;font-weight:700;">Abrir Dr Happy</a></p>`,
        )
      }
      return false
    }

    if (action === 'share-with-doctor') {
      const professionalId = text(body.professionalId, 80)
      const { data: professional } = await admin.from('professionals').select('id, full_name, email, active').eq('id', professionalId).maybeSingle()
      if (!professional || professional.active === false) return reply(404, { success: false, message: 'No encontramos a ese médico.' })
      const allDocuments = body.allDocuments !== false
      const includePressure = body.includePressure !== false
      const includeGlucose = body.includeGlucose === true
      const documentIds = allDocuments ? [] : await validDocumentIds(patient.id, body.documentIds)
      if (!allDocuments && !documentIds.length && !includePressure && !includeGlucose) return reply(400, { success: false, message: 'Elegí al menos un estudio o registro de salud para compartir.' })
      const updated = await shareWithProfessional(professional, allDocuments, documentIds, includePressure, includeGlucose)
      return reply(200, { success: true, updated })
    }

    // Médicos que ya tienen agendado a este paciente: con DNI + email se sugiere solo; con DNI solo, cuando el médico lo pide.
    if (action === 'link-requests') {
      const { data: matches, error: matchError } = await admin.rpc('professionals_with_patient_dni', { p_dni: patient.dni, p_email: patient.email })
      if (matchError) throw matchError
      const { data: doctorShares } = await admin.from('patient_shares').select('professional_id, revoked_at')
        .eq('patient_id', patient.id).eq('kind', 'doctor')
      const sharedWith = new Set((doctorShares ?? []).filter((row) => !row.revoked_at).map((row) => row.professional_id))
      const everShared = new Set((doctorShares ?? []).map((row) => row.professional_id))
      const { data: existingRows } = await admin.from('patient_link_requests').select('id, professional_id, source, status, created_at')
        .eq('patient_id', patient.id)
      const known = new Set((existingRows ?? []).map((row) => row.professional_id))
      const fresh = ((matches ?? []) as Array<{ professional_id: string; email_match: boolean }>)
        .filter((match) => match.email_match && !everShared.has(match.professional_id) && !known.has(match.professional_id))
      if (fresh.length) {
        await admin.from('patient_link_requests').upsert(
          fresh.map((match) => ({ patient_id: patient.id, professional_id: match.professional_id, source: 'email_match', status: 'pending' })),
          { onConflict: 'patient_id,professional_id', ignoreDuplicates: true },
        )
      }
      const { data: pendingRows, error } = await admin.from('patient_link_requests').select('id, professional_id, source, created_at')
        .eq('patient_id', patient.id).eq('status', 'pending').order('created_at', { ascending: true }).limit(20)
      if (error) throw error
      const pending = (pendingRows ?? []).filter((row) => !sharedWith.has(row.professional_id))
      const ids = pending.map((row) => row.professional_id)
      const { data: professionals } = ids.length
        ? await admin.from('professionals').select('id, full_name, specialty, active').in('id', ids)
        : { data: [] as Array<{ id: string; full_name: string | null; specialty: string | null; active: boolean | null }> }
      return reply(200, {
        success: true,
        requests: pending.flatMap((row) => {
          const professional = professionals?.find((item) => item.id === row.professional_id)
          if (!professional || professional.active === false) return []
          return [{ id: row.id, source: row.source, doctorName: professional.full_name ?? '', doctorSpecialty: professional.specialty ?? '' }]
        }),
      })
    }

    if (action === 'link-respond') {
      const requestId = text(body.requestId, 40)
      const { data: requestRow } = await admin.from('patient_link_requests').select('id, professional_id, status')
        .eq('id', requestId).eq('patient_id', patient.id).maybeSingle()
      if (!requestRow || requestRow.status !== 'pending') return reply(404, { success: false, message: 'Ese pedido ya no está pendiente.' })
      if (body.accept !== true) {
        await admin.from('patient_link_requests').update({ status: 'declined', responded_at: new Date().toISOString() }).eq('id', requestRow.id)
        await log(patient.id, 'link_declined')
        return reply(200, { success: true })
      }
      const { data: professional } = await admin.from('professionals').select('id, full_name, email, active').eq('id', requestRow.professional_id).maybeSingle()
      if (!professional || professional.active === false) return reply(404, { success: false, message: 'Ese médico ya no está disponible.' })
      await shareWithProfessional(professional, true, [], body.includePressure !== false, body.includeGlucose === true)
      await admin.from('patient_link_requests').update({ status: 'accepted', responded_at: new Date().toISOString() }).eq('id', requestRow.id)
      return reply(200, { success: true })
    }

    if (action === 'create-link-share') {
      const days = Number(body.days)
      if (!SHARE_DAYS.has(days)) return reply(400, { success: false, message: 'Elegí por cuánto tiempo compartir.' })
      const allDocuments = body.allDocuments !== false
      const includePressure = body.includePressure !== false
      const includeGlucose = body.includeGlucose === true
      const documentIds = allDocuments ? [] : await validDocumentIds(patient.id, body.documentIds)
      if (!allDocuments && !documentIds.length && !includePressure && !includeGlucose) return reply(400, { success: false, message: 'Elegí al menos un estudio o registro de salud para compartir.' })
      const { count } = await admin.from('patient_shares').select('id', { count: 'exact', head: true })
        .eq('patient_id', patient.id).eq('kind', 'link').is('revoked_at', null).gt('expires_at', new Date().toISOString())
      if ((count ?? 0) >= MAX_ACTIVE_LINKS) return reply(400, { success: false, message: 'Tenés demasiados links activos. Desactivá alguno antes de crear otro.' })
      const shareId = crypto.randomUUID()
      const bytes = crypto.getRandomValues(new Uint8Array(18))
      const token = btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
      const code = createCode()
      const expiresAt = new Date(Date.now() + days * 86400000).toISOString()
      const { error } = await admin.from('patient_shares').insert({
        id: shareId, patient_id: patient.id, kind: 'link', token, code_hash: await hashShareCode(shareId, code),
        all_documents: allDocuments, document_ids: documentIds, expires_at: expiresAt, include_pressure: includePressure, include_glucose: includeGlucose,
      })
      if (error) throw error
      await log(patient.id, 'share_link_created')
      return reply(200, { success: true, shareId, url: `${PUBLIC_SITE_URL}/compartido/${token}`, code, expiresAt })
    }

    if (action === 'list-shares') {
      const { data, error } = await admin.from('patient_shares').select(SHARE_COLUMNS)
        .eq('patient_id', patient.id).is('revoked_at', null).order('created_at', { ascending: false }).limit(100)
      if (error) throw error
      const rows = ((data ?? []) as ShareRow[]).filter((row) => row.kind === 'doctor' || (row.expires_at && new Date(row.expires_at).getTime() > Date.now()))
      const professionalIds = [...new Set(rows.map((row) => row.professional_id).filter((id): id is string => Boolean(id)))]
      const { data: professionals } = professionalIds.length
        ? await admin.from('professionals').select('id, full_name, specialty').in('id', professionalIds)
        : { data: [] as Array<{ id: string; full_name: string | null; specialty: string | null }> }
      return reply(200, {
        success: true,
        shares: rows.map((row) => {
          const professional = professionals?.find((item) => item.id === row.professional_id)
          return {
            id: row.id, kind: row.kind, allDocuments: row.all_documents, documentCount: (row.document_ids ?? []).length, includePressure: row.include_pressure, includeGlucose: row.include_glucose,
            expiresAt: row.expires_at, accessCount: row.access_count, lastAccessedAt: row.last_accessed_at, createdAt: row.created_at,
            doctorName: professional?.full_name ?? '', doctorSpecialty: professional?.specialty ?? '',
            url: row.kind === 'link' && row.token ? `${PUBLIC_SITE_URL}/compartido/${row.token}` : null,
          }
        }),
      })
    }

    if (action === 'revoke-share') {
      const shareId = text(body.shareId, 40)
      const { data, error } = await admin.from('patient_shares').update({ revoked_at: new Date().toISOString() })
        .eq('id', shareId).eq('patient_id', patient.id).is('revoked_at', null).select('id')
      if (error) throw error
      if (!data?.length) return reply(404, { success: false, message: 'Ese acceso ya no estaba activo.' })
      await log(patient.id, 'share_revoked')
      return reply(200, { success: true })
    }

    return reply(400, { success: false, message: 'Acción no válida.' })
  } catch (error) {
    if (error instanceof GlucoseInputError) return reply(400, { success: false, message: error.message })
    console.error('patient-folder:', action, error instanceof Error ? error.message : error)
    return reply(500, { success: false, message: 'No se pudo completar la acción. Intentá nuevamente.' })
  }
})
