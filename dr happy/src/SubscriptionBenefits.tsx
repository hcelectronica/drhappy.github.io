import { SUBSCRIPTION_BENEFITS } from './subscriptionAccountService'

const ICON_PATHS: Record<string, string> = {
  patients: 'M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2 M16 3a4 4 0 0 1 0 8 M22 21v-2a4 4 0 0 0-3-3.87 M13 7a4 4 0 1 1-8 0 4 4 0 0 1 8 0',
  documents: 'M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z M14 2v6h6 M8 13h8 M8 17h5',
  invite: 'M4 4h16v16H4z M4 5l8 7 8-7 M9 16h6',
  calendar: 'M3 5h18v16H3z M16 3v4 M8 3v4 M3 11h18 M8 15h2 M14 15h2',
  payments: 'M3 5h18v14H3z M3 9h18 M7 15h4',
  reminders: 'M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9 M10 21h4',
  sofia: 'M12 3l2.5 6.5L21 12l-6.5 2.5L12 21l-2.5-6.5L3 12l6.5-2.5z M19 2v4 M17 4h4',
}

export function SubscriptionBenefits() {
  return (
    <div className="subscription-benefits">
      <div className="subscription-benefits-heading">
        <span className="subscription-benefits-check" aria-hidden="true">✓</span>
        <div>
          <strong>Todo incluido</strong>
          <p>Las mismas herramientas en todos los planes.</p>
        </div>
      </div>
      <ul className="subscription-benefits-list">
        {SUBSCRIPTION_BENEFITS.map((benefit) => (
          <li key={benefit.id} className={benefit.id === 'sofia' ? 'subscription-benefit subscription-benefit--sofia' : 'subscription-benefit'}>
            <span className="subscription-benefit-icon" aria-hidden="true">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
                <path d={ICON_PATHS[benefit.id]} />
              </svg>
            </span>
            <div className="subscription-benefit-copy">
              <strong>{benefit.title}</strong>
              <p>{benefit.description}</p>
            </div>
          </li>
        ))}
      </ul>
    </div>
  )
}
