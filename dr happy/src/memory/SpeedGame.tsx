import { useEffect, useState } from 'react'
import { pick, randInt, shuffle } from './memoryCore'
import type { GameProps } from './memoryCore'
import { SPEED_LEVELS } from './memoryLevels'

const CENTER_OPTIONS = [
  { emoji: '🚗', name: 'Auto' },
  { emoji: '🚚', name: 'Camión' },
  { emoji: '🚲', name: 'Bici' },
  { emoji: '🚌', name: 'Colectivo' },
]

// Las 8 posiciones donde puede aparecer la estrella, en un tablero de 5×5.
const TARGET_SLOTS = [0, 2, 4, 10, 14, 20, 22, 24]
const RING = [0, 1, 2, 3, 4, 5, 9, 10, 14, 15, 19, 20, 21, 22, 23, 24]
const CENTER = 12
const TRIALS = 10
const MIN_MS = 120
const MAX_MS = 1500

type Phase = 'intro' | 'ready' | 'show' | 'mask' | 'center' | 'where' | 'feedback'

interface Trial {
  center: number
  target: number
  distractors: number[]
}

function newTrial(options: number, distractors: boolean): Trial {
  const target = pick(TARGET_SLOTS)
  return {
    center: randInt(0, options - 1),
    target,
    distractors: distractors ? shuffle(RING.filter((cell) => cell !== target)).slice(0, 7) : [],
  }
}

export default function SpeedGame({ level, onFinish }: GameProps) {
  const config = SPEED_LEVELS[Math.min(level, SPEED_LEVELS.length) - 1]
  const options = CENTER_OPTIONS.slice(0, config.options)
  const [phase, setPhase] = useState<Phase>('intro')
  const [ms, setMs] = useState(config.ms)
  const [trial, setTrial] = useState(() => newTrial(config.options, config.distractors))
  const [index, setIndex] = useState(0)
  const [centerOk, setCenterOk] = useState(false)
  const [lastOk, setLastOk] = useState(false)
  const [correct, setCorrect] = useState(0)
  const [best, setBest] = useState<number | null>(null)

  useEffect(() => {
    let timer: number | undefined
    if (phase === 'ready') timer = window.setTimeout(() => setPhase('show'), 700)
    if (phase === 'show') timer = window.setTimeout(() => setPhase('mask'), ms)
    if (phase === 'mask') timer = window.setTimeout(() => setPhase('center'), 350)
    if (phase === 'feedback') {
      timer = window.setTimeout(() => {
        if (index + 1 >= TRIALS) return
        setIndex(index + 1)
        setTrial(newTrial(config.options, config.distractors))
        setPhase('ready')
      }, 1100)
    }
    return () => window.clearTimeout(timer)
  }, [phase, ms, index, config])

  function answerCenter(choice: number) {
    setCenterOk(choice === trial.center)
    setPhase('where')
  }

  function answerWhere(cell: number) {
    if (!TARGET_SLOTS.includes(cell)) return
    const ok = centerOk && cell === trial.target
    setLastOk(ok)
    const nextCorrect = correct + (ok ? 1 : 0)
    setCorrect(nextCorrect)
    const nextBest = ok ? Math.min(best ?? ms, ms) : best
    if (ok) setBest(nextBest)
    setMs(Math.round(Math.min(MAX_MS, Math.max(MIN_MS, ok ? ms * 0.85 : ms * 1.2))))
    setPhase('feedback')
    if (index + 1 >= TRIALS) {
      window.setTimeout(() => {
        const outcome = nextCorrect >= 8 ? 'up' : nextCorrect < 5 ? 'down' : 'same'
        const bestText = nextBest ? ` Tu mejor tiempo: ${nextBest} milésimas de segundo.` : ''
        onFinish({ outcome, summary: `Acertaste ${nextCorrect} de ${TRIALS}.${bestText}` })
      }, 1100)
    }
  }

  if (phase === 'intro') {
    return (
      <div className="mw-game">
        <p className="mw-hint">Vas a ver <strong>por un instante</strong> un vehículo en el centro y una ⭐ en el borde.</p>
        <p className="mw-hint">Después te preguntamos <strong>qué vehículo era</strong> y <strong>dónde estaba la estrella</strong>. Cada vez que acertás, se muestra más rápido.</p>
        <div className="mw-speed-legend">
          {options.map((option) => <span key={option.name}>{option.emoji} {option.name}</span>)}
        </div>
        {config.distractors && <p className="pp-muted">En este nivel aparecen 🔸 para distraerte: ignoralos.</p>}
        <button type="button" className="pp-primary" onClick={() => setPhase('ready')}>Empezar</button>
      </div>
    )
  }

  const showing = phase === 'show'
  const masked = phase === 'mask'
  const choosingWhere = phase === 'where'
  const feedback = phase === 'feedback'

  return (
    <div className="mw-game">
      <div className="mw-stats-bar">
        <span>Prueba <strong>{index + 1}/{TRIALS}</strong></span>
        <span>Aciertos <strong>{correct}</strong></span>
        <span>Velocidad <strong>{ms} ms</strong></span>
      </div>

      <p className="mw-hint mw-speed-question">
        {phase === 'ready' && 'Mirá el centro…'}
        {(showing || masked) && '\u00a0'}
        {phase === 'center' && '¿Qué vehículo había en el centro?'}
        {choosingWhere && 'Tocá dónde estaba la ⭐'}
        {feedback && (lastOk ? '✅ ¡Muy bien!' : '❌ Esta vez no')}
      </p>

      <div className={`mw-speed-board${masked ? ' is-mask' : ''}`}>
        {Array.from({ length: 25 }, (_, cell) => {
          let content = ''
          if (showing) {
            if (cell === CENTER) content = options[trial.center].emoji
            else if (cell === trial.target) content = '⭐'
            else if (trial.distractors.includes(cell)) content = '🔸'
          } else if (masked) {
            content = cell % 2 ? '▦' : '▩'
          } else if (phase === 'ready' && cell === CENTER) {
            content = '+'
          } else if (feedback && cell === trial.target) {
            content = '⭐'
          }
          const slot = choosingWhere && TARGET_SLOTS.includes(cell)
          return (
            <button
              key={cell}
              type="button"
              className={`mw-speed-cell${slot ? ' is-slot' : ''}${feedback && cell === trial.target ? ' is-target' : ''}`}
              disabled={!slot}
              onClick={() => answerWhere(cell)}
              aria-label={slot ? 'Posición posible de la estrella' : undefined}
            >
              {content}
            </button>
          )
        })}
      </div>

      {phase === 'center' && (
        <div className="mw-speed-options">
          {options.map((option, choice) => (
            <button key={option.name} type="button" onClick={() => answerCenter(choice)}>
              <span>{option.emoji}</span>{option.name}
            </button>
          ))}
        </div>
      )}
      {feedback && !lastOk && <p className="pp-muted mw-center-text">Era {options[trial.center].emoji} {options[trial.center].name}{centerOk ? '; lo que falló fue la posición de la estrella' : ''}.</p>}
    </div>
  )
}
