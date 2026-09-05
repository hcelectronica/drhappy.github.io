import { serve } from 'https://deno.land/std@0.224.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import webpush from 'npm:web-push@3.6.7'
import { corsHeaders } from '../_shared/cors.ts'

const VAPID_PUBLIC_KEY =
  Deno.env.get('VAPID_PUBLIC_KEY')?.trim() ||
  'BG4L8lMhlSk23SK20qTIyTZI2Af4yN_G-zCNkoqXLa75SRnQHsEm74IClL0ywCx3pVLiHECTIiSzibNtst9WXfM'
const VAPID_PRIVATE_KEY =
  Deno.env.get('VAPID_PRIVATE_KEY')?.trim() ||
  'mDF415FOiHz-UrNBkqIq-Mi5CgrpunJDR8bpCIu-zJg'
const VAPID_EMAIL =
  Deno.env.get('VAPID_EMAIL')?.trim() || 'mailto:soporte@drhappy.app'

webpush.setVapidDetails(VAPID_EMAIL, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY)

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
    return jsonResponse(405, { message: 'Método no permitido.' })
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL')?.trim()
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')?.trim()

  if (!supabaseUrl || !serviceRoleKey) {
    return jsonResponse(500, { message: 'Faltan credenciales de Supabase en el servidor.' })
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey)

  let body: Record<string, unknown> = {}
  try {
    body = await request.json()
  } catch {
    return jsonResponse(400, { message: 'Cuerpo JSON inválido.' })
  }

  const action = String(body.action || 'send')

  if (action === 'subscribe') {
    const userId = String(body.userId || '').trim()
    const subscription = body.subscription as {
      endpoint?: string
      keys?: { p256dh?: string; auth?: string }
    } | null

    if (!userId || !subscription?.endpoint) {
      return jsonResponse(400, { message: 'Faltan datos de suscripción o usuario.' })
    }

    const { error } = await supabase.from('user_push_subscriptions').upsert(
      {
        user_id: userId,
        endpoint: subscription.endpoint,
        p256dh: subscription.keys?.p256dh || null,
        auth: subscription.keys?.auth || null,
        subscription_json: subscription,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'endpoint' },
    )

    if (error) {
      return jsonResponse(500, { message: `Error al guardar suscripción: ${error.message}` })
    }

    return jsonResponse(200, { success: true, message: 'Suscripción guardada exitosamente.' })
  }

  // Acción: 'send'
  const isBroadcast = Boolean(body.broadcast)
  const recipientUserId = body.recipientUserId ? String(body.recipientUserId).trim() : null
  const title = String(body.title || 'Dr Happy 😊')
  const notificationText = String(body.body || body.text || 'Nuevo mensaje recibido')
  const tag = String(body.tag || 'drhappy-alert')
  const icon = String(body.icon || './icon-192.png')
  const badge = String(body.badge || './icon-192.png')
  const url = String(body.url || './')

  if (!isBroadcast && !recipientUserId) {
    return jsonResponse(400, { message: 'Se requiere recipientUserId o broadcast: true' })
  }

  let query = supabase.from('user_push_subscriptions').select('endpoint, subscription_json')
  if (!isBroadcast && recipientUserId) {
    query = query.eq('user_id', recipientUserId)
  }

  const { data: subscriptions, error } = await query
  if (error) {
    return jsonResponse(500, { message: `Error al consultar suscripciones: ${error.message}` })
  }

  if (!subscriptions || subscriptions.length === 0) {
    return jsonResponse(200, {
      success: true,
      sentCount: 0,
      message: 'No hay suscripciones registradas para este destinatario.',
    })
  }

  const pushPayload = JSON.stringify({
    title,
    body: notificationText,
    tag,
    icon,
    badge,
    data: { url },
  })

  let sentCount = 0
  let failedCount = 0
  const staleEndpoints: string[] = []

  const pushOptions = {
    TTL: 86400, // 24 horas de retención en FCM/APNs
    urgency: 'high' as const, // Prioridad ALTA: fuerza la entrega inmediata incluso con pantalla apagada / Doze mode
    headers: {
      'Urgency': 'high',
      'Topic': tag,
    },
  }

  await Promise.all(
    subscriptions.map(async (row) => {
      try {
        await webpush.sendNotification(row.subscription_json, pushPayload, pushOptions)
        sentCount += 1
      } catch (err: unknown) {
        failedCount += 1
        const statusCode = (err as { statusCode?: number })?.statusCode
        if (statusCode === 404 || statusCode === 410) {
          staleEndpoints.push(row.endpoint)
        }
      }
    }),
  )

  if (staleEndpoints.length > 0) {
    await supabase.from('user_push_subscriptions').delete().in('endpoint', staleEndpoints)
  }

  return jsonResponse(200, {
    success: true,
    sentCount,
    failedCount,
    totalTargeted: subscriptions.length,
  })
})
