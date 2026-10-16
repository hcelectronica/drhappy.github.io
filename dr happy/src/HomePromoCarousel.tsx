import { useEffect, useId, useState } from 'react'
import type { MobileHomeAction } from './MobileHomeMenu'
import { PromotionalArtwork } from './PromotionalArtwork'
import { DentalPromoFlyer } from './DentalPromoFlyer'
import { SofiaAvatar } from './SofiaAvatar'
import './homePromotions.css'

type PromoAction = Pick<MobileHomeAction, 'key' | 'label' | 'icon'>
const promotions = [
  { key: 'attention', service: 'care', title: 'Atención médica', detail: 'Historias clínicas, evoluciones y seguimiento en un mismo espacio. Tené el contexto del paciente a mano durante cada consulta.' },
  { key: 'appointments', service: 'calendar', title: 'Turnera inteligente', detail: 'Organizá tus horarios, compartí tu link de reservas y enviá recordatorios automáticos para ayudar a reducir ausencias.' },
  { key: 'patients', service: 'patients', title: 'Historia clínica digital', detail: 'Reuní antecedentes, consultas y documentos en la ficha del paciente, con Sofía IA para preparar y organizar tus evoluciones.' },
  { key: 'video', service: 'video', title: 'Videoconsulta profesional', detail: 'Iniciá una consulta por video desde la ficha del paciente o el turno, con un acceso temporal y protegido.' },
  { key: 'invite', service: 'invite', title: 'Tus pacientes, más cerca', detail: 'Compartí tu link personal o código QR y sumalos a Mis pacientes sin cargar sus datos a mano.' },
  { key: 'paid-documents', service: 'certificates', title: 'Documentos clínicos', detail: 'Prepará, firmá y compartí certificados desde la ficha del paciente. Tu información profesional, firma gráfica y código QR en un mismo documento.' },
  { key: 'tools', service: 'protocols', title: 'Protocolos y vademécum', detail: 'Consultá recursos clínicos durante la atención: protocolos, guías y medicamentos para acompañar tu criterio profesional.' },
  { key: 'ledger', service: 'ledger', title: 'Cobros más claros', detail: 'Llevá un registro de cobros, pagos y saldos. Seguí los movimientos del consultorio desde un mismo lugar.' },
  { key: 'ambulance', service: 'emergency', title: 'Atención en movimiento', detail: 'Organizá la información clínica para traslados y guardias, y conservá el registro de la atención en la ficha del paciente.' },
] as const

function PromoCarousel({ actions }: { actions: ReadonlyArray<PromoAction> }) {
  const titleId = useId()
  const slides = [
    ...(actions.some(action => action.key === 'sofia') ? [{ key: 'sofia' as const, title: 'Sofía, tu secretaria clínica', detail: 'Una asistente para trabajar con tu agenda, tus pacientes y tus tareas clínicas desde Dr Happy.' }] : []),
    ...promotions.filter(promo => actions.some(action => action.key === promo.key)),
  ]
  const [index, setIndex] = useState(0)
  const [paused, setPaused] = useState(false)
  const [hovered, setHovered] = useState(false)
  const [focused, setFocused] = useState(false)
  const [hidden, setHidden] = useState(() => document.hidden)
  const [reducedMotion, setReducedMotion] = useState(() => matchMedia('(prefers-reduced-motion: reduce)').matches)
  const current = slides[index % Math.max(1, slides.length)]
  const dental = actions.some(action => action.key === 'attention' && /odont/i.test(action.label))
  const rotating = !paused && !hovered && !focused && !hidden && !reducedMotion
  useEffect(() => {
    const query = matchMedia('(prefers-reduced-motion: reduce)')
    const updateMotion = () => setReducedMotion(query.matches)
    const updateVisibility = () => setHidden(document.hidden)
    query.addEventListener('change', updateMotion)
    document.addEventListener('visibilitychange', updateVisibility)
    return () => {
      query.removeEventListener('change', updateMotion)
      document.removeEventListener('visibilitychange', updateVisibility)
    }
  }, [])
  useEffect(() => {
    if (!rotating || slides.length < 2) return
    const timer = window.setInterval(() => setIndex(value => (value + 1) % slides.length), 7000)
    return () => window.clearInterval(timer)
  }, [rotating, slides.length, index])
  if (!current) return null
  const move = (direction: number) => setIndex((index + direction + slides.length) % slides.length)
  const title = dental && current.key === 'attention' ? 'Odontograma interactivo' : current.title

  return <section className="home-promo-carousel" aria-labelledby={titleId} aria-roledescription="carrusel"
    onMouseEnter={() => setHovered(true)} onMouseLeave={() => setHovered(false)}
    onFocusCapture={() => setFocused(true)}
    onBlurCapture={event => { if (!event.currentTarget.contains(event.relatedTarget)) setFocused(false) }}>
    <header><span className="section-kicker">CONOCÉ DR HAPPY</span><h2 id={titleId}>Más posibilidades para tu consultorio</h2></header>
    <div className="home-promo-slide" aria-live={rotating ? 'off' : 'polite'} aria-atomic="true">
      <div className="home-promo-art">
        {current.key === 'sofia' ? <div className="home-promo-sofia">
          <SofiaAvatar /><span>AGENTE SOFÍA</span><strong>Tu secretaria clínica inteligente</strong><small>Más foco en tus pacientes</small>
        </div> : dental && current.key === 'attention' ? <DentalPromoFlyer interactive={false} /> : 'service' in current ? <PromotionalArtwork service={current.service} /> : null}
      </div>
      <div className="home-promo-copy">
        <h3>{title}</h3>
        <p>{dental && current.key === 'attention'
          ? 'Registrá hallazgos por pieza y superficie. Tratamientos, presupuestos, costos y pagos conectados al balance, con ficha completa en PDF a color.'
          : current.detail}</p>
        <span className="home-promo-brand">Dr Happy · Basta de papeleo. Hagamos medicina.</span>
      </div>
    </div>
    <nav className="home-promo-controls" aria-label="Recorrer funciones">
      <button type="button" className="ghost" aria-label="Flyer anterior" disabled={slides.length < 2} onClick={() => move(-1)}>←</button>
      <span>{index % slides.length + 1} / {slides.length}</span>
      <button type="button" className="ghost" aria-label="Flyer siguiente" disabled={slides.length < 2} onClick={() => move(1)}>→</button>
      {!reducedMotion && slides.length > 1 ? <button type="button" className="ghost home-promo-pause" aria-pressed={paused} onClick={() => setPaused(value => !value)}>
        {paused ? 'Reanudar' : 'Pausar'}
      </button> : null}
    </nav>
  </section>
}

export function HomePromoCarousel({ actions }: { actions: ReadonlyArray<PromoAction> }) {
  const [desktop, setDesktop] = useState(() => matchMedia('(min-width: 900px)').matches)
  useEffect(() => {
    const query = matchMedia('(min-width: 900px)')
    const update = () => setDesktop(query.matches)
    query.addEventListener('change', update)
    return () => query.removeEventListener('change', update)
  }, [])
  return desktop ? <PromoCarousel actions={actions} /> : null
}
