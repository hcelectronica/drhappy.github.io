import { isSupabaseConfigured, supabase } from './supabaseClient'

interface ConnectResponse {
  success: boolean
  connected?: boolean
  authorizationUrl?: string
  account?: {
    provider_user_id: string
    public_email?: string | null
    token_expires_at: string
    status: string
    connected_at: string
    updated_at: string
  } | null
  message?: string
}

async function request(action: string): Promise<ConnectResponse> {
  if (!isSupabaseConfigured || !supabase) return { success: false, message: 'Supabase no está conectado.' }
  const sessionToken = sessionStorage.getItem('drhappy-professional-session') || ''
  const { data, error } = await supabase.functions.invoke('mercadopago-connect', {
    body: { action },
    headers: sessionToken ? { 'x-drhappy-session': sessionToken } : undefined,
  })
  if (error) return { success: false, message: error.message || 'No se pudo conectar Mercado Pago.' }
  return data as ConnectResponse
}

export function getMercadoPagoConnectionStatus(): Promise<ConnectResponse> {
  return request('status')
}

export function startMercadoPagoConnection(): Promise<ConnectResponse> {
  return request('authorize')
}

export function disconnectMercadoPago(): Promise<ConnectResponse> {
  return request('disconnect')
}

export function verifyMercadoPagoConnection(): Promise<ConnectResponse> {
  return request('verify')
}
