import './AuthBackground.css'

interface CrossSpec {
  id: number
  left: string
  size: number
  delay: string
  duration: string
  drift: string
}

const CROSSES: CrossSpec[] = [
  { id: 1, left: '6%', size: 18, delay: '0s', duration: '14s', drift: '-30px' },
  { id: 2, left: '14%', size: 12, delay: '3s', duration: '18s', drift: '22px' },
  { id: 3, left: '24%', size: 22, delay: '1.5s', duration: '16s', drift: '-18px' },
  { id: 4, left: '38%', size: 14, delay: '5s', duration: '20s', drift: '26px' },
  { id: 5, left: '52%', size: 17, delay: '2.2s', duration: '15s', drift: '-24px' },
  { id: 6, left: '64%', size: 12, delay: '6s', duration: '19s', drift: '18px' },
  { id: 7, left: '76%', size: 20, delay: '0.8s', duration: '17s', drift: '-26px' },
  { id: 8, left: '88%', size: 15, delay: '4s', duration: '16s', drift: '24px' },
  { id: 9, left: '46%', size: 10, delay: '7s', duration: '21s', drift: '-14px' },
  { id: 10, left: '95%', size: 11, delay: '2.8s', duration: '15s', drift: '16px' },
]

/**
 * Fondo animado de la pantalla de ingreso:
 * - Trazado de electrocardiograma latiendo en loop (SVG con dash animation).
 * - Partículas de cruces médicas flotando en profundidad.
 * - Escena ilustrada de guardia: equipo médico atendiendo a un paciente.
 */
