import { supabase } from './supabaseClient'

export type SubscriptionPlan = 'monthly' | 'semiannual' | 'annual'
export const SUBSCRIPTION_BENEFITS = [
  { id: 'patients', title: 'Pacientes sin límite', description: 'Historia clínica en un solo lugar.' },
  { id: 'documents', title: 'Certificados y órdenes', description: 'Documentación médica y pedidos de estudios.' },
  { id: 'invite', title: 'Invitá a tus pacientes', description: 'Link de registro para completar sus datos.' },
  { id: 'calendar', title: 'Tres turneras incluidas', description: 'Manual, gratuita y particular.' },
  { id: 'payments', title: 'Cobros más claros', description: 'Balance de pagos y conexión con Mercado Pago.' },
  { id: 'reminders', title: 'Recordatorios por email', description: 'A las 22:00 de Argentina, para los turnos del día siguiente.' },
  { id: 'sofia', title: 'Sofía, tu asistente IA', description: '100 consultas con IA mensuales.' },
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
