import { useEffect, useId, useRef, useState } from 'react'
import type { MobileHomeAction } from './MobileHomeMenu'
import { getHomeToolTutorial, homeToolTutorialImage } from './homeToolTutorials'
import type { HomeToolTutorial } from './homeToolTutorials'
import './homeToolGuide.css'

type GuideAction = Pick<MobileHomeAction, 'key' | 'icon' | 'label'>
type GuideSlide = GuideAction & { tutorial: HomeToolTutorial }

function TutorialDialog({ slide, onClose }: { slide: GuideSlide; onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null)
  const titleId = useId()
  const summaryId = useId()
  const [stepIndex, setStepIndex] = useState(0)
  const step = slide.tutorial.steps[stepIndex]
  useEffect(() => {
    const element = dialog.current
    const previous = document.activeElement
    element?.showModal()
    const overflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      element?.close()
      document.body.style.overflow = overflow
      if (previous instanceof HTMLElement && previous.isConnected) previous.focus()
    }
  }, [])

  return (
    <dialog ref={dialog} className="home-tutorial-dialog" aria-labelledby={titleId} aria-describedby={summaryId}
      onCancel={(event) => { event.preventDefault(); onClose() }}
      onClick={(event) => { if (event.target === event.currentTarget) onClose() }}>
      <div className="home-tutorial-content">
        <header>
          <div>
            <span className="section-kicker">Tu próxima tarea, más simple</span>
            <h2 id={titleId}>{slide.label}</h2>
          </div>
          <button type="button" className="ghost" onClick={onClose} aria-label="Cerrar mini tutorial" autoFocus>Cerrar</button>
        </header>
        <ol className="home-tutorial-stepper" aria-label="Pasos del tutorial">
          {slide.tutorial.steps.map((item, index) => (
            <li key={item.title}>
              <button type="button" aria-current={index === stepIndex ? 'step' : undefined}
                onClick={() => setStepIndex(index)}>
                <span>{index + 1}</span>{item.title}
              </button>
            </li>
          ))}
        </ol>
        <div className="home-tutorial-step-copy" aria-live="polite" aria-atomic="true">
          <h3><span>{stepIndex + 1}</span>{step.title}</h3>
          <p className="home-tutorial-summary" id={summaryId}>{step.summary}</p>
        </div>
        <figure className="home-tutorial-step-image">
          <img key={stepIndex} src={homeToolTutorialImage(slide.tutorial.image, stepIndex)}
            alt={`Paso ${stepIndex + 1}: ${step.title}. Zona de ${slide.label} resaltada con datos ficticios.`} />
          <figcaption>Vista ampliada · Seguí el recuadro numerado · Datos ficticios</figcaption>
        </figure>
        <nav className="home-tutorial-step-controls" aria-label="Navegación de pasos">
          <button type="button" className="ghost" disabled={stepIndex === 0} onClick={() => setStepIndex(stepIndex - 1)}>← Atrás</button>
          <span aria-live="polite">Paso {stepIndex + 1} de 3</span>
          {stepIndex < 2
            ? <button type="button" onClick={() => setStepIndex(stepIndex + 1)}>Siguiente paso →</button>
            : <button type="button" onClick={onClose}>Entendido ✓</button>}
        </nav>
      </div>
    </dialog>
  )
}

function GuideCarousel({ actions }: {
  actions: ReadonlyArray<GuideAction>
}) {
  const slides = actions.flatMap((action) => {
    const tutorial = getHomeToolTutorial(action.key, action.label)
    return tutorial ? [{ ...action, tutorial }] : []
  })
  const [currentKey, setCurrentKey] = useState<string | null>(null)
  const [openedKey, setOpenedKey] = useState<string | null>(null)
  const titleId = useId()
  const index = Math.max(0, slides.findIndex((slide) => slide.key === currentKey))
  const current = slides[index]
  const opened = slides.find((slide) => slide.key === openedKey)
  if (!current) return null
  const move = (direction: number) => setCurrentKey(slides[(index + direction + slides.length) % slides.length].key)

  return (
    <section className="home-tool-guide" aria-labelledby={titleId} aria-roledescription="carrusel">
      <header>
        <span className="section-kicker">Conocé Dr Happy</span>
        <h2 id={titleId}>Cómo usar tus herramientas</h2>
        <p>Recorré los flyers con las flechas y tocá uno para ver su mini tutorial.</p>
      </header>
      <div className="home-tool-carousel">
        <button type="button" className="home-tool-flyer" aria-label={`Ver mini tutorial de ${current.label}`}
          aria-haspopup="dialog" onClick={() => setOpenedKey(current.key)}>
          <span className="home-tool-flyer-preview">
            <span className="home-tool-preview-badge">DR HAPPY · GUÍA VISUAL</span>
            <img src={homeToolTutorialImage(current.tutorial.image)} alt="" decoding="async" />
            <span className="home-tool-preview-caption"><span aria-hidden="true">① ② ③</span> Tres pasos para empezar</span>
          </span>
          <span className="home-tool-flyer-copy">
            <span className="home-tool-guide-icon" aria-hidden="true">{current.icon}</span>
            <span className="home-tool-flyer-label">{current.label}</span>
            <strong>{current.tutorial.benefit}</strong>
            <span>{current.tutorial.promise}</span>
            <span className="home-tool-flyer-hint">Mirá cómo se usa en 3 pasos <span aria-hidden="true">↗</span></span>
          </span>
        </button>
        <nav className="home-tool-carousel-controls" aria-label="Recorrer mini tutoriales">
          <button type="button" className="ghost" onClick={() => move(-1)} disabled={slides.length < 2} aria-label="Tutorial anterior">← Anterior</button>
          <span aria-live="polite" aria-atomic="true">{index + 1} / {slides.length}<span className="home-tool-carousel-name"> · {current.label}</span></span>
          <button type="button" className="ghost" onClick={() => move(1)} disabled={slides.length < 2} aria-label="Tutorial siguiente">Siguiente →</button>
        </nav>
      </div>
      {opened ? <TutorialDialog slide={opened} onClose={() => setOpenedKey(null)} /> : null}
    </section>
  )
}

export function HomeToolGuide({ actions }: { actions: ReadonlyArray<GuideAction> }) {
  const [desktop, setDesktop] = useState(() => matchMedia('(min-width: 900px)').matches)
  useEffect(() => {
    const query = matchMedia('(min-width: 900px)')
    const update = () => setDesktop(query.matches)
    query.addEventListener('change', update)
    return () => query.removeEventListener('change', update)
  }, [])
  return desktop ? <GuideCarousel actions={actions} /> : null
}
