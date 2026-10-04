import { useState } from 'react'
import './dentalPromoFlyer.css'

const rows = [
  [18, 17, 16, 15, 14, 13, 12, 11, 21, 22, 23, 24, 25, 26, 27, 28],
  [48, 47, 46, 45, 44, 43, 42, 41, 31, 32, 33, 34, 35, 36, 37, 38],
]

function Surfaces({ animated = false }: { animated?: boolean }) {
  return <>
    <polygon points="8,8 56,8 43,21 21,21" />
    <polygon className={animated ? 'dental-promo-blue' : undefined} points="56,8 56,56 43,43 43,21" />
    <polygon points="56,56 8,56 21,43 43,43" />
    <polygon points="8,56 8,8 21,21 21,43" />
    <polygon className={animated ? 'dental-promo-red' : undefined} points="21,21 43,21 43,43 21,43" />
  </>
}

export function DentalPromoFlyer() {
  const [active, setActive] = useState(false)
  const [replay, setReplay] = useState(0)
  const play = () => { setActive(true); setReplay((value) => value + 1) }
  return <article
    className={`flyer-tool auth-promo-tool auth-promo-tool--green dental-promo-flyer${active ? ' dental-promo-flyer--active' : ''}`}
    role="button"
    tabIndex={0}
    aria-label="Odontograma interactivo. Ver demostración de selección de pieza y superficies en rojo y azul. Escape para volver."
    aria-pressed={active}
    onPointerEnter={(event) => { if (event.pointerType === 'mouse') play() }}
    onPointerLeave={(event) => { if (event.pointerType === 'mouse') setActive(false) }}
    onClick={play}
    onBlur={() => setActive(false)}
    onKeyDown={(event) => {
      if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); play() }
      if (event.key === 'Escape') setActive(false)
    }}
  >
    <div className="auth-promo-tool-art auth-promo-tool-art--dental" aria-hidden="true">
      <svg className="auth-promo-dental-icon" viewBox="0 0 64 64" fill="none">
        <path d="M32 13C23 7 13 9 11 20c-2 10 4 17 6 28 1 8 5 10 8 2l4-12c1-4 5-4 6 0l4 12c3 8 7 6 8-2 2-11 8-18 6-28C51 9 41 7 32 13Z" fill="#fff" stroke="currentColor" strokeWidth="3" strokeLinejoin="round" />
        <path d="M24 17c4 2 9 3 15 0" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      </svg>
      <span>EXCLUSIVA PARA ODONTÓLOGOS</span><strong>CADA PIEZA.<br />TODO REGISTRADO.</strong><small>Tu ficha dental, simple e interactiva</small>
    </div>
    <strong>Odontograma interactivo</strong>
    <small>Registrá hallazgos por pieza y superficie. Tratamientos, presupuestos, costos y pagos conectados al balance. Adaptado al celular, con ficha completa en PDF a color.</small>
    <small className="dental-promo-hint">Pasá el mouse o tocá para ver cómo funciona.</small>
    {active ? <div key={replay} className="dental-promo-demo" aria-hidden="true">
      <div className="dental-promo-demo-heading"><span>ODONTOGRAMA EN ACCIÓN</span><span>DEMO</span></div>
      <svg viewBox="0 0 340 270">
        <g className="dental-promo-overview">
          {rows.flatMap((row, rowIndex) => row.map((tooth, index) => <g key={tooth} transform={`translate(${index % 8 * 40 + 12},${rowIndex * 136 + Math.floor(index / 8) * 64 + 12})`}>
            <rect className={tooth === 36 ? 'dental-promo-selected' : undefined} x="-3" y="-1" width="36" height="52" rx="5" fill="transparent" />
            <text x="15" y="10" textAnchor="middle" fontSize="11">{tooth}</text>
            <g transform="translate(0,14) scale(.48)" fill="#fff" stroke="#819d9d" strokeWidth="2"><Surfaces /></g>
          </g>))}
        </g>
        <g className="dental-promo-detail">
          <rect x="22" y="14" width="296" height="239" rx="14" fill="#fff" stroke="#c6ded7" />
          <text x="170" y="39" textAnchor="middle" fontSize="15" fontWeight="700">Pieza 36 · Elegí la superficie</text>
          <g transform="translate(100,62) scale(2.2)" fill="#fff" stroke="#719292" strokeWidth=".8"><Surfaces animated /></g>
          <circle cx="49" cy="225" r="5" fill="#b42336" /><text x="59" y="229" fontSize="10">Por realizar</text>
          <circle cx="186" cy="225" r="5" fill="#2457ba" /><text x="196" y="229" fontSize="10">Realizado</text>
        </g>
        <g className="dental-promo-cursor"><path d="M0 0V23L6 17L11 28L16 25L11 15H21Z" fill="#17324d" stroke="#fff" strokeWidth="1.5" strokeLinejoin="round" /></g>
      </svg>
      <div className="dental-promo-caption">
        <span>El cursor selecciona la pieza 36</span>
        <span>Seleccionás la superficie oclusal · rojo</span>
        <span>Otra superficie registrada · azul</span>
      </div>
    </div> : null}
  </article>
}
