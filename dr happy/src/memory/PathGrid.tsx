import { useEffect, useRef, useState } from 'react'
import { randInt } from './memoryCore'
import type { GameProps } from './memoryCore'
import { PATH_LEVELS } from './memoryLevels'

const MAX_EXTRA = 6

function makeSequence(length: number, cells: number): number[] {
  const sequence: number[] = []
  while (sequence.length < length) {
    const cell = randInt(0, cells - 1)
    if (cell !== sequence[sequence.length - 1]) sequence.push(cell)
  }
  return sequence
}

type Phase = 'ready' | 'show' | 'input' | 'feedback'

export default function PathGrid({ level, onFinish }: GameProps) {
  const config = PATH_LEVELS[Math.min(level, PATH_LEVELS.length) - 1]
  const cells = config.size * config.size
  const [length, setLength] = useState(config.start)
  const [sequence, setSequence] = useState(() => makeSequence(config.start, cells))
  const [phase, setPhase] = useState<Phase>('ready')
  const [lit, setLit] = useState(-1)
  const [taps, setTaps] = useState<number[]>([])
  const [lives, setLives] = useState(2)
  const [best, setBest] = useState(0)
  const [message, setMessage] = useState('')
  const [tapFlash, setTapFlash] = useState<{ cell: number; ok: boolean } | null>(null)
  const finishedRef = useRef(false)

  useEffect(() => {
    if (phase !== 'show') return
    const timers: number[] = []
    sequence.forEach((cell, index) => {
      timers.push(window.setTimeout(() => setLit(cell), 500 + index * config.ms))
      timers.push(window.setTimeout(() => setLit(-1), 500 + index * config.ms + config.ms * 0.7))
    })
    timers.push(window.setTimeout(() => setPhase('input'), 500 + sequence.length * config.ms))
    return () => timers.forEach((timer) => window.clearTimeout(timer))
  }, [phase, sequence, config.ms])

  function end(bestLength: number) {
    if (finishedRef.current) return
    finishedRef.current = true
    const outcome = bestLength >= config.start + 3 ? 'up' : bestLength < config.start ? 'down' : 'same'
    onFinish({
      outcome,
      summary: bestLength
        ? `Repetiste caminos de hasta ${bestLength} casillas${config.reverse ? ' al revés' : ''}.`
        : 'Esta vez no salió ningún camino completo. ¡Es cuestión de práctica!',
    })
  }

  function nextRound(nextLength: number, text: string) {
    setMessage(text)
    setPhase('feedback')
    window.setTimeout(() => {
      setLength(nextLength)
      setSequence(makeSequence(nextLength, cells))
      setTaps([])
      setMessage('')
      setPhase('show')
    }, 1200)
  }

  function tap(cell: number) {
    if (phase !== 'input') return
    const expected = config.reverse ? sequence[sequence.length - 1 - taps.length] : sequence[taps.length]
    const ok = cell === expected
    setTapFlash({ cell, ok })
    window.setTimeout(() => setTapFlash(null), 250)
    if (!ok) {
      const remaining = lives - 1
      setLives(remaining)
      if (remaining <= 0) {
        setPhase('feedback')
        setMessage('Se terminaron los intentos.')
        window.setTimeout(() => end(best), 1200)
      } else {
        nextRound(length, 'Casi. Probemos otro camino del mismo largo.')
      }
      return
    }
    const next = [...taps, cell]
    setTaps(next)
    if (next.length < sequence.length) return
    setBest(length)
    if (length >= config.start + MAX_EXTRA) {
      setPhase('feedback')
      setMessage('¡Impresionante!')
      window.setTimeout(() => end(length), 1000)
      return
    }
    nextRound(length + 1, '¡Bien! Ahora uno más largo.')
  }

  return (
    <div className="mw-game">
      <p className="mw-hint">
        Mirá el orden en que se encienden las casillas y repetilo
        {config.reverse ? <> <strong>al revés</strong> (de la última a la primera)</> : null}.
      </p>
      <div className="mw-stats-bar">
        <span>Largo <strong>{length}</strong></span>
        <span>Mejor <strong>{best || '—'}</strong></span>
        <span>Intentos <strong>{'❤️'.repeat(lives)}{'🤍'.repeat(Math.max(0, 2 - lives))}</strong></span>
      </div>
      <div className="mw-path" style={{ gridTemplateColumns: `repeat(${config.size}, 1fr)` }}>
        {Array.from({ length: cells }, (_, cell) => {
          const flash = tapFlash?.cell === cell ? (tapFlash.ok ? ' is-ok' : ' is-bad') : ''
          return (
            <button
              key={cell}
              type="button"
              className={`mw-path-cell${lit === cell ? ' is-lit' : ''}${flash}`}
              disabled={phase !== 'input'}
              aria-label={`Casilla ${cell + 1}`}
              onClick={() => tap(cell)}
            />
          )
        })}
      </div>
      <p className="mw-path-status">
        {phase === 'ready' ? '' : phase === 'show' ? 'Mirá con atención…' : phase === 'input' ? `Tu turno: ${taps.length} de ${sequence.length}` : message}
      </p>
      {phase === 'ready' && <button type="button" className="pp-primary" onClick={() => setPhase('show')}>Empezar</button>}
    </div>
  )
}
