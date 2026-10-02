import { supabase } from './supabaseClient'

export type SubscriptionPlan = 'monthly' | 'semiannual' | 'annual'
export const SUBSCRIPTION_BENEFITS = [
  'Pacientes ilimitados e historia clínica',
  'Certificados médicos y órdenes de estudios',
  'Invitación y registro de pacientes',
  'Turneras manual, gratuita y particular',
  'Balance de pagos y conexión con Mercado Pago',
  'Recordatorio por email a las 22:00 del día anterior',
  'Sofía: 100 consultas por mes calendario',
]
export interface SubscriptionAccount {
  plan: SubscriptionPlan | null
  status: string
  expiresAt: string | null
  usage: { used: number; limit: number; inputTokens: number; outputTokens: number; totalTokens: number; resetsAt: string | null }
  payments: Array<{ payment_id: string; plan: SubscriptionPlan; amount: number; approved_at: string; expires_at: string }>
}

export async function loadSubscriptionAccount(): Promise<SubscriptionAccount> {
  if (!supabase) throw new Error('Supabase no está conectado.')
  const token = sessionStorage.getItem('drhappy-professional-session')
  const { data, error } = await supabase.functions.invoke('subscription-account', {
    headers: token ? { 'x-drhappy-session': token } : undefined,
    body: {},
  })
  if (error) throw new Error(error.message)
  if (!data?.success || !data.account) throw new Error(data?.message || 'No se pudo consultar tu suscripción.')
  return data.account
}
