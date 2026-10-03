import { useEffect, useRef, useState } from 'react'
import { loadSubscriptionAccount } from './subscriptionAccountService'
import { SubscriptionBenefits } from './SubscriptionBenefits'
import type { SubscriptionAccount, SubscriptionPlan } from './subscriptionAccountService'
import { useErrorNotification } from './useErrorNotification'

const PLAN_LABELS = { monthly: '30 días', semiannual: '6 meses (180 días)', annual: '1 año (365 días)' }
const PLANS: Array<{ plan: SubscriptionPlan; label: string; price: string }> = [
  { plan: 'monthly', label: '30 días', price: '$15.000' },
  { plan: 'semiannual', label: '6 meses', price: '$78.000' },
  { plan: 'annual', label: '1 año', price: '$120.000' },
]
const dateLabel = (value: string) => new Date(value).toLocaleString('es-AR', { timeZone: 'America/Argentina/Buenos_Aires', hourCycle: 'h23' })

export function SubscriptionAccountModal({ onClose, onSubscribe, busy }: {
  onClose: () => void
  onSubscribe: (plan: SubscriptionPlan) => void
  busy: SubscriptionPlan | null
}) {
  const [account, setAccount] = useState<SubscriptionAccount | null>(null)
  const [error, setError] = useErrorNotification()
  const [refresh, setRefresh] = useState(0)
  const [openedAt] = useState(() => Date.now())
  const panel = useRef<HTMLElement>(null)
  useEffect(() => {
    const previous = document.activeElement
    panel.current?.focus()
    return () => { if (previous instanceof HTMLElement) previous.focus() }
  }, [])
  useEffect(() => {
    let cancelled = false
    void loadSubscriptionAccount().then((data) => {
      if (!cancelled) setAccount(data)
    }).catch((error: unknown) => {
      if (!cancelled) setError(error instanceof Error ? error.message : 'No se pudo cargar tu suscripción.')
    })
    return () => { cancelled = true }
  }, [refresh, setError])

  return (
    <div className="subscription-account-backdrop" onClick={onClose}>
      <section ref={panel} tabIndex={-1} className="subscription-account-modal" role="dialog" aria-modal="true" aria-labelledby="subscription-account-title" onClick={(event) => event.stopPropagation()} onKeyDown={(event) => {
        if (event.key === 'Escape') onClose()
        if (event.key === 'Tab') {
          const elements = panel.current?.querySelectorAll<HTMLElement>('button:not(:disabled), [href], input, [tabindex="0"]')
          if (!elements?.length) return
          const first = elements[0]
          const last = elements[elements.length - 1]
          if (event.shiftKey && (document.activeElement === first || document.activeElement === panel.current)) {
            event.preventDefault(); last.focus()
          } else if (!event.shiftKey && document.activeElement === last) {
            event.preventDefault(); first.focus()
          }
        }
      }}>
        <header>
          <h2 id="subscription-account-title">Mi suscripción</h2>
          <button type="button" className="ghost" onClick={onClose} aria-label="Cerrar mi suscripción">Cerrar</button>
        </header>
        {error ? <div><p className="error">{error}</p><button type="button" onClick={() => { setError(null); setAccount(null); setRefresh((value) => value + 1) }}>Reintentar</button></div> : null}
        {!error && !account ? <p role="status">Consultando tu plan y consumo...</p> : null}
        {account ? <>
          <p><strong>{account.plan ? PLAN_LABELS[account.plan] : 'Sin un período comprado registrado'}</strong></p>
          <p>{account.expiresAt ? `Vencimiento: ${dateLabel(account.expiresAt)}. Quedan ${Math.max(0, Math.ceil((Date.parse(account.expiresAt) - openedAt) / 86400000))} días.` : 'No hay un vencimiento de suscripción registrado.'}</p>
          <h3>Consumo de Sofía</h3>
          <p><strong>{account.usage.used} de {account.usage.limit} consultas</strong> · Disponibles: {Math.max(0, account.usage.limit - account.usage.used)}</p>
          <progress value={Math.min(account.usage.used, account.usage.limit)} max={account.usage.limit} />
          {account.usage.used >= account.usage.limit * 0.8 ? <p className="notice">{account.usage.used >= account.usage.limit ? 'Cupo agotado. Las demás herramientas siguen disponibles.' : 'Consumiste al menos el 80% de tu cupo.'}</p> : null}
          <p>Tokens de entrada: {account.usage.inputTokens.toLocaleString('es-AR')} · Salida: {account.usage.outputTokens.toLocaleString('es-AR')} · Total: {account.usage.totalTokens.toLocaleString('es-AR')}</p>
          <p>{account.usage.resetsAt ? `El cupo se renueva el ${dateLabel(account.usage.resetsAt)} (hora de Argentina). Renovar la suscripción no reinicia el cupo.` : 'Durante la prueba gratuita se incluyen 3 consultas en total.'}</p>
          <SubscriptionBenefits />
          <h3>Renovar o extender</h3>
          <p>El período que compres se suma al tiempo disponible. No perdés días ni datos.</p>
          <div className="subscription-account-plans">{PLANS.map((option) => (
            <button type="button" key={option.plan} disabled={busy !== null} onClick={() => onSubscribe(option.plan)}>
              {busy === option.plan ? 'Abriendo pago...' : `${option.label} · ${option.price}`}
            </button>
          ))}</div>
          <h3>Últimos pagos confirmados</h3>
          {account.payments.length ? <ul>{account.payments.map((payment) => (
            <li key={payment.payment_id}>{PLAN_LABELS[payment.plan]} · ${Number(payment.amount).toLocaleString('es-AR')} · {dateLabel(payment.approved_at)} · Pago #{payment.payment_id}</li>
          ))}</ul> : <p>Todavía no hay compras registradas en este historial.</p>}
        </> : null}
      </section>
    </div>
  )
}
