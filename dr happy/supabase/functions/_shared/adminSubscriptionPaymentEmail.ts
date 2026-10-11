import { ADMIN_REGISTRATION_RECIPIENT } from './adminRegistrationEmail.ts'

export type SubscriptionPaymentPlan = 'monthly' | 'semiannual' | 'annual'

export interface AdminSubscriptionPaymentNotice {
  paymentId: string
  professionalId: string
  professionalName: string
  professionalUsername: string
  professionalEmail: string
  plan: SubscriptionPaymentPlan
  amount: number
  approvedAt: string
  expiresAt: string
  paymentMethod?: string | null
}

const PLAN_LABELS: Record<SubscriptionPaymentPlan, string> = {
  monthly: 'Mensual',
  semiannual: 'Semestral',
  annual: 'Anual',
}

function escapeHtml(value: string): string {
  return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;').replaceAll("'", '&#39;')
}

export function adminSubscriptionPaymentEmail(payment: AdminSubscriptionPaymentNotice) {
  const approvedAt = new Date(payment.approvedAt)
  if (!Number.isFinite(approvedAt.getTime())) throw new Error('La fecha de aprobación del pago no es válida.')
  if (!Number.isFinite(payment.amount) || payment.amount <= 0) throw new Error('El importe del pago no es válido.')

  const text = [
    'Se acreditó un pago de suscripción en Dr Happy.',
    '',
    `Profesional: ${payment.professionalName}`,
    `Usuario: ${payment.professionalUsername}`,
    `Email de la cuenta: ${payment.professionalEmail}`,
    `ID de cuenta: ${payment.professionalId}`,
    `Plan: ${PLAN_LABELS[payment.plan]}`,
    `Importe: ${new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS' }).format(payment.amount)}`,
    `Aprobado: ${approvedAt.toLocaleString('es-AR', { timeZone: 'America/Argentina/Buenos_Aires' })}`,
    `Medio de pago: ${payment.paymentMethod || 'Mercado Pago'}`,
    `ID de pago de Mercado Pago: ${payment.paymentId}`,
    `Suscripción vigente hasta: ${payment.expiresAt}`,
    '',
    'El pago queda registrado en el historial de suscripción de la cuenta.',
    'https://www.drhappy.com.ar/',
  ].join('\n')

  return {
    to: ADMIN_REGISTRATION_RECIPIENT,
    subject: 'Dr Happy - Pago de suscripción acreditado',
    type: 'custom',
    text,
    templateData: { message: escapeHtml(text).replaceAll('\n', '<br>') },
  }
}

export async function notifyAdminSubscriptionPayment(
  url: string,
  key: string,
  payment: AdminSubscriptionPaymentNotice,
  send: typeof fetch = fetch,
): Promise<void> {
  const response = await send(`${url}/functions/v1/send-email`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}`, apikey: key },
    body: JSON.stringify(adminSubscriptionPaymentEmail(payment)),
    signal: AbortSignal.timeout(10000),
  })
  const result: unknown = await response.json()
  if (!response.ok || !result || typeof result !== 'object' || !('success' in result) || result.success !== true) {
    throw new Error(`No se confirmó el envío del aviso de pago (HTTP ${response.status}).`)
  }
}
