type Service = 'emergency' | 'care' | 'calendar' | 'patients' | 'certificates' | 'invite' | 'protocols' | 'ledger'

export function ServiceIllustration({ service }: { service: Service }) {
  return <svg className="auth-promo-service-icon" viewBox="0 0 64 64" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    {service === 'emergency' ? <>
      <path d="M8 18h30v28H8zM38 28h10l9 11v7H38" fill="#fff" />
      <path d="M42 32h5l5 7H42zM18 14h10M23 24v14M16 31h14" />
      <circle cx="19" cy="47" r="6" fill="#fff" /><circle cx="47" cy="47" r="6" fill="#fff" />
    </> : null}
    {service === 'care' ? <>
      <path d="M14 12v13a13 13 0 0 0 26 0V12M10 12h8M36 12h8M27 38v7a10 10 0 0 0 20 0v-6" />
      <circle cx="47" cy="32" r="7" fill="#fff" /><circle cx="47" cy="32" r="2" />
    </> : null}
    {service === 'calendar' ? <>
      <rect x="9" y="13" width="46" height="43" rx="6" fill="#fff" />
      <path d="M9 25h46M21 8v11M43 8v11M21 40l7 7 15-15" />
    </> : null}
    {service === 'patients' ? <>
      <path d="M17 8h23l10 10v38H17z" fill="#fff" /><path d="M40 8v12h10" />
      <path d="M11 37h12l4-8 7 17 5-9h14M24 51h17" />
    </> : null}
    {service === 'certificates' ? <>
      <path d="M12 8h29l10 10v38H12z" fill="#fff" /><path d="M41 8v12h10M21 26h20M21 33h15M20 45l5-5 3 5 7-4" />
      <circle cx="46" cy="47" r="8" fill="#fff" /><path d="m42 54-1 7 5-3 5 3-1-7" />
    </> : null}
    {service === 'invite' ? <>
      <circle cx="25" cy="19" r="9" fill="#fff" /><path d="M8 49v-5a17 17 0 0 1 31-10" />
      <rect x="33" y="34" width="25" height="18" rx="3" fill="#fff" /><path d="m34 36 11 9 12-9M49 10v12M43 16h12" />
    </> : null}
    {service === 'protocols' ? <>
      <path d="M7 13c9-4 17-3 25 2 8-5 16-6 25-2v38c-9-4-17-3-25 2-8-5-16-6-25-2z" fill="#fff" />
      <path d="M32 15v38M14 25h11M14 32h11M14 39h11M44 24v15M37 32h14" />
    </> : null}
    {service === 'ledger' ? <>
      <rect x="11" y="9" width="31" height="44" rx="5" fill="#fff" /><path d="M18 17h17v9H18zM19 34h2M30 34h2M19 42h2M30 42h2" />
      <circle cx="46" cy="44" r="13" fill="#fff" /><path d="M49 37h-5a3 3 0 0 0 0 6h3a3 3 0 0 1 0 6h-5M46 34v18" />
    </> : null}
  </svg>
}
