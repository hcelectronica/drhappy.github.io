import { serve } from 'https://deno.land/std@0.224.0/http/server.ts'
import { corsHeaders } from '../_shared/cors.ts'

type SubscriptionPlan = 'monthly' | 'semiannual' | 'annual'

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
    return jsonResponse(405, { message: 'Method not allowed.' })
  }

  const mpAccessToken = Deno.env.get('MP_ACCESS_TOKEN')?.trim()
  const appBaseUrl = Deno.env.get('APP_BASE_URL')?.trim()
  const successUrl = Deno.env.get('MP_BACK_URL_SUCCESS')?.trim() || appBaseUrl
  const pendingUrl = Deno.env.get('MP_BACK_URL_PENDING')?.trim() || appBaseUrl
  const failureUrl = Deno.env.get('MP_BACK_URL_FAILURE')?.trim() || appBaseUrl
  const monthlyPriceRaw = Deno.env.get('MP_MONTHLY_PRICE_ARS')?.trim()
  const semiannualPriceRaw = Deno.env.get('MP_SEMIANNUAL_PRICE_ARS')?.trim()
  const annualPriceRaw = Deno.env.get('MP_ANNUAL_PRICE_ARS')?.trim()
  const supabaseUrl = Deno.env.get('SUPABASE_URL')?.trim()

  if (!mpAccessToken || !appBaseUrl || !successUrl || !pendingUrl || !failureUrl || !supabaseUrl) {
    return jsonResponse(500, { message: 'Faltan secrets obligatorios de MercadoPago o APP_BASE_URL.' })
  }

  let payload: Record<string, unknown>
  try {
    payload = await request.json()
  } catch {
    return jsonResponse(400, { message: 'Body JSON inválido.' })
  }

  const userId = typeof payload.userId === 'string' ? payload.userId.trim() : ''
  const email = typeof payload.email === 'string' ? payload.email.trim() : ''
  const fullName = typeof payload.fullName === 'string' ? payload.fullName.trim() : ''
  const plan =
    payload.plan === 'annual' ? 'annual' : payload.plan === 'semiannual' ? 'semiannual' : 'monthly'

  if (!userId || !email) {
    return jsonResponse(400, { message: 'Faltan userId o email para generar el checkout.' })
  }

  const planConfig =
    plan === 'annual'
      ? {
          chosenPriceRaw: annualPriceRaw,
          title: 'Dr Happy - Suscripción anual',
          configErrorMessage: 'El plan anual todavía no está configurado en MercadoPago.',
        }
      : plan === 'semiannual'
        ? {
            chosenPriceRaw: semiannualPriceRaw,
            title: 'Dr Happy - Suscripción 6 meses',
            configErrorMessage: 'El plan de 6 meses todavía no está configurado en MercadoPago.',
          }
        : {
            chosenPriceRaw: monthlyPriceRaw,
            title: 'Dr Happy - Suscripción mensual',
            configErrorMessage: 'El precio mensual no está configurado.',
          }
  const { chosenPriceRaw } = planConfig
  if (!chosenPriceRaw) {
    return jsonResponse(400, { message: planConfig.configErrorMessage })
  }

  const unitPrice = Number(chosenPriceRaw)
  if (!Number.isFinite(unitPrice) || unitPrice <= 0) {
    return jsonResponse(400, { message: 'El precio configurado no es válido.' })
  }

  const preferenceResponse = await fetch('https://api.mercadopago.com/checkout/preferences', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${mpAccessToken}`,
      'Content-Type': 'application/json',
      'X-Idempotency-Key': crypto.randomUUID(),
    },
    body: JSON.stringify({
      items: [
        {
          id: `drhappy-${plan}`,
          title: planConfig.title,
          quantity: 1,
          currency_id: 'ARS',
          unit_price: unitPrice,
        },
      ],
      payer: {
        email,
        name: fullName || undefined,
      },
      external_reference: userId,
      metadata: {
        user_id: userId,
        plan,
        payer_email: email,
      },
      back_urls: {
        success: successUrl,
        pending: pendingUrl,
        failure: failureUrl,
      },
      auto_return: 'approved',
      notification_url: `${supabaseUrl}/functions/v1/mercadopago-webhook`,
    }),
  })

  const preferenceJson = await preferenceResponse.json().catch(() => null)
  if (!preferenceResponse.ok || !preferenceJson || typeof preferenceJson !== 'object') {
    return jsonResponse(502, {
      message: 'MercadoPago rechazó la creación del checkout.',
      details: preferenceJson,
    })
  }

  const responseData = preferenceJson as Record<string, unknown>
  return jsonResponse(200, {
    id: responseData.id,
    initPoint: responseData.init_point,
    sandboxInitPoint: responseData.sandbox_init_point,
  })
})
