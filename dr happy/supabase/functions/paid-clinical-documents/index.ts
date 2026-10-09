import { createClient, type SupabaseClient } from 'jsr:@supabase/supabase-js@2'
import { corsHeaders } from '../_shared/cors.ts'
import { resolveProfessionalId } from '../_shared/professionalSession.ts'

type Entry = Record<string, unknown>
const PILOT_EMAIL = 'mudimudialan@gmail.com'
const PUBLIC_SITE = (Deno.env.get('APP_BASE_URL') || 'https://drhappy.com.ar').replace(/\/+$/, '')
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

const reply = (status: number, body: Entry) => new Response(JSON.stringify(body), {
  status,
  headers: { ...corsHeaders, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
})

function plainText(value: unknown, maxLength: number): string {
  return String(value ?? '').replace(/<[^>]*>/g, '').replace(/[\u0000-\u001F\u007F]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, maxLength)
}

function multilineText(value: unknown, maxLength: number): string {
  return String(value ?? '').replace(/\r\n?/g, '\n').replace(/<[^>]*>/g, '').replace(/[\u0000-\u0009\u000B-\u001F\u007F]/g, ' ')
    .replace(/\n{3,}/g, '\n\n').trim().slice(0, maxLength)
}

function randomToken(bytes = 32): string {
  return Array.from(crypto.getRandomValues(new Uint8Array(bytes)), (byte) => byte.toString(16).padStart(2, '0')).join('')
}

function slugify(value: string): string {
  return value.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 50)
}

function decodeBase64(value: string): Uint8Array {
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (value.length % 4)) % 4)
  return Uint8Array.from(atob(normalized), (char) => char.charCodeAt(0))
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
  if (!value) return true
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const date = new Date(`${value}T12:00:00Z`)
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value &&
    date.getUTCFullYear() >= 1900 && date.getTime() <= Date.now()
}

function isPilotAccount(user: Entry | null | undefined): boolean {
  return Boolean(user && (
    String(user.email ?? '').trim().toLowerCase() === PILOT_EMAIL ||
    String(user.username ?? '').trim().toLowerCase() === 'admin'
  ))
}

async function getProfessional(admin: SupabaseClient, professionalId: string) {
  const { data, error } = await admin.from('professionals')
    .select('id, username, email, full_name, active')
    .eq('id', professionalId)
    .maybeSingle()
  if (error) throw error
  return data
}

async function getSettingsBySlug(admin: SupabaseClient, slug: string) {
  const { data, error } = await admin.from('paid_clinical_document_settings')
    .select('professional_id, slug, certificate_enabled, certificate_price, study_order_enabled, study_order_price')
    .eq('slug', slug)
    .maybeSingle()
  if (error) throw error
  return data
}

async function getPaymentAccount(admin: SupabaseClient, professionalId: string) {
  const { data, error } = await admin.from('professional_payment_accounts')
    .select('provider_user_id, access_token_encrypted, status')
    .eq('professional_id', professionalId)
    .eq('provider', 'mercadopago')
    .maybeSingle()
  if (error) throw error
  return data
}

async function ensureSettings(admin: SupabaseClient, professionalId: string, professionalName: string) {
  const { data: existing, error } = await admin.from('paid_clinical_document_settings')
    .select('professional_id, slug, certificate_enabled, certificate_price, study_order_enabled, study_order_price')
    .eq('professional_id', professionalId)
    .maybeSingle()
  if (error) throw error
  if (existing) return existing
  const base = slugify(professionalName) || 'profesional'
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const slug = `${base}-${randomToken(3)}`
    const { data, error: insertError } = await admin.from('paid_clinical_document_settings')
      .insert({ professional_id: professionalId, slug })
      .select('professional_id, slug, certificate_enabled, certificate_price, study_order_enabled, study_order_price')
      .single()
    if (!insertError) return data
    if (insertError.code !== '23505') throw insertError
  }
  throw new Error('No se pudo generar el enlace fijo de documentos.')
}

function publicService(settings: Entry) {
  const certificateEnabled = settings.certificate_enabled === true
  const studyOrderEnabled = settings.study_order_enabled === true
  return {
    enabled: certificateEnabled || studyOrderEnabled,
    price: Number(certificateEnabled || !studyOrderEnabled ? settings.certificate_price || 0 : settings.study_order_price || 0),
  }
}