export default function AuthBackground() {
  return (
    <div className="auth-bg" aria-hidden="true">
      {/* Línea ECG animada */}
      <svg
        className="auth-bg-ecg auth-bg-ecg--top"
        viewBox="0 0 1200 120"
        preserveAspectRatio="none"
      >
        <path
          className="auth-bg-ecg-path"
          d="M0,60 L90,60 L110,60 L118,44 L126,60 L200,60 L214,60 L224,18 L236,96 L248,60 L340,60 L360,60 L368,48 L376,60 L470,60 L484,60 L494,22 L506,92 L518,60 L610,60 L630,60 L638,44 L646,60 L740,60 L754,60 L764,18 L776,96 L788,60 L880,60 L900,60 L908,48 L916,60 L1010,60 L1024,60 L1034,22 L1046,92 L1058,60 L1150,60 L1200,60"
          fill="none"
        />
      </svg>
      <svg
        className="auth-bg-ecg auth-bg-ecg--mid"
        viewBox="0 0 1200 120"
        preserveAspectRatio="none"
      >
        <path
          className="auth-bg-ecg-path"
          d="M0,60 L90,60 L110,60 L118,44 L126,60 L200,60 L214,60 L224,18 L236,96 L248,60 L340,60 L360,60 L368,48 L376,60 L470,60 L484,60 L494,22 L506,92 L518,60 L610,60 L630,60 L638,44 L646,60 L740,60 L754,60 L764,18 L776,96 L788,60 L880,60 L900,60 L908,48 L916,60 L1010,60 L1024,60 L1034,22 L1046,92 L1058,60 L1150,60 L1200,60"
          fill="none"
        />
      </svg>

      {/* Partículas de cruces médicas flotantes */}
      {CROSSES.map((cross) => (
        <span
          key={cross.id}
          className="auth-bg-cross"
          style={{
            left: cross.left,
            width: cross.size,
            height: cross.size,
            animationDelay: cross.delay,
            animationDuration: cross.duration,
            ['--drift' as string]: cross.drift,
          }}
        >
          <svg viewBox="0 0 24 24">
            <path
              d="M9 3h6v6h6v6h-6v6H9v-6H3V9h6V3z"
              fill="currentColor"
            />
          </svg>
        </span>
      ))}

      {/* Escena ilustrada: equipo de guardia atendiendo a un paciente */}
      <svg
        className="auth-bg-scene"
        viewBox="0 0 900 260"
        preserveAspectRatio="xMidYMax meet"
      >
        {/* Piso / base de la escena */}
        <ellipse cx="450" cy="248" rx="420" ry="14" className="scene-floor" />

        {/* Panel de pared con cruceta hospitalaria tenue */}
        <g className="scene-wall" opacity="0.55">
          <rect x="690" y="46" width="90" height="90" rx="16" />
          <path d="M735 62 v58 M706 91 h58" strokeLinecap="round" />
        </g>

        {/* Monitor de signos vitales */}
        <g className="scene-monitor">
          <rect x="128" y="42" width="118" height="78" rx="10" />
          <rect x="140" y="54" width="94" height="46" rx="6" className="monitor-screen" />
          <path
            d="M146,80 L162,80 L168,70 L174,88 L180,62 L186,84 L192,76 L206,76 L212,80 L226,80"
            fill="none"
            className="monitor-trace"
          />
          <rect x="168" y="122" width="38" height="46" rx="5" />
          <rect x="146" y="166" width="82" height="10" rx="5" />
        </g>

        {/* Carrito de curaciones con bandejas */}
        <g className="scene-cart">
          <rect x="652" y="150" width="96" height="10" rx="5" />
          <rect x="660" y="160" width="80" height="56" rx="8" />
          <rect x="668" y="170" width="64" height="10" rx="5" className="cart-tray" />
          <rect x="668" y="188" width="64" height="10" rx="5" className="cart-tray" />
          <circle cx="674" cy="226" r="7" />
          <circle cx="728" cy="226" r="7" />
        </g>

        {/* Cama / camilla con paciente */}
        <g className="scene-bed">
          <rect x="330" y="156" width="238" height="22" rx="11" />
          <rect x="352" y="178" width="12" height="46" rx="5" />
          <rect x="534" y="178" width="12" height="46" rx="5" />
          <circle cx="358" cy="228" r="7" />
          <circle cx="540" cy="228" r="7" />
          {/* Paciente */}
          <g className="scene-patient">
            <circle cx="368" cy="142" r="14" className="patient-head" />
            <path d="M382 150 q70 -16 148 6 l0 12 q-78 -18 -148 -4 z" className="patient-body" />
            <rect x="516" y="140" width="26" height="10" rx="5" className="patient-arm" />
          </g>
          {/* Manta */}
          <path d="M400 150 q56 -8 132 10 l0 14 q-80 -20 -132 -6 z" className="patient-blanket" />
        </g>

        {/* Médico 1: de pie al lado de la cama, sosteniendo planilla */}
        <g className="scene-medic medic-a">
          <circle cx="298" cy="96" r="16" className="medic-head" />
          <path d="M284 114 q14 -8 28 0 l6 58 q-20 8 -40 0 z" className="medic-coat" />
          <path d="M282 122 l-20 26" className="medic-arm" strokeLinecap="round" />
          <path d="M314 122 l22 14" className="medic-arm" strokeLinecap="round" />
          <rect x="330" y="130" width="26" height="34" rx="4" className="medic-clipboard" />
          <rect x="290" y="170" width="10" height="58" rx="5" className="medic-leg" />
          <rect x="306" y="170" width="10" height="58" rx="5" className="medic-leg" />
          {/* Estetoscopio */}
          <path d="M290 114 q8 22 16 0" fill="none" className="medic-stetho" strokeLinecap="round" />
        </g>

        {/* Médico 2: inclinado revisando al paciente */}
        <g className="scene-medic medic-b">
          <circle cx="596" cy="102" r="15" className="medic-head" />
          <path d="M584 118 q12 -7 24 0 l-4 44 q-26 10 -48 4 l8 -34 z" className="medic-coat" />
          <path d="M574 130 l-34 18" className="medic-arm" strokeLinecap="round" />
          <path d="M604 128 l18 22" className="medic-arm" strokeLinecap="round" />
          <rect x="586" y="162" width="10" height="64" rx="5" className="medic-leg" />
          <rect x="602" y="162" width="10" height="64" rx="5" className="medic-leg" />
          <path d="M588 118 q8 20 16 0" fill="none" className="medic-stetho" strokeLinecap="round" />
        </g>

        {/* Médico 3: al fondo, más pequeño, caminando con bandeja */}
        <g className="scene-medic medic-c">
          <circle cx="104" cy="122" r="12" className="medic-head" />
          <path d="M94 136 q10 -6 20 0 l5 44 q-15 6 -30 0 z" className="medic-coat" />
          <path d="M92 142 l-16 16" className="medic-arm" strokeLinecap="round" />
          <path d="M116 142 l18 10" className="medic-arm" strokeLinecap="round" />
          <rect x="128" y="146" width="22" height="7" rx="3.5" className="medic-tray" />
          <rect x="98" y="180" width="9" height="44" rx="4.5" className="medic-leg" />
          <rect x="111" y="180" width="9" height="44" rx="4.5" className="medic-leg" />
        </g>
      </svg>
    </div>
  )
}
