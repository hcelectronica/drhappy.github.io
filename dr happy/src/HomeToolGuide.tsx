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
            <span className="section-kicker">Mini tutorial</span>
            <h2 id={titleId}>{slide.label}</h2>
          </div>
          <button type="button" className="ghost" onClick={onClose} aria-label="Cerrar mini tutorial" autoFocus>Cerrar</button>
        </header>
        <p className="home-tutorial-summary" id={summaryId}>{slide.tutorial.summary}</p>
        <figure>
          <img src={homeToolTutorialImage(slide.tutorial.image)} alt={`Captura de ${slide.label} con datos de ejemplo`} />
          <figcaption>Pantalla de ejemplo. Los datos son ficticios.</figcaption>
        </figure>
      </div>
    </dialog>
  )
}

export function HomeToolGuide({ actions }: {
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
            <img src={homeToolTutorialImage(current.tutorial.image)} alt="" />
          </span>
          <span className="home-tool-flyer-copy">
            <span className="home-tool-guide-icon" aria-hidden="true">{current.icon}</span>
            <strong>{current.label}</strong>
            <span>Conocé cómo se usa, paso a paso.</span>
            <span className="home-tool-flyer-hint">Ver mini tutorial</span>
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
