import { serve } from 'https://deno.land/std@0.224.0/http/server.ts'
import { createClient, type SupabaseClient } from 'jsr:@supabase/supabase-js@2'
import bcrypt from 'npm:bcryptjs@2.4.3'
import { corsHeaders as baseCorsHeaders } from '../_shared/cors.ts'

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
const CATEGORIES = new Set(['laboratorio', 'imagenes', 'recetas', 'informes', 'vacunas', 'otros'])
const CONSENT_VERSION = 'v1'

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

const PATIENT_COLUMNS = 'id, email, password_hash, full_name, dni, birth_date, phone, email_verified_at, storage_used_bytes, storage_quota_bytes, failed_login_count, locked_until, active, created_at'

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

  try {
    // ---------- Acciones públicas ----------
    if (action === 'register') {
      const email = normalizeEmail(body.email)
      const password = typeof body.password === 'string' ? body.password : ''
      const fullName = text(body.fullName, 160)
      const dni = normalizeDni(body.dni)
      const birthDate = validDate(body.birthDate)
      const phone = text(body.phone, 40) || null
      if (!fullName || !email || !password || !dni) return reply(400, { success: false, message: 'Completá nombre, DNI, email y contraseña.' })
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
        email, password_hash: await bcrypt.hash(password, BCRYPT_ROUNDS), full_name: fullName, dni, birth_date: birthDate, phone,
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
      await admin.from('patient_accounts').update({ email_verified_at: new Date().toISOString() }).eq('id', patient.id)
      await log(patient.id, 'account_verified')
      const token = await createSession(patient.id)
      return reply(200, { success: true, sessionToken: token, patient: publicPatient(patient) })
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

    // ---------- Acciones con sesión de paciente ----------
    const patient = await resolveSession()
    if (!patient) return reply(401, { success: false, code: 'SESSION_EXPIRED', message: 'Tu sesión terminó. Ingresá nuevamente.' })

    if (action === 'me') {
      return reply(200, { success: true, patient: publicPatient(patient) })
    }

    if (action === 'logout') {
      const token = request.headers.get(SESSION_HEADER)?.trim() || ''
      await admin.from('patient_sessions').update({ revoked_at: new Date().toISOString() }).eq('token_hash', await sha256(token))
      return reply(200, { success: true })
    }

    if (action === 'update-profile') {
      const fullName = text(body.fullName, 160)
      const phone = text(body.phone, 40) || null
      const birthDate = body.birthDate ? validDate(body.birthDate) : null
      if (!fullName) return reply(400, { success: false, message: 'El nombre es obligatorio.' })
      const { data, error } = await admin.from('patient_accounts')
        .update({ full_name: fullName, phone, birth_date: birthDate, updated_at: new Date().toISOString() })
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
      if (used + sizeBytes > Number(patient.storage_quota_bytes)) return reply(400, { success: false, message: 'Llegaste al límite de espacio de tu carpeta. Borrá estudios que ya no necesites.' })

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
        await recalcUsage(admin, patient.id)
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

    return reply(400, { success: false, message: 'Acción no válida.' })
  } catch (error) {
    console.error('patient-folder:', action, error instanceof Error ? error.message : error)
    return reply(500, { success: false, message: 'No se pudo completar la acción. Intentá nuevamente.' })
  }
})
