import { corsHeaders } from '../_shared/cors.ts'
import { createClient } from 'jsr:@supabase/supabase-js@2'
import { resolveProfessionalId } from '../_shared/professionalSession.ts'

function jsonResponse(status: number, body: Record<string, unknown>): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
}

async function sha256(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))
  return Array.from(new Uint8Array(digest)).map((byte) => byte.toString(16).padStart(2, '0')).join('')
}

function base64Url(bytes: Uint8Array): string {
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')
}

function decodeBase64(value: string): Uint8Array {
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (value.length % 4)) % 4)
  const binary = atob(normalized)
  return Uint8Array.from(binary, (char) => char.charCodeAt(0))
}

async function encryptionKey(): Promise<CryptoKey> {
  const raw = Deno.env.get('MP_TOKEN_ENCRYPTION_KEY')?.trim()
  if (!raw) throw new Error('Falta MP_TOKEN_ENCRYPTION_KEY.')
  const bytes = decodeBase64(raw)
  if (bytes.length !== 32) throw new Error('MP_TOKEN_ENCRYPTION_KEY debe tener 32 bytes en base64.')
  return crypto.subtle.importKey('raw', bytes, 'AES-GCM', false, ['encrypt', 'decrypt'])
}

async function encrypt(value: string): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const encrypted = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await encryptionKey(), new TextEncoder().encode(value))
  return `${base64Url(iv)}.${base64Url(new Uint8Array(encrypted))}`
}

