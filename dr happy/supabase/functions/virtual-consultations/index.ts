import { createClient, type SupabaseClient } from 'jsr:@supabase/supabase-js@2'
import { corsHeaders } from '../_shared/cors.ts'
import { resolveProfessionalId } from '../_shared/professionalSession.ts'
import { findRedFlag } from '../_shared/virtualConsultRedFlags.ts'
import { buildVirtualConsultPdf } from './pdf.ts'

// Consulta virtual asistida (piloto). El paciente paga y envía su consulta por un link público;
// Sofía prepara un borrador y el profesional revisa, visa y emite la devolución en PDF.

type Entry = Record<string, unknown>
type VirtualConsultSignatureSeal = {
  hashSha256: string
  signedAt: string
  signedByUserId: string
  signedByFullName: string
  signedByLicense: string
  method: 'firma-electronica-simple'
  algorithm: 'SHA-256'
}

const PILOT_EMAILS = new Set(['mudimudialan@gmail.com', 'alan.moodie@hotmail.com'])
const BUCKET = 'virtual-consults'
const MAX_ATTACHMENTS = 3
const MAX_ATTACHMENT_BYTES = 5 * 1024 * 1024
const MIN_QUESTION_LENGTH = 120
const MIN_QUESTION_WORDS = 20
const ATTACHMENT_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'application/pdf'])
const PER_PROFESSIONAL_HOURLY_LIMIT = 30
const PER_DNI_DAILY_LIMIT = 3
const PUBLIC_SITE = (Deno.env.get('APP_BASE_URL') || 'https://drhappy.com.ar').replace(/\/+$/, '')
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/

const SOFIA_PROMPT = [
  'Sos Sofía, asistente clínica de Dr Happy. Un paciente envió una consulta virtual asincrónica paga, con texto y a veces fotos o documentos (estudios, recetas, lesiones).',
  'Tu tarea es preparar un BORRADOR para que el profesional tratante lo revise, corrija y vise antes de enviarlo. Nada llega al paciente sin esa revisión.',
  'Redactá en español rioplatense como texto clínico del profesional para que este lo revise. No te presentes ni te nombres; no atribuyas la respuesta a una IA o asistente. No agregues saludos finales, despedidas, nombres ni firmas.',
  'No inventes datos que no estén en la consulta o los adjuntos. Si algo es dudoso o ilegible, decilo.',
  'La respuesta al paciente debe ser una orientación aproximada, clara y empática, en segunda persona (vos): qué puede estar pasando en términos generales, cuidados o medidas generales razonables, qué signos de alarma requieren guardia, y si conviene una consulta presencial o estudios. No indiques dosis de medicamentos ni diagnósticos definitivos.',
  'Respondé únicamente con un objeto JSON válido, sin texto adicional ni bloques de código, con estas claves de texto:',
  '"resumenClinico": resumen técnico breve para la historia clínica (motivo, datos relevantes y hallazgos de los adjuntos).',
  '"respuestaPaciente": el borrador de devolución para el paciente, máximo 1800 caracteres.',
  '"alertas": observaciones solo para el profesional (datos faltantes, posibles banderas rojas, sugerencias); cadena vacía si no hay.',
].join('\n')

const reply = (status: number, body: Entry) => new Response(JSON.stringify(body), {
  status, headers: { ...corsHeaders, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
})

function plainText(value: unknown, maxLength: number): string {
  return String(value ?? '').replace(/<[^>]*>/g, '').replace(/[\u0000-\u001F\u007F]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, maxLength)
}

function multilineText(value: unknown, maxLength: number): string {
  return String(value ?? '').replace(/\r\n?/g, '\n').replace(/<[^>]*>/g, '').replace(/[\u0000-\u0009\u000B-\u001F\u007F]/g, ' ')
    .replace(/\n{3,}/g, '\n\n').trim().slice(0, maxLength)
}

function removeSofiaSignOff(value: string): string {
  return value.replace(
    /(?:^|\n)\s*(?:(?:saludos(?:\s+cordiales)?|atentamente|cordialmente|un\s+saludo)[,:\s]*)?(?:[-–—]\s*)?(?:soy\s+)?sof[ií]a(?:\s+(?:asistente(?:\s+cl[ií]nica)?|de\s+dr\s+happy))?[.!]?\s*$/i,
    '',
  ).trim()
}

function escapeHtml(value: string): string {
  return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#39;')
}

function randomToken(bytes = 32): string {
  return Array.from(crypto.getRandomValues(new Uint8Array(bytes)), (byte) => byte.toString(16).padStart(2, '0')).join('')
}

function slugify(value: string): string {
  return value.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40)
}

function decodeBase64(value: string): Uint8Array {
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (value.length % 4)) % 4)
  return Uint8Array.from(atob(normalized), (char) => char.charCodeAt(0))
}

