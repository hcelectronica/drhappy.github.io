import sofiaReference from './assets/sofia-reference.png'

interface SofiaAvatarProps {
  state?: 'idle' | 'listening' | 'thinking' | 'ready'
}

export function SofiaAvatar({ state = 'idle' }: SofiaAvatarProps) {
  const label = `Sofía ${state === 'listening' ? 'está escuchando' : state === 'thinking' ? 'está pensando' : state === 'ready' ? 'terminó de responder' : 'está disponible'}`
  return (
    <div className="sofia-avatar" aria-label={label} role="img">
      <div className="sofia-avatar-image-wrap" aria-hidden="true">
        <img className="sofia-avatar-image" src={sofiaReference} alt="" />
      </div>
      <svg className="sofia-avatar-fallback" viewBox="0 0 180 180" aria-hidden="true">
        <defs>
          <linearGradient id="sofia-scrubs" x1="0" x2="1" y1="0" y2="1">
            <stop offset="0" stopColor="#9bd5f2" />
            <stop offset="1" stopColor="#579bc9" />
          </linearGradient>
          <linearGradient id="sofia-skin" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0" stopColor="#ffd7bd" />
            <stop offset="1" stopColor="#eda585" />
          </linearGradient>
        </defs>
        <ellipse className="sofia-avatar-shadow" cx="90" cy="166" rx="52" ry="8" />
        <path className="sofia-avatar-body" d="M48 157c2-28 9-47 25-54h34c17 8 24 27 26 54H48Z" fill="url(#sofia-scrubs)" />
        <path d="M73 104c4 8 10 12 17 12s13-4 17-12l-3-14H76l-3 14Z" fill="url(#sofia-skin)" />
        <path d="M64 111c8 8 16 12 26 12s18-4 26-12l8 8-14 15H70l-14-15 8-8Z" fill="#78bce0" />
        <path d="M79 125h22l8 32H71l8-32Z" fill="#e6f5fc" opacity=".8" />
        <rect x="91" y="126" width="22" height="16" rx="2" fill="#f8fdff" stroke="#6a9fba" strokeWidth="1.5" />
        <circle cx="97" cy="132" r="3" fill="#79c6dc" />
        <path d="M102 130h8M102 134h8M102 138h5" stroke="#4f7691" strokeWidth="1.5" strokeLinecap="round" />
        <path className="sofia-avatar-arm" d="M51 119c-10 9-14 21-11 29 2 5 8 6 11 2l13-20-7-12-6 1Z" fill="url(#sofia-skin)" />
        <path d="M129 119c10 9 14 21 11 29-2 5-8 6-11 2l-13-20 7-12 6 1Z" fill="url(#sofia-skin)" />
        <circle cx="90" cy="67" r="37" fill="url(#sofia-skin)" />
        <path className="sofia-avatar-hair" d="M53 67c-7-18-1-41 16-50 18-10 45-7 58 9 12 15 10 36 2 49-5-10-8-18-13-25-11 7-24 10-38 8-8-1-15-5-21-10-1 7-2 13-4 19Z" fill="#673d2f" />
        <g className="sofia-avatar-curls" fill="#80503a">
          <circle cx="58" cy="40" r="9" /><circle cx="72" cy="27" r="10" /><circle cx="89" cy="22" r="10" /><circle cx="108" cy="27" r="10" /><circle cx="124" cy="40" r="9" />
          <circle cx="51" cy="55" r="8" /><circle cx="130" cy="56" r="8" />
        </g>
        <ellipse cx="76" cy="68" rx="5" ry="7" fill="#fff" /><ellipse cx="104" cy="68" rx="5" ry="7" fill="#fff" />
        <circle cx="77" cy="69" r="3" fill="#3b2924" /><circle cx="103" cy="69" r="3" fill="#3b2924" />
        <path d="M85 81c4 4 7 4 11 0" fill="none" stroke="#9b4e4e" strokeWidth="2.5" strokeLinecap="round" />
        <path d="M83 76c4 2 10 2 14 0" fill="none" stroke="#d78d77" strokeWidth="1.5" strokeLinecap="round" />
        <path className="sofia-avatar-stethoscope" d="M68 108v15c0 13 10 22 22 22s22-9 22-22v-15M68 109c-4 3-7 3-10 0" fill="none" stroke="#334155" strokeWidth="3" strokeLinecap="round" />
        <circle cx="56" cy="108" r="7" fill="#cbd5e1" stroke="#334155" strokeWidth="3" />
      </svg>
    </div>
  )
}