async function decrypt(value: string): Promise<string> {
  const [ivPart, dataPart] = value.split('.')
  if (!ivPart || !dataPart) throw new Error('Token cifrado inválido.')
  const decrypted = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: decodeBase64(ivPart) }, await encryptionKey(), decodeBase64(dataPart))
  return new TextDecoder().decode(decrypted)
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  const supabaseUrl = Deno.env.get('SUPABASE_URL')?.trim()
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')?.trim()
  const clientId = Deno.env.get('MP_CLIENT_ID')?.trim()
  const clientSecret = Deno.env.get('MP_CLIENT_SECRET')?.trim()
  const redirectUri = Deno.env.get('MP_OAUTH_REDIRECT_URI')?.trim()
  const appBaseUrl = Deno.env.get('APP_BASE_URL')?.trim()
  if (!supabaseUrl || !serviceRoleKey || !clientId || !clientSecret || !redirectUri || !appBaseUrl) {
    return jsonResponse(500, { success: false, message: 'Falta configurar Mercado Pago OAuth en el servidor.' })
  }

  const admin = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false } })
  const url = new URL(request.url)
  let body: Record<string, unknown> = {}
  if (request.method === 'POST') {
    try { body = await request.json() } catch { return jsonResponse(400, { success: false, message: 'Cuerpo JSON inválido.' }) }
  }
  const action = url.searchParams.get('action') || (typeof body.action === 'string' ? body.action : '') || (url.searchParams.has('code') && url.searchParams.has('state') ? 'callback' : request.method === 'GET' ? 'authorize' : '')

  if (action === 'callback') {
    const code = url.searchParams.get('code')?.trim()
    const state = url.searchParams.get('state')?.trim()
    const errorDescription = url.searchParams.get('error_description') || url.searchParams.get('error')
    if (errorDescription) return Response.redirect(`${appBaseUrl}/?mp_connection=error&message=${encodeURIComponent(errorDescription)}`, 302)
    if (!code || !state) return Response.redirect(`${appBaseUrl}/?mp_connection=error&message=Respuesta OAuth incompleta`, 302)
    const stateHash = await sha256(state)
    const { data: oauthState } = await admin.from('professional_payment_oauth_states').select('professional_id, expires_at').eq('state_hash', stateHash).gt('expires_at', new Date().toISOString()).maybeSingle()
    if (!oauthState) return Response.redirect(`${appBaseUrl}/?mp_connection=error&message=Estado OAuth vencido o inválido`, 302)
    await admin.from('professional_payment_oauth_states').delete().eq('state_hash', stateHash)

    const tokenResponse = await fetch('https://api.mercadopago.com/oauth/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ client_id: clientId, client_secret: clientSecret, grant_type: 'authorization_code', code, redirect_uri: redirectUri }),
    })
    const token = await tokenResponse.json().catch(() => null)
    if (!tokenResponse.ok || !token?.access_token || !token?.refresh_token || !token?.user_id) {
      const detail = typeof token?.message === 'string' ? token.message : typeof token?.error_description === 'string' ? token.error_description : 'Mercado Pago no pudo autorizar la cuenta.'
      return Response.redirect(`${appBaseUrl}/?mp_connection=error&message=${encodeURIComponent(detail)}`, 302)
    }
    const expiresIn = Number(token.expires_in)
    const tokenExpiresAt = new Date(Date.now() + (Number.isFinite(expiresIn) ? expiresIn : 15552000) * 1000).toISOString()
    const publicEmail = typeof token.email === 'string' ? token.email : null
    const profileResponse = await fetch('https://api.mercadopago.com/users/me', { headers: { Authorization: `Bearer ${token.access_token}` } })
    const providerProfile = await profileResponse.json().catch(() => null)
    if (!profileResponse.ok || !providerProfile?.id) {
      const detail = typeof providerProfile?.message === 'string' ? providerProfile.message : 'Mercado Pago no validó el token recibido.'
      return Response.redirect(`${appBaseUrl}/?mp_connection=error&message=${encodeURIComponent(detail)}`, 302)
    }
    const { data: existingAccount } = await admin.from('professional_payment_accounts').select('id, professional_id').eq('provider', 'mercadopago').eq('provider_user_id', String(token.user_id)).maybeSingle()
    if (existingAccount && existingAccount.professional_id !== oauthState.professional_id) {
      return Response.redirect(`${appBaseUrl}/?mp_connection=error&message=${encodeURIComponent('Esta cuenta de Mercado Pago ya está vinculada a otro profesional de Dr Happy.')}`, 302)
    }
    const accountPayload = {
      professional_id: oauthState.professional_id,
      provider: 'mercadopago',
      provider_user_id: String(token.user_id),
      access_token_encrypted: await encrypt(String(token.access_token)),
      refresh_token_encrypted: await encrypt(String(token.refresh_token)),
      token_expires_at: tokenExpiresAt,
      public_email: publicEmail,
      status: 'connected',
      updated_at: new Date().toISOString(),
    }
    const accountResult = existingAccount
      ? await admin.from('professional_payment_accounts').update(accountPayload).eq('id', existingAccount.id)
      : await admin.from('professional_payment_accounts').upsert(accountPayload, { onConflict: 'professional_id,provider' })
    const accountError = accountResult.error
    if (accountError) {
      return Response.redirect(`${appBaseUrl}/?mp_connection=error&message=${encodeURIComponent(`No se pudo guardar la cuenta: ${accountError.message}`)}`, 302)
    }
    return Response.redirect(`${appBaseUrl}/?mp_connection=connected`, 302)
  }

  const professionalId = await resolveProfessionalId(request, admin)
  if (!professionalId) return jsonResponse(401, { success: false, message: 'Sesión profesional requerida.' })

  if (action === 'authorize') {
    const state = `${crypto.randomUUID()}-${crypto.randomUUID()}`
    const { error: stateError } = await admin.from('professional_payment_oauth_states').insert({ state_hash: await sha256(state), professional_id: professionalId, expires_at: new Date(Date.now() + 10 * 60 * 1000).toISOString() })
    if (stateError) return jsonResponse(500, { success: false, message: `No se pudo iniciar la conexión: ${stateError.message}` })
    const authorizationUrl = new URL('https://auth.mercadolibre.com.ar/authorization')
    authorizationUrl.searchParams.set('client_id', clientId)
    authorizationUrl.searchParams.set('response_type', 'code')
    authorizationUrl.searchParams.set('platform_id', 'mp')
    authorizationUrl.searchParams.set('redirect_uri', redirectUri)
    authorizationUrl.searchParams.set('state', state)
    return jsonResponse(200, { success: true, authorizationUrl: authorizationUrl.toString() })
  }

  if (action === 'status') {
    const { data } = await admin.from('professional_payment_accounts').select('access_token_encrypted, provider_user_id, public_email, token_expires_at, status, connected_at, updated_at').eq('professional_id', professionalId).eq('provider', 'mercadopago').maybeSingle()
    if (!data || data.status !== 'connected') return jsonResponse(200, { success: true, connected: false, account: data || null })
    try {
      const accessToken = await decrypt(data.access_token_encrypted)
      const response = await fetch('https://api.mercadopago.com/users/me', { headers: { Authorization: `Bearer ${accessToken}` } })
      const profile = await response.json().catch(() => null)
      if (!response.ok || !profile?.id) {
        await admin.from('professional_payment_accounts').update({ status: 'error', updated_at: new Date().toISOString() }).eq('professional_id', professionalId).eq('provider', 'mercadopago')
        return jsonResponse(200, { success: true, connected: false, account: { ...data, status: 'error' }, message: typeof profile?.message === 'string' ? profile.message : 'Mercado Pago rechazó el token.' })
      }
      return jsonResponse(200, { success: true, connected: true, account: { ...data, provider_user_id: String(profile.id), public_email: profile.email || data.public_email || null } })
    } catch (error) {
      await admin.from('professional_payment_accounts').update({ status: 'error', updated_at: new Date().toISOString() }).eq('professional_id', professionalId).eq('provider', 'mercadopago')
      return jsonResponse(200, { success: true, connected: false, account: { ...data, status: 'error' }, message: error instanceof Error ? error.message : 'No se pudo verificar la conexión.' })
    }
  }

  if (action === 'verify') {
    const { data } = await admin.from('professional_payment_accounts').select('access_token_encrypted, provider_user_id, public_email, token_expires_at, status').eq('professional_id', professionalId).eq('provider', 'mercadopago').maybeSingle()
    if (!data || data.status !== 'connected') return jsonResponse(200, { success: true, connected: false, message: 'Cuenta Mercado Pago no conectada.' })
    try {
      const accessToken = await decrypt(data.access_token_encrypted)
      const response = await fetch('https://api.mercadopago.com/users/me', { headers: { Authorization: `Bearer ${accessToken}` } })
      const profile = await response.json().catch(() => null)
      if (!response.ok || !profile?.id) {
        await admin.from('professional_payment_accounts').update({ status: 'error', updated_at: new Date().toISOString() }).eq('professional_id', professionalId).eq('provider', 'mercadopago')
        return jsonResponse(200, { success: true, connected: false, message: 'Mercado Pago rechazó el token de conexión.' })
      }
      return jsonResponse(200, { success: true, connected: true, account: { provider_user_id: String(profile.id), public_email: profile.email || data.public_email || null, token_expires_at: data.token_expires_at, status: 'connected' } })
    } catch (error) {
      return jsonResponse(200, { success: true, connected: false, message: error instanceof Error ? error.message : 'No se pudo verificar la conexión con Mercado Pago.' })
    }
  }

  if (action === 'disconnect') {
    await admin.from('professional_payment_accounts').update({ status: 'revoked', updated_at: new Date().toISOString() }).eq('professional_id', professionalId).eq('provider', 'mercadopago')
    return jsonResponse(200, { success: true })
  }

  if (action === 'token-check') {
    const { data } = await admin.from('professional_payment_accounts').select('access_token_encrypted').eq('professional_id', professionalId).eq('provider', 'mercadopago').maybeSingle()
    if (!data) return jsonResponse(404, { success: false, message: 'Cuenta Mercado Pago no conectada.' })
    try {
      await decrypt(data.access_token_encrypted)
      return jsonResponse(200, { success: true })
    } catch {
      return jsonResponse(500, { success: false, message: 'No se pudo descifrar la conexión.' })
    }
  }

  return jsonResponse(400, { success: false, message: 'Acción no soportada.' })
})