function encodeBase64(bytes: Uint8Array): string {
  let binary = ''
  for (let index = 0; index < bytes.length; index += 0x8000) binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000))
  return btoa(binary)
}

async function decryptPaymentToken(value: string): Promise<string> {
  const rawKey = Deno.env.get('MP_TOKEN_ENCRYPTION_KEY')?.trim()
  if (!rawKey) throw new Error('Falta MP_TOKEN_ENCRYPTION_KEY.')
  const [ivPart, dataPart] = value.split('.')
  if (!ivPart || !dataPart) throw new Error('Token cifrado inválido.')
  const key = await crypto.subtle.importKey('raw', decodeBase64(rawKey), 'AES-GCM', false, ['decrypt'])
  const decrypted = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: decodeBase64(ivPart) }, key, decodeBase64(dataPart))
  return new TextDecoder().decode(decrypted)
}

function isValidBirthDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const date = new Date(`${value}T12:00:00Z`)
  return !Number.isNaN(date.getTime()) && date.getUTCFullYear() >= 1900 && date.getTime() <= Date.now()
}

// Verifica la firma real del archivo para no confiar en el tipo que declara el navegador.
function sniffType(bytes: Uint8Array): string | null {
  if (bytes[0] === 0xFF && bytes[1] === 0xD8 && bytes[2] === 0xFF) return 'image/jpeg'
  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4E && bytes[3] === 0x47) return 'image/png'
  if (bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46 && bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50) return 'image/webp'
  if (bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46) return 'application/pdf'
  return null
}

function validateBrandingLogo(value: unknown): { logoDataUrl?: string; error?: string } {
  if (value === null || value === undefined || value === '') return { logoDataUrl: '' }
  if (typeof value !== 'string' || value.length > 420_000) return { error: 'El logo debe ser PNG o JPG y no superar los 300 KB.' }
  const match = value.match(/^data:image\/(png|jpeg);base64,([A-Za-z0-9+/]+={0,2})$/)
  if (!match) return { error: 'El archivo de logo no es una imagen PNG o JPG válida.' }
  const bytes = decodeBase64(match[2])
  const type = sniffType(bytes)
  if (type !== `image/${match[1]}` || bytes.length > 300 * 1024) return { error: 'El logo debe ser PNG o JPG y no superar los 300 KB.' }
  return { logoDataUrl: value }
}

async function professionalInfo(admin: SupabaseClient, professionalId: string) {
  const [{ data: professional, error: professionalError }, { data: workspace, error: workspaceError }] = await Promise.all([
    admin.from('professionals').select('full_name, specialty, email, active').eq('id', professionalId).maybeSingle(),
    admin.from('user_workspaces').select('profile_json').eq('user_id', professionalId).maybeSingle(),
  ])
  if (professionalError) throw professionalError
  if (workspaceError) throw workspaceError
  const profile = (workspace?.profile_json && typeof workspace.profile_json === 'object' ? workspace.profile_json : {}) as Entry
  const signatureImage = profile.signatureImage && typeof profile.signatureImage === 'object' ? (profile.signatureImage as Entry).dataUrl : undefined
  return {
    exists: Boolean(professional),
    active: professional?.active !== false,
    pilot: PILOT_EMAILS.has(String(professional?.email ?? '').trim().toLowerCase()),
    name: String(profile.fullName || professional?.full_name || ''),
    specialty: String(profile.specialty || professional?.specialty || ''),
    licenseNumber: String(profile.licenseNumber || ''),
    signatureText: String(profile.signatureText || ''),
    signatureDataUrl: typeof signatureImage === 'string' ? signatureImage : undefined,
    email: String((typeof profile.email === 'string' && profile.email.trim()) || professional?.email || '').trim(),
  }
}

