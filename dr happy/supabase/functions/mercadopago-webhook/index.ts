import { serve } from 'https://deno.land/std@0.224.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { corsHeaders } from '../_shared/cors.ts'
import { notifyAdminSubscriptionPayment, type SubscriptionPaymentPlan } from '../_shared/adminSubscriptionPaymentEmail.ts'

type PaymentDetails = {
  status?: string
  external_reference?: string
  date_approved?: string
  transaction_amount?: number
  currency_id?: string
  payment_method_id?: string
  metadata?: {
    user_id?: string
    plan?: SubscriptionPaymentPlan
  }
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

  const plan = paymentJson.metadata?.plan
  if (!plan || !['monthly', 'semiannual', 'annual'].includes(plan)
    || paymentJson.currency_id !== 'ARS' || !paymentJson.transaction_amount || paymentJson.transaction_amount <= 0) {
    return jsonResponse(400, { message: 'El pago no contiene un plan o importe válido en pesos argentinos.' })
  }
  const approvedAt = paymentJson.date_approved || new Date().toISOString()

  const adminClient = createClient(supabaseUrl, serviceRoleKey)
  const { data: applied, error } = await adminClient.rpc('apply_subscription_payment', {
    p_professional_id: userId, p_payment_id: paymentId, p_plan: plan,
    p_amount: paymentJson.transaction_amount, p_approved_at: approvedAt,
  })
  if (error) {
    return jsonResponse(500, { message: `No se pudo aplicar el pago: ${error.message}` })
  }

  const { data: noticeState, error: noticeStateError } = await adminClient
    .from('subscription_payments')
    .select('admin_notice_sent_at')
    .eq('payment_id', paymentId)
    .single()
  if (noticeStateError || !noticeState) {
    return jsonResponse(500, { message: `No se pudo consultar el estado del aviso de pago: ${noticeStateError?.message || 'No se encontró el pago registrado.'}` })
  }

  if (!noticeState.admin_notice_sent_at) {
    const { data: claimed, error: claimError } = await adminClient.rpc('claim_subscription_payment_notice', {
      p_payment_id: paymentId,
    })
    if (claimError) {
      return jsonResponse(500, { message: `No se pudo reservar el aviso de pago: ${claimError.message}` })
    }
    if (!claimed) {
      return jsonResponse(503, { message: 'El aviso de este pago está en proceso; Mercado Pago puede reintentarlo.' })
    }

    let noticeError: string | null = null
    let professional: { full_name: string; username: string; email: string } | null = null
    const { data: professionalData, error: professionalError } = await adminClient
      .from('professionals')
      .select('full_name, username, email')
      .eq('id', userId)
      .single()
    if (professionalError || !professionalData) {
      noticeError = `No se pudieron consultar los datos del profesional: ${professionalError?.message || 'Cuenta no encontrada.'}`
    } else {
      professional = professionalData
      try {
        await notifyAdminSubscriptionPayment(supabaseUrl, serviceRoleKey, {
          paymentId,
          professionalId: userId,
          professionalName: professional.full_name,
          professionalUsername: professional.username,
          professionalEmail: professional.email,
          plan,
          amount: paymentJson.transaction_amount,
          approvedAt,
          expiresAt: applied.expiresAt,
          paymentMethod: paymentJson.payment_method_id,
        })
      } catch (error) {
        noticeError = error instanceof Error ? error.message : String(error)
      }
    }

    const { data: noticeCompleted, error: noticeCompletionError } = await adminClient.rpc('complete_subscription_payment_notice', {
      p_payment_id: paymentId,
      p_succeeded: noticeError === null,
      p_error: noticeError,
    })
    if (noticeCompletionError || !noticeCompleted) {
      console.error('[mercadopago-webhook] No se pudo cerrar el estado del aviso de pago.', {
        paymentId,
        professionalId: userId,
        message: noticeCompletionError?.message || 'No se confirmó el cierre del aviso.',
      })
      return jsonResponse(500, { message: 'El pago quedó registrado, pero no se pudo confirmar el aviso administrativo.' })
    }
    if (noticeError) {
      console.error('[mercadopago-webhook] No se pudo enviar el aviso de pago; se permite el reintento.', {
        paymentId,
        professionalId: userId,
        message: noticeError,
      })
      return jsonResponse(502, { message: 'El pago quedó registrado, pero no se pudo enviar el aviso administrativo.' })
    }
  }

  return jsonResponse(200, {
    received: true,
    userId,
    plan,
    subscriptionExpiresAt: applied.expiresAt,
    applied: applied.applied,
    adminNotified: true,
  })
})
