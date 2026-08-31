import { serve } from 'https://deno.land/std@0.224.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { corsHeaders } from '../_shared/cors.ts'

type PaymentDetails = {
  status?: string
  external_reference?: string
  date_approved?: string
  metadata?: {
    user_id?: string
    plan?: 'monthly' | 'semiannual' | 'annual'
  }
}

const DAY_IN_MS = 86400000

function jsonResponse(status: number, body: Record<string, unknown>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders,
      'Content-Type': 'application/json',
    },
  })
}

function addBillingPeriod(baseIso: string, plan: 'monthly' | 'semiannual' | 'annual'): string {
  const base = new Date(baseIso)
  const result = new Date(base)
  const durationDays = plan === 'annual' ? 365 : plan === 'semiannual' ? 180 : 30
  result.setTime(base.getTime() + durationDays * DAY_IN_MS)
  return result.toISOString()
}

serve(async (request) => {
  if (request.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  const mpAccessToken = Deno.env.get('MP_ACCESS_TOKEN')?.trim()
  const supabaseUrl = Deno.env.get('SUPABASE_URL')?.trim()
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')?.trim()

  if (!mpAccessToken || !supabaseUrl || !serviceRoleKey) {
    return jsonResponse(500, { message: 'Faltan credenciales internas para procesar el webhook.' })
  }

  const url = new URL(request.url)
  let body: Record<string, unknown> = {}
  if (request.method !== 'GET') {
    body = await request.json().catch(() => ({}))
  }

  const queryPaymentId = url.searchParams.get('data.id') || url.searchParams.get('id')
  const bodyData = body.data && typeof body.data === 'object' ? (body.data as Record<string, unknown>) : null
  const bodyPaymentId =
    typeof bodyData?.id === 'string'
      ? bodyData.id
      : typeof bodyData?.id === 'number'
        ? String(bodyData.id)
        : typeof body.id === 'string'
          ? body.id
          : typeof body.id === 'number'
            ? String(body.id)
            : ''
  const paymentId = queryPaymentId || bodyPaymentId
  const topic =
    url.searchParams.get('type') ||
    url.searchParams.get('topic') ||
    (typeof body.type === 'string' ? body.type : '') ||
    (typeof body.action === 'string' ? body.action : '')

  if (!paymentId) {
    return jsonResponse(200, { received: true, ignored: 'missing-payment-id' })
  }
  if (topic && !topic.includes('payment')) {
    return jsonResponse(200, { received: true, ignored: 'non-payment-topic' })
  }

  const paymentResponse = await fetch(`https://api.mercadopago.com/v1/payments/${paymentId}`, {
    headers: {
      Authorization: `Bearer ${mpAccessToken}`,
    },
  })
  const paymentJson = (await paymentResponse.json().catch(() => null)) as PaymentDetails | null
  if (!paymentResponse.ok || !paymentJson) {
    return jsonResponse(502, { message: 'No se pudo consultar el pago en MercadoPago.' })
  }

  if (paymentJson.status !== 'approved') {
    return jsonResponse(200, { received: true, ignored: `payment-status-${paymentJson.status ?? 'unknown'}` })
  }

  const userId = paymentJson.metadata?.user_id || paymentJson.external_reference || ''
  if (!userId) {
    return jsonResponse(400, { message: 'El pago aprobado no trae user_id ni external_reference.' })
  }

  const plan =
    paymentJson.metadata?.plan === 'annual'
      ? 'annual'
      : paymentJson.metadata?.plan === 'semiannual'
        ? 'semiannual'
        : 'monthly'
  const approvedAt = paymentJson.date_approved || new Date().toISOString()

  const adminClient = createClient(supabaseUrl, serviceRoleKey)
  const { data: professional, error: professionalError } = await adminClient
    .from('professionals')
    .select('id, subscription_expires_at')
    .eq('id', userId)
    .maybeSingle()

  if (professionalError) {
    return jsonResponse(500, { message: `No se pudo leer el profesional: ${professionalError.message}` })
  }
  if (!professional) {
    return jsonResponse(404, { message: 'No existe el profesional asociado al pago.' })
  }

  const currentExpiration =
    typeof professional.subscription_expires_at === 'string' &&
    new Date(professional.subscription_expires_at).getTime() > Date.now()
      ? professional.subscription_expires_at
      : approvedAt
  const nextExpiration = addBillingPeriod(currentExpiration, plan)

  const { error: updateError } = await adminClient
    .from('professionals')
    .update({
      subscription_status: 'active',
      subscription_expires_at: nextExpiration,
    })
    .eq('id', userId)

  if (updateError) {
    return jsonResponse(500, { message: `No se pudo activar la suscripción: ${updateError.message}` })
  }

  return jsonResponse(200, {
    received: true,
    userId,
    plan,
    subscriptionExpiresAt: nextExpiration,
  })
})