async function sendEmail(
  url: string,
  key: string,
  to: string,
  subject: string,
  text: string,
  attachment?: { filename: string; content: string; contentType: string },
): Promise<boolean> {
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)) return false
  try {
    const response = await fetch(`${url}/functions/v1/send-email`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}`, apikey: key },
      body: JSON.stringify({
        to, subject, type: 'custom', text,
        templateData: { message: escapeHtml(text).replaceAll('\n', '<br>') },
        attachments: attachment ? [{ ...attachment, encoding: 'base64' }] : undefined,
      }),
      signal: AbortSignal.timeout(10000),
    })
    const result = await response.json().catch(() => null)
    return response.ok && result?.success === true
  } catch (error) {
    console.error('virtual-consultations: email no enviado', error instanceof Error ? error.message : error)
    return false
  }
}

async function buildVirtualConsultSignatureSeal(params: {
  consultId: string
  professionalId: string
  professionalName: string
  licenseNumber: string
  patientName: string
  patientDni: string
  question: string
  response: string
  createdAt: string
  answeredAt: string
}): Promise<VirtualConsultSignatureSeal> {
  const signedAt = params.answeredAt
  const canonicalContent = JSON.stringify({
    content: {
      consultId: params.consultId,
      patientName: params.patientName,
      patientDni: params.patientDni,
      question: params.question,
      response: params.response,
      createdAt: params.createdAt,
      answeredAt: params.answeredAt,
    },
    signer: {
      userId: params.professionalId,
      fullName: params.professionalName,
      license: params.licenseNumber,
      dni: '',
    },
    signedAt,
  })
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(canonicalContent))
  const hashSha256 = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('')
  return {
    hashSha256,
    signedAt,
    signedByUserId: params.professionalId,
    signedByFullName: params.professionalName,
    signedByLicense: params.licenseNumber,
    method: 'firma-electronica-simple',
    algorithm: 'SHA-256',
  }
}

async function ensureSettings(admin: SupabaseClient, professionalId: string, name: string) {
  const { data: existing, error } = await admin.from('virtual_consult_settings')
    .select('slug, enabled, price, letterhead, logo_data_url').eq('professional_id', professionalId).maybeSingle()
  if (error) throw error
  if (existing) return existing
  const base = slugify(name) || 'profesional'
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const slug = `${base}-${randomToken(3)}`
    const { data, error: insertError } = await admin.from('virtual_consult_settings')
      .insert({ professional_id: professionalId, slug }).select('slug, enabled, price, letterhead, logo_data_url').single()
    if (!insertError) return data
  }
  throw new Error('No se pudo generar el link de consulta virtual.')
}

async function signedAttachments(admin: SupabaseClient, attachments: unknown) {
  const list = Array.isArray(attachments) ? attachments as Entry[] : []
  return await Promise.all(list.map(async (item) => {
    const { data } = await admin.storage.from(BUCKET).createSignedUrl(String(item.path), 3600)
    return { name: String(item.name ?? 'Adjunto'), type: String(item.type ?? ''), size: Number(item.size ?? 0), url: data?.signedUrl ?? '' }
  }))
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (request.method !== 'POST') return reply(405, { success: false, message: 'Método no permitido.' })
  const url = Deno.env.get('SUPABASE_URL')
  const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  if (!url || !key) return reply(503, { success: false, message: 'Servicio no configurado.' })
  let body: Entry
  try {
    const value: unknown = await request.json()
    if (!value || typeof value !== 'object' || Array.isArray(value)) return reply(400, { success: false, message: 'Solicitud inválida.' })
    body = value as Entry
  } catch {
    return reply(400, { success: false, message: 'Solicitud JSON inválida.' })
  }
  const admin = createClient(url, key, { auth: { persistSession: false } })

  try {
    // ── Acciones públicas (paciente) ─────────────────────────────────────────
    if (body.action === 'get-page' || body.action === 'submit') {
      const slug = plainText(body.slug, 80).toLowerCase()
      if (!/^[a-z0-9-]{6,80}$/.test(slug)) return reply(404, { success: false, message: 'Este link de consulta virtual no es válido.' })
      const { data: settings, error: settingsError } = await admin.from('virtual_consult_settings').select('professional_id, slug, enabled, price').eq('slug', slug).maybeSingle()
      if (settingsError) throw settingsError
      const info = settings ? await professionalInfo(admin, settings.professional_id) : null
      if (!settings || !info?.exists || !info.active || !info.pilot) return reply(404, { success: false, message: 'Este link de consulta virtual no está disponible.' })
      if (!settings.enabled) return reply(404, { success: false, message: 'El profesional no está recibiendo consultas virtuales en este momento.' })
      const { data: paymentAccount } = await admin.from('professional_payment_accounts').select('access_token_encrypted, status')
        .eq('professional_id', settings.professional_id).eq('provider', 'mercadopago').maybeSingle()
      const paymentReady = paymentAccount?.status === 'connected'

      if (body.action === 'get-page') {
        return reply(200, {
          success: true,
          page: { professionalName: info.name, specialty: info.specialty, letterhead: info.letterhead, price: Number(settings.price), paymentReady },
        })
      }

      if (typeof body.website === 'string' && body.website.trim()) return reply(200, { success: true, ignored: true })
      if (!paymentReady) return reply(503, { success: false, message: 'El profesional todavía no habilitó el cobro en línea. Tu consulta no fue enviada.' })

      const nombre = plainText(body.nombre, 80)
      const apellido = plainText(body.apellido, 80)
      const dni = String(body.dni ?? '').replace(/\D/g, '')
      const birthDate = plainText(body.birthDate, 10)
      const email = plainText(body.email, 160).toLowerCase()
      const phone = String(body.phone ?? '').replace(/[^\d+]/g, '').slice(0, 30)
      const obraSocial = plainText(body.obraSocial, 80)
      const question = multilineText(body.question, 4000)
      const redFlag = findRedFlag(question)
      if (redFlag) {
        return reply(422, {
          success: false, emergency: true,
          message: 'Lo que describís puede ser una urgencia. No uses la consulta virtual: concurrí ahora a la guardia más cercana o llamá al 107 (SAME) o al 911. No se te cobró nada.',
        })
      }
      if (!nombre || !apellido) return reply(400, { success: false, message: 'Completá tu nombre y apellido.' })
      if (!/^\d{6,9}$/.test(dni)) return reply(400, { success: false, message: 'Ingresá un DNI válido (solo números).' })
      if (!isValidBirthDate(birthDate)) return reply(400, { success: false, message: 'Ingresá una fecha de nacimiento válida.' })
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return reply(400, { success: false, message: 'Ingresá un email válido: ahí te enviamos la devolución.' })
      if (phone.replace(/\D/g, '').length < 8) return reply(400, { success: false, message: 'Ingresá un teléfono de contacto válido.' })
      const questionWords = question.split(/\s+/).filter(Boolean).length
      if (question.length < MIN_QUESTION_LENGTH || questionWords < MIN_QUESTION_WORDS) {
        return reply(400, { success: false, message: `Contanos tu situación con más contexto: escribí al menos ${MIN_QUESTION_LENGTH} caracteres y ${MIN_QUESTION_WORDS} palabras, e incluí cuándo empezó, cómo es y qué otros síntomas o antecedentes son importantes.` })
      }
      if (body.consent !== true || body.acceptTerms !== true) return reply(400, { success: false, message: 'Necesitamos que aceptes las condiciones del servicio y el registro de tus datos.' })

      const rawAttachments = Array.isArray(body.attachments) ? body.attachments as Entry[] : []
      if (rawAttachments.length > MAX_ATTACHMENTS) return reply(400, { success: false, message: `Podés adjuntar hasta ${MAX_ATTACHMENTS} archivos.` })
      const files: Array<{ name: string; type: string; bytes: Uint8Array }> = []
      for (const item of rawAttachments) {
        const data = typeof item?.data === 'string' ? item.data : ''
        if (!data || data.length > Math.ceil(MAX_ATTACHMENT_BYTES * 4 / 3) + 8) return reply(400, { success: false, message: 'Cada archivo puede pesar hasta 5 MB.' })
        let bytes: Uint8Array
        try { bytes = decodeBase64(data) } catch { return reply(400, { success: false, message: 'Un archivo adjunto no se pudo leer.' }) }
        const type = sniffType(bytes)
        if (!type || !ATTACHMENT_TYPES.has(type)) return reply(400, { success: false, message: 'Solo se aceptan fotos (JPG, PNG, WEBP) o PDF.' })
        if (bytes.length > MAX_ATTACHMENT_BYTES) return reply(400, { success: false, message: 'Cada archivo puede pesar hasta 5 MB.' })
        files.push({ name: plainText(item.name, 120) || 'adjunto', type, bytes })
      }

      const now = Date.now()
      const { count: hourlyCount } = await admin.from('virtual_consultations').select('id', { count: 'exact', head: true })
        .eq('professional_id', settings.professional_id).gte('created_at', new Date(now - 3600_000).toISOString())
      if ((hourlyCount ?? 0) >= PER_PROFESSIONAL_HOURLY_LIMIT) return reply(429, { success: false, message: 'Hay muchas consultas en este momento. Probá de nuevo en unos minutos.' })
      const { count: dniCount } = await admin.from('virtual_consultations').select('id', { count: 'exact', head: true })
        .eq('professional_id', settings.professional_id).eq('dni', dni).gte('created_at', new Date(now - 86_400_000).toISOString())
      if ((dniCount ?? 0) >= PER_DNI_DAILY_LIMIT) return reply(429, { success: false, message: 'Ya enviaste varias consultas hoy. Si no pudiste pagar, intentá de nuevo mañana.' })

      const consultId = crypto.randomUUID()
      const trackingToken = randomToken()
      const attachments: Entry[] = []
      for (const [index, file] of files.entries()) {
        const extension = file.type === 'application/pdf' ? 'pdf' : file.type.split('/')[1].replace('jpeg', 'jpg')
        const path = `${settings.professional_id}/${consultId}/adjunto-${index + 1}.${extension}`
        const { error: uploadError } = await admin.storage.from(BUCKET).upload(path, file.bytes, { contentType: file.type, upsert: false })
        if (uploadError) {
          console.error('virtual-consultations: adjunto no guardado', uploadError.message)
          await admin.storage.from(BUCKET).remove(attachments.map((entry) => String(entry.path)))
          return reply(503, { success: false, message: 'No pudimos guardar los archivos adjuntos. Probá de nuevo.' })
        }
        attachments.push({ path, name: file.name, type: file.type, size: file.bytes.length })
      }

      const amount = Number(settings.price)
      const { error: insertError } = await admin.from('virtual_consultations').insert({
        id: consultId, professional_id: settings.professional_id, tracking_token: trackingToken,
        nombre, apellido, dni, birth_date: birthDate, phone: phone || null, email, obra_social: obraSocial || null,
        question, attachments, amount,
      })
      if (insertError) {
        await admin.storage.from(BUCKET).remove(attachments.map((entry) => String(entry.path)))
        throw insertError
      }
      // Un reintento del mismo paciente reemplaza a las consultas que dejó sin pagar (si alguna se paga igual, el webhook la reactiva).
      await admin.from('virtual_consultations').update({ status: 'cancelled', updated_at: new Date().toISOString() })
        .eq('professional_id', settings.professional_id).eq('dni', dni).eq('status', 'pending_payment').neq('id', consultId)

      // El paciente queda en la base del profesional; la app lo incorpora por DNI sin duplicar fichas.
      const { error: registryError } = await admin.from('patient_invite_submissions').insert({
        professional_id: settings.professional_id, nombre, apellido, dni, birth_date: birthDate,
        obra_social: obraSocial || null, email, phone: phone || null,
      })
      if (registryError) console.error('virtual-consultations: paciente no registrado', registryError.message)

      const trackingUrl = `${PUBLIC_SITE}/consulta/?s=${trackingToken}`
      try {
        const accessToken = await decryptPaymentToken(String(paymentAccount?.access_token_encrypted ?? ''))
        const preferenceResponse = await fetch('https://api.mercadopago.com/checkout/preferences', {
          method: 'POST',
          headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json', 'X-Idempotency-Key': consultId },
          body: JSON.stringify({
            items: [{ id: consultId, title: 'Consulta virtual asistida con revisión profesional', quantity: 1, currency_id: 'ARS', unit_price: amount }],
            payer: { email, name: nombre, surname: apellido },
            external_reference: `vc_${consultId}`,
            back_urls: { success: trackingUrl, pending: trackingUrl, failure: trackingUrl },
            auto_return: 'approved',
            notification_url: `${url}/functions/v1/mercadopago-patient-webhook?professional_id=${encodeURIComponent(settings.professional_id)}`,
          }),
          signal: AbortSignal.timeout(15000),
        })
        const preference = await preferenceResponse.json().catch(() => null)
        if (!preferenceResponse.ok || !preference?.id || !preference?.init_point) throw new Error(`Mercado Pago respondió ${preferenceResponse.status}`)
        await admin.from('virtual_consultations').update({
          payment_preference_id: String(preference.id), payment_init_point: String(preference.init_point), updated_at: new Date().toISOString(),
        }).eq('id', consultId)
        return reply(200, { success: true, trackingToken, paymentUrl: String(preference.init_point) })
      } catch (paymentError) {
        console.error('virtual-consultations: checkout no creado', paymentError instanceof Error ? paymentError.message : paymentError)
        await admin.from('virtual_consultations').update({ status: 'cancelled', payment_status: 'error', updated_at: new Date().toISOString() }).eq('id', consultId)
        return reply(503, { success: false, message: 'Mercado Pago no pudo preparar el pago. Tu consulta no fue enviada; intentá nuevamente.' })
      }
    }

    if (body.action === 'status') {
      const token = String(body.trackingToken ?? '')
      if (!/^[a-f0-9]{64}$/.test(token)) return reply(404, { success: false, message: 'El link de seguimiento no es válido.' })
      const { data: consult, error } = await admin.from('virtual_consultations')
        .select('id, professional_id, nombre, status, payment_status, payment_init_point, pdf_path, decline_reason, created_at, answered_at')
        .eq('tracking_token', token).maybeSingle()
      if (error) throw error
      if (!consult) return reply(404, { success: false, message: 'No encontramos esta consulta.' })
      const info = await professionalInfo(admin, consult.professional_id)
      let pdfUrl = ''
      if (consult.status === 'answered' && consult.pdf_path) {
        const { data } = await admin.storage.from(BUCKET).createSignedUrl(consult.pdf_path, 3600, { download: `devolucion-consulta-virtual-${consult.id.slice(0, 8)}.pdf` })
        pdfUrl = data?.signedUrl ?? ''
      }
      return reply(200, {
        success: true,
        consult: {
          nombre: consult.nombre, status: consult.status, paymentStatus: consult.payment_status,
          paymentUrl: consult.status === 'pending_payment' ? consult.payment_init_point ?? '' : '',
          professionalName: info.name, createdAt: consult.created_at, answeredAt: consult.answered_at,
          declineReason: consult.status === 'declined' ? consult.decline_reason ?? '' : '', pdfUrl,
        },
      })
    }

    // ── Acciones del profesional (piloto) ────────────────────────────────────
    const professionalId = await resolveProfessionalId(request, admin)
    if (!professionalId) return reply(401, { success: false, message: 'Volvé a iniciar sesión en Dr Happy.' })
    const info = await professionalInfo(admin, professionalId)
    if (!info.exists || !info.active || !info.pilot) return reply(403, { success: false, message: 'La consulta virtual asistida está en etapa piloto.' })

    if (body.action === 'get-settings' || body.action === 'save-settings') {
      let settings = await ensureSettings(admin, professionalId, info.name)
      if (body.action === 'save-settings') {
        const price = Math.round(Number(body.price))
        if (!Number.isFinite(price) || price < 100 || price > 1_000_000) return reply(400, { success: false, message: 'Ingresá un valor entre $100 y $1.000.000.' })
        const letterhead = typeof body.letterhead === 'string' ? body.letterhead.trim() : ''
        if (letterhead.length > 100) return reply(400, { success: false, message: 'El membrete no puede superar los 100 caracteres.' })
        const logoValidation = validateBrandingLogo(body.logoDataUrl)
        if (logoValidation.error) return reply(400, { success: false, message: logoValidation.error })
        const { data, error } = await admin.from('virtual_consult_settings')
          .update({ enabled: body.enabled === true, price, letterhead, logo_data_url: logoValidation.logoDataUrl || null, updated_at: new Date().toISOString() })
          .eq('professional_id', professionalId).select('slug, enabled, price, letterhead, logo_data_url').single()
        if (error) throw error
        settings = data
      }
      const { data: paymentAccount } = await admin.from('professional_payment_accounts').select('status')
        .eq('professional_id', professionalId).eq('provider', 'mercadopago').maybeSingle()
      return reply(200, {
        success: true,
        settings: {
          slug: settings.slug, enabled: settings.enabled, price: Number(settings.price),
          letterhead: settings.letterhead ?? '', logoDataUrl: settings.logo_data_url ?? '',
          paymentReady: paymentAccount?.status === 'connected', url: `${PUBLIC_SITE}/consulta/${settings.slug}`,
        },
      })
    }

    if (body.action === 'list') {
      const { data, error } = await admin.from('virtual_consultations')
        .select('id, nombre, apellido, dni, email, phone, obra_social, birth_date, question, attachments, status, payment_status, amount, created_at, paid_at, answered_at, recorded_in_chart_at, response_text, signature_seal, decline_reason, draft')
        .eq('professional_id', professionalId).neq('status', 'cancelled')
        .order('created_at', { ascending: false }).limit(100)
      if (error) throw error
      const consults = (data ?? []).filter((item) => item.status !== 'pending_payment' || Date.now() - Date.parse(item.created_at) < 3 * 86_400_000)
        .map((item) => ({ ...item, attachmentCount: Array.isArray(item.attachments) ? item.attachments.length : 0, attachments: undefined }))
      return reply(200, { success: true, consults })
    }

    const consultId = typeof body.id === 'string' && UUID.test(body.id) ? body.id : ''
    if (!consultId) return reply(400, { success: false, message: 'Consulta inválida.' })
    const { data: consult, error: consultError } = await admin.from('virtual_consultations').select('*')
      .eq('id', consultId).eq('professional_id', professionalId).maybeSingle()
    if (consultError) throw consultError
    if (!consult) return reply(404, { success: false, message: 'La consulta no existe.' })

    if (body.action === 'attachments') {
      return reply(200, { success: true, attachments: await signedAttachments(admin, consult.attachments) })
    }

    if (body.action === 'response-pdf') {
      if (consult.status !== 'answered' || !consult.pdf_path) {
        return reply(404, { success: false, message: 'No hay un PDF de devolución guardado para esta consulta.' })
      }
      const { data, error } = await admin.storage.from(BUCKET).createSignedUrl(consult.pdf_path, 3600)
      if (error) throw error
      if (!data?.signedUrl) throw new Error('No se pudo crear el enlace seguro al PDF.')
      return reply(200, { success: true, pdfUrl: data.signedUrl })
    }

    if (body.action === 'mark-paid') {
      if (consult.status !== 'pending_payment') return reply(409, { success: false, message: 'La consulta ya no está pendiente de pago.' })
      const { error } = await admin.from('virtual_consultations').update({
        status: 'pending_review', payment_status: 'manual', paid_at: new Date().toISOString(), updated_at: new Date().toISOString(),
      }).eq('id', consultId).eq('status', 'pending_payment')
      if (error) throw error
      return reply(200, { success: true })
    }

    if (body.action === 'mark-recorded') {
      const { error } = await admin.from('virtual_consultations').update({ recorded_in_chart_at: new Date().toISOString() }).eq('id', consultId)
      if (error) throw error
      return reply(200, { success: true })
    }

    if (body.action === 'draft') {
      if (consult.status !== 'pending_review') return reply(409, { success: false, message: 'Solo se pueden preparar borradores de consultas pagas pendientes de revisión.' })
      const anthropicKey = Deno.env.get('ANTHROPIC_API_KEY')?.trim()
      const model = Deno.env.get('ANTHROPIC_MODEL')?.trim() || 'claude-sonnet-4-5'
      if (!anthropicKey) return reply(503, { success: false, message: 'Sofía no está configurada.' })
      const content: Entry[] = []
      for (const item of (Array.isArray(consult.attachments) ? consult.attachments as Entry[] : [])) {
        const { data: blob } = await admin.storage.from(BUCKET).download(String(item.path))
        if (!blob) continue
        const data = encodeBase64(new Uint8Array(await blob.arrayBuffer()))
        const type = String(item.type)
        content.push(type === 'application/pdf'
          ? { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data } }
          : { type: 'image', source: { type: 'base64', media_type: type, data } })
      }
      const age = consult.birth_date ? Math.floor((Date.now() - Date.parse(`${consult.birth_date}T12:00:00Z`)) / (365.25 * 86_400_000)) : null
      content.push({ type: 'text', text: [
        `Paciente: ${consult.apellido}, ${consult.nombre}${age !== null ? ` · ${age} años` : ''}${consult.obra_social ? ` · Cobertura: ${consult.obra_social}` : ''}`,
        `Adjuntos: ${content.length}`,
        '', 'CONSULTA DEL PACIENTE:', consult.question,
      ].join('\n') })
      const { data: claim, error: claimError } = await admin.rpc('claim_sofia_consultation', { p_professional_id: professionalId, p_model: model })
      if (claimError) throw claimError
      if (!claim?.allowed) return reply(claim?.reason === 'expired' ? 402 : 429, { success: false, message: claim?.reason === 'expired' ? 'Tu acceso a Sofía venció.' : 'Alcanzaste el límite mensual de consultas de Sofía.' })
      let inputTokens = 0
      let outputTokens = 0
      try {
        const response = await fetch('https://api.anthropic.com/v1/messages', {
          method: 'POST',
          headers: { 'x-api-key': anthropicKey, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
          body: JSON.stringify({ model, max_tokens: 2500, system: SOFIA_PROMPT, messages: [{ role: 'user', content }] }),
          signal: AbortSignal.timeout(80_000),
        })
        const result = await response.json().catch(() => null)
        inputTokens = Number(result?.usage?.input_tokens || 0)
        outputTokens = Number(result?.usage?.output_tokens || 0)
        const raw = Array.isArray(result?.content) ? result.content.filter((item: Entry) => item.type === 'text').map((item: Entry) => String(item.text || '')).join('\n').trim() : ''
        if (!response.ok || !raw) {
          console.error('virtual-consultations: borrador rechazado', response.status, result?.error?.message)
          return reply(502, { success: false, message: 'Sofía no pudo preparar el borrador. Reintentá.' })
        }
        const cleaned = raw.replace(/^```(?:json)?\s*|\s*```$/g, '').trim()
        let draft = { resumenClinico: '', respuestaPaciente: removeSofiaSignOff(cleaned.slice(0, 4000)), alertas: '' }
        try {
          const parsed = JSON.parse(cleaned.slice(cleaned.indexOf('{'), cleaned.lastIndexOf('}') + 1))
          draft = {
            resumenClinico: multilineText(parsed?.resumenClinico, 4000),
            respuestaPaciente: removeSofiaSignOff(multilineText(parsed?.respuestaPaciente, 4000)),
            alertas: multilineText(parsed?.alertas, 2000),
          }
        } catch { /* Se usa el texto completo como respuesta. */ }
        await admin.from('virtual_consultations').update({ draft, updated_at: new Date().toISOString() }).eq('id', consultId)
        return reply(200, { success: true, draft })
      } catch (error) {
        console.error('virtual-consultations: Sofía no respondió', error instanceof Error ? error.message : error)
        return reply(502, { success: false, message: 'Sofía no respondió a tiempo. Reintentá.' })
      } finally {
        await admin.from('ai_usage_events').update({
          input_tokens: inputTokens, output_tokens: outputTokens, total_tokens: inputTokens + outputTokens,
          estimated_cost_usd: (inputTokens * 3 + outputTokens * 15) / 1_000_000,
        }).eq('id', claim.eventId)
        if (inputTokens === 0 && outputTokens === 0) await admin.from('ai_usage_events').delete().eq('id', claim.eventId)
      }
    }

    if (body.action === 'publish') {
      if (consult.status !== 'pending_review') return reply(409, { success: false, message: 'Esta consulta ya fue respondida o no está paga.' })
      const responseText = multilineText(body.responseText, 6000)
      if (responseText.length < 20) return reply(400, { success: false, message: 'Escribí la devolución antes de visarla.' })
      if (!info.name.trim()) return reply(400, { success: false, message: 'Completá tu nombre en el perfil antes de visar devoluciones.' })
      const answeredAt = new Date().toISOString()
      const patientName = `${consult.apellido}, ${consult.nombre}`
      const branding = await ensureSettings(admin, professionalId, info.name)
      const signatureSeal = await buildVirtualConsultSignatureSeal({
        consultId,
        professionalId,
        professionalName: info.name,
        licenseNumber: info.licenseNumber,
        patientName,
        patientDni: consult.dni,
        question: consult.question,
        response: responseText,
        createdAt: consult.created_at,
        answeredAt,
      })
      const pdf = await buildVirtualConsultPdf({
        consultId,
        letterhead: branding.letterhead ?? '',
        logoDataUrl: branding.logo_data_url ?? '',
        professionalName: info.name, specialty: info.specialty,
        licenseNumber: info.licenseNumber, signatureText: info.signatureText, signatureDataUrl: info.signatureDataUrl,
        patientName, patientDni: consult.dni,
        question: consult.question, response: responseText, createdAt: consult.created_at, answeredAt,
        signatureSeal,
      })
      const pdfPath = `${professionalId}/${consultId}/devolucion.pdf`
      const { error: uploadError } = await admin.storage.from(BUCKET).upload(pdfPath, pdf, { contentType: 'application/pdf', upsert: true })
      if (uploadError) throw uploadError
      const { data: updated, error } = await admin.from('virtual_consultations').update({
        status: 'answered', response_text: responseText, signature_seal: signatureSeal, pdf_path: pdfPath, answered_at: answeredAt, updated_at: answeredAt,
      }).eq('id', consultId).eq('status', 'pending_review').select('id').maybeSingle()
      if (error) throw error
      if (!updated) return reply(409, { success: false, message: 'Esta consulta ya fue respondida.' })
      const emailSent = await sendEmail(url, key, consult.email, `Tu devolución de orientación virtual - ${info.name}`, [
        `Hola ${consult.nombre},`, '',
        `${info.name} revisó tu consulta y te envía adjunta la devolución de orientación virtual en PDF. También podés descargarla desde tu link de seguimiento.`, '',
        'Descargala desde este link:', `${PUBLIC_SITE}/consulta/?s=${consult.tracking_token}`, '',
        'La devolución fue revisada y visada por tu profesional. No reemplaza la consulta presencial. Ante síntomas de alarma, concurrí a la guardia o llamá al 107.',
      ].join('\n'), {
        filename: `devolucion-orientacion-${consultId.slice(0, 8)}.pdf`,
        content: encodeBase64(pdf),
        contentType: 'application/pdf',
      })
      return reply(200, { success: true, emailSent, answeredAt, signatureSeal })
    }

    if (body.action === 'decline') {
      if (!['pending_review', 'pending_payment'].includes(consult.status)) return reply(409, { success: false, message: 'Esta consulta ya fue cerrada.' })
      const reason = multilineText(body.reason, 1000)
      if (reason.length < 10) return reply(400, { success: false, message: 'Explicale brevemente al paciente por qué no se puede responder en forma virtual.' })
      const { error } = await admin.from('virtual_consultations').update({
        status: 'declined', decline_reason: reason, answered_at: new Date().toISOString(), updated_at: new Date().toISOString(),
      }).eq('id', consultId)
      if (error) throw error
      const emailSent = await sendEmail(url, key, consult.email, `Tu consulta virtual - ${info.name}`, [
        `Hola ${consult.nombre},`, '', `${info.name} revisó tu consulta virtual y considera que requiere atención presencial:`, '', reason, '',
        consult.status === 'pending_review' ? 'Tu profesional se va a comunicar con vos por la devolución del pago.' : '',
      ].join('\n'))
      return reply(200, { success: true, emailSent })
    }

    return reply(400, { success: false, message: 'Acción no reconocida.' })
  } catch (error) {
    console.error('virtual-consultations: error', error instanceof Error ? error.message : error)
    return reply(503, { success: false, message: 'No se pudo completar la operación. Reintentá en unos minutos.' })
  }
})