function responseService(service: ReturnType<typeof publicService>) {
  return {
    service,
    services: { certificate: service, studyOrder: service },
  }
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (request.method !== 'POST') return reply(405, { success: false, message: 'Método no permitido.' })

  const url = Deno.env.get('SUPABASE_URL')?.trim()
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')?.trim()
  if (!url || !serviceRoleKey) return reply(503, { success: false, message: 'Servicio no configurado.' })

  let body: Entry
  try {
    const parsed: unknown = await request.json()
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return reply(400, { success: false, message: 'Solicitud inválida.' })
    body = parsed as Entry
  } catch {
    return reply(400, { success: false, message: 'Solicitud JSON inválida.' })
  }

  const admin = createClient(url, serviceRoleKey, { auth: { persistSession: false } })

  try {
    if (body.action === 'public-info' || body.action === 'submit' || body.action === 'status') {
      if (body.action === 'status') {
        const token = String(body.trackingToken ?? '')
        if (!/^[a-f0-9]{64}$/.test(token)) return reply(404, { success: false, message: 'El enlace de seguimiento no es válido.' })
        const { data: item, error } = await admin.from('paid_clinical_document_requests')
          .select('professional_id, status, payment_status, payment_init_point, amount, created_at')
          .eq('tracking_token', token)
          .maybeSingle()
        if (error) throw error
        if (!item) return reply(404, { success: false, message: 'No encontramos esta solicitud.' })
        const professional = await getProfessional(admin, item.professional_id)
        return reply(200, {
          success: true,
          request: {
            status: item.status,
            paymentStatus: item.payment_status,
            paymentUrl: item.status === 'pending_payment' ? item.payment_init_point || '' : '',
            serviceType: 'certificate',
            purpose: 'Evaluación profesional',
            amount: Number(item.amount),
            professionalName: professional?.full_name || 'Profesional',
            createdAt: item.created_at,
          },
        })
      }

      const slug = plainText(body.slug, 80).toLowerCase()
      if (!/^[a-z0-9-]{6,80}$/.test(slug)) return reply(404, { success: false, message: 'Este enlace no es válido.' })
      const settings = await getSettingsBySlug(admin, slug)
      const professional = settings ? await getProfessional(admin, settings.professional_id) : null
      if (!settings || !professional || professional.active === false || !isPilotAccount(professional)) {
        return reply(404, { success: false, message: 'Este enlace de documentos no está disponible.' })
      }
      const service = publicService(settings)
      if (!service.enabled) {
        return reply(404, { success: false, message: 'El profesional todavía no habilitó solicitudes de documentos.' })
      }

      if (body.action === 'public-info') {
        const paymentAccount = await getPaymentAccount(admin, settings.professional_id)
        return reply(200, {
          success: true,
          professionalName: professional.full_name || 'Profesional',
          ...responseService(service),
          paymentReady: paymentAccount?.status === 'connected',
        })
      }

      if (typeof body.website === 'string' && body.website.trim()) return reply(200, { success: true, ignored: true })
      if (body.consent !== true) return reply(400, { success: false, message: 'Aceptá el uso de tus datos para enviar la solicitud al profesional.' })
      if (!service.enabled || service.price < 100 || service.price > 1_000_000) return reply(404, { success: false, message: 'Ese servicio no está disponible.' })
      const paymentAccount = await getPaymentAccount(admin, settings.professional_id)
      if (paymentAccount?.status !== 'connected' || !paymentAccount.access_token_encrypted) {
        return reply(503, { success: false, message: 'El profesional todavía no habilitó el cobro en línea. No se envió la solicitud.' })
      }

      const patientFirstName = plainText(body.patientFirstName, 80)
      const patientLastName = plainText(body.patientLastName, 80)
      const patientDni = String(body.patientDni ?? '').replace(/\D/g, '')
      const patientEmail = plainText(body.patientEmail, 160).toLowerCase()
      const patientPhone = String(body.patientPhone ?? '').replace(/[^\d+]/g, '').slice(0, 30)
      const birthDate = plainText(body.birthDate, 10)
      const reason = multilineText(body.reason, 2000)
      if (!patientFirstName || !patientLastName) return reply(400, { success: false, message: 'Completá tu nombre y apellido.' })
      if (!/^\d{6,9}$/.test(patientDni)) return reply(400, { success: false, message: 'Ingresá un DNI válido (solo números).' })
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(patientEmail)) return reply(400, { success: false, message: 'Ingresá un email válido.' })
      if (patientPhone.replace(/\D/g, '').length < 8) return reply(400, { success: false, message: 'Ingresá un teléfono válido.' })
      if (!isValidBirthDate(birthDate)) return reply(400, { success: false, message: 'Ingresá una fecha de nacimiento válida.' })
      if (reason.length < 5) return reply(400, { success: false, message: 'Contale brevemente al profesional para qué necesitás el documento.' })

      const { count: recentCount, error: rateError } = await admin.from('paid_clinical_document_requests')
        .select('id', { count: 'exact', head: true })
        .eq('professional_id', settings.professional_id)
        .gte('created_at', new Date(Date.now() - 60 * 60_000).toISOString())
      if (rateError) throw rateError
      if ((recentCount ?? 0) >= 20) return reply(429, { success: false, message: 'Hay muchas solicitudes en este momento. Probá nuevamente más tarde.' })

      const id = crypto.randomUUID()
      const trackingToken = randomToken()
      const amount = service.price
      const { error: insertError } = await admin.from('paid_clinical_document_requests').insert({
        id,
        professional_id: settings.professional_id,
        tracking_token: trackingToken,
        service_type: 'certificate',
        requested_purpose: 'Evaluación profesional',
        patient_first_name: patientFirstName,
        patient_last_name: patientLastName,
        patient_dni: patientDni,
        patient_email: patientEmail,
        patient_phone: patientPhone,
        patient_birth_date: birthDate || null,
        reason,
        amount,
      })
      if (insertError) throw insertError

      try {
        const accessToken = await decryptPaymentToken(paymentAccount.access_token_encrypted)
        const trackingUrl = `${PUBLIC_SITE}/documentos/${encodeURIComponent(slug)}?s=${trackingToken}`
        const preferenceResponse = await fetch('https://api.mercadopago.com/checkout/preferences', {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
            'X-Idempotency-Key': id,
          },
          body: JSON.stringify({
            items: [{
              id,
              title: 'Solicitud de atención profesional',
              quantity: 1,
              currency_id: 'ARS',
              unit_price: amount,
            }],
            payer: { email: patientEmail, name: patientFirstName, surname: patientLastName },
            external_reference: `cd_${id}`,
            back_urls: { success: trackingUrl, pending: trackingUrl, failure: trackingUrl },
            auto_return: 'approved',
            notification_url: `${url}/functions/v1/mercadopago-patient-webhook?professional_id=${encodeURIComponent(settings.professional_id)}`,
          }),
          signal: AbortSignal.timeout(15000),
        })
        const preference = await preferenceResponse.json().catch(() => null)
        if (!preferenceResponse.ok || !preference?.id || !preference?.init_point) {
          throw new Error(`Mercado Pago respondió ${preferenceResponse.status}.`)
        }
        const { error: updateError } = await admin.from('paid_clinical_document_requests').update({
          payment_preference_id: String(preference.id),
          payment_init_point: String(preference.init_point),
          updated_at: new Date().toISOString(),
        }).eq('id', id)
        if (updateError) throw updateError
        return reply(200, { success: true, paymentUrl: String(preference.init_point), trackingToken })
      } catch (error) {
        console.error('paid-clinical-documents: checkout no creado', error instanceof Error ? error.message : error)
        const { error: cancelError } = await admin.from('paid_clinical_document_requests')
          .update({ status: 'cancelled', payment_status: 'error', updated_at: new Date().toISOString() })
          .eq('id', id)
          .eq('status', 'pending_payment')
        if (cancelError) console.error('paid-clinical-documents: no se pudo cancelar la solicitud sin checkout', cancelError.message)
        return reply(503, { success: false, message: 'Mercado Pago no pudo preparar el pago. No se envió la solicitud; intentá nuevamente.' })
      }
    }

    const professionalId = await resolveProfessionalId(request, admin)
    if (!professionalId) return reply(401, { success: false, message: 'Volvé a iniciar sesión en Dr Happy.' })
    const professional = await getProfessional(admin, professionalId)
    if (!professional || professional.active === false || !isPilotAccount(professional)) {
      return reply(403, { success: false, message: 'Esta herramienta está disponible solo para las cuentas habilitadas en el piloto.' })
    }

    if (body.action === 'get-settings' || body.action === 'save-settings') {
      let settings = await ensureSettings(admin, professionalId, String(professional.full_name || 'Profesional'))
      if (body.action === 'save-settings') {
        const hasUnifiedSettings = Object.prototype.hasOwnProperty.call(body, 'enabled')
        const legacyCertificateEnabled = body.certificateEnabled === true
        const legacyStudyOrderEnabled = body.studyOrderEnabled === true
        const enabled = hasUnifiedSettings ? body.enabled === true : legacyCertificateEnabled || legacyStudyOrderEnabled
        const price = hasUnifiedSettings
          ? Number(body.price)
          : Number(legacyCertificateEnabled ? body.certificatePrice : body.studyOrderPrice)
        if (enabled && (!Number.isInteger(price) || price < 100 || price > 1_000_000)) {
          return reply(400, { success: false, message: 'El arancel debe estar entre $100 y $1.000.000.' })
        }
        if (!Number.isFinite(price) || price < 0 || price > 1_000_000) {
          return reply(400, { success: false, message: 'Ingresá un arancel válido.' })
        }
        const { data, error } = await admin.from('paid_clinical_document_settings').update({
          certificate_enabled: enabled,
          certificate_price: price,
          study_order_enabled: false,
          updated_at: new Date().toISOString(),
        }).eq('professional_id', professionalId)
          .select('professional_id, slug, certificate_enabled, certificate_price, study_order_enabled, study_order_price')
          .single()
        if (error) throw error
        settings = data
      }
      const paymentAccount = await getPaymentAccount(admin, professionalId)
      return reply(200, {
        success: true,
        settings: {
          slug: settings.slug,
          professionalName: professional.full_name || 'Profesional',
          ...responseService(publicService(settings)),
          paymentReady: paymentAccount?.status === 'connected',
        },
      })
    }

    if (body.action === 'list-requests') {
      const { data, error } = await admin.from('paid_clinical_document_requests')
        .select('id, patient_first_name, patient_last_name, patient_dni, patient_email, patient_phone, patient_birth_date, reason, amount, status, payment_status, paid_at, completed_at, created_at')
        .eq('professional_id', professionalId)
        .in('status', ['pending_review', 'completed'])
        .order('created_at', { ascending: false })
        .limit(100)
      if (error) throw error
      return reply(200, { success: true, requests: data ?? [] })
    }

    if (body.action === 'complete-request') {
      const id = String(body.id ?? '').toLowerCase()
      if (!UUID.test(id)) return reply(400, { success: false, message: 'Solicitud no válida.' })
      const completedAt = new Date().toISOString()
      const { data, error } = await admin.from('paid_clinical_document_requests').update({
        status: 'completed',
        completed_at: completedAt,
        updated_at: completedAt,
      }).eq('id', id).eq('professional_id', professionalId)
        .eq('status', 'pending_review').eq('payment_status', 'approved')
        .select('id')
        .maybeSingle()
      if (error) throw error
      if (!data) {
        const { data: existing, error: readError } = await admin.from('paid_clinical_document_requests')
          .select('status')
          .eq('id', id)
          .eq('professional_id', professionalId)
          .maybeSingle()
        if (readError) throw readError
        if (existing?.status !== 'completed') return reply(409, { success: false, message: 'Solo se pueden cerrar solicitudes pagadas pendientes de emisión.' })
      }
      return reply(200, { success: true })
    }

    return reply(400, { success: false, message: 'Acción no reconocida.' })
  } catch (error) {
    console.error('paid-clinical-documents:', error instanceof Error ? error.message : error)
    return reply(500, { success: false, message: 'No se pudo completar la operación. Intentá nuevamente.' })
  }
})
