import { useEffect, useMemo, useRef, useState } from 'react'
import { CARD_EMOJIS, RELATED_PAIRS } from './memoryData'
import { formatSeconds, shuffle } from './memoryCore'
import type { GameProps } from './memoryCore'
import { CARD_LEVELS } from './memoryLevels'

interface Card { key: number; face: string }

function buildDeck(pairs: number, related: boolean): Card[] {
  if (related) {
    return shuffle(shuffle(RELATED_PAIRS).slice(0, pairs).flatMap(([a, b], key) => [{ key, face: a }, { key, face: b }]))
  }
  return shuffle(shuffle(CARD_EMOJIS).slice(0, pairs).flatMap((face, key) => [{ key, face }, { key, face }]))
}

export default function MemoryCards({ level, onFinish }: GameProps) {
  const config = CARD_LEVELS[Math.min(level, CARD_LEVELS.length) - 1]
  const deck = useMemo(() => buildDeck(config.pairs, config.related), [config])
  const [open, setOpen] = useState<number[]>([])
  const [matched, setMatched] = useState<Set<number>>(() => new Set())
  const [attempts, setAttempts] = useState(0)
  const [startedAt, setStartedAt] = useState(0)
  const [seconds, setSeconds] = useState(0)
  const finished = matched.size === config.pairs
  const lock = useRef(false)

  useEffect(() => {
    if (!startedAt || finished) return
    const timer = window.setInterval(() => setSeconds(Math.round((Date.now() - startedAt) / 1000)), 1000)
    return () => window.clearInterval(timer)
  }, [startedAt, finished])

  useEffect(() => {
    if (!finished) return
    const total = Math.round((Date.now() - startedAt) / 1000)
    const ratio = attempts / config.pairs
    const outcome = ratio <= (config.related ? 2.2 : 1.9) ? 'up' : ratio > (config.related ? 3.6 : 3.2) ? 'down' : 'same'
    const timer = window.setTimeout(() => onFinish({ outcome, summary: `Encontraste las ${config.pairs} parejas en ${attempts} intentos y ${formatSeconds(total)}.` }), 700)
    return () => window.clearTimeout(timer)
    // Solo al terminar el tablero.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [finished])

  function flip(index: number) {
    if (lock.current || finished || open.includes(index) || matched.has(deck[index].key)) return
    if (!startedAt) setStartedAt(Date.now())
    const next = [...open, index]
    if (next.length < 2) return setOpen(next)
    setAttempts((value) => value + 1)
    const [a, b] = next
    if (deck[a].key === deck[b].key) {
      setMatched((current) => new Set(current).add(deck[a].key))
      setOpen([])
      return
    }
    setOpen(next)
    lock.current = true
    window.setTimeout(() => { setOpen([]); lock.current = false }, 1000)
  }

  return (
    <div className="mw-game">
      <p className="mw-hint">
        {config.related
          ? <>Las parejas son cosas <strong>que van juntas</strong> (por ejemplo 🔑 con 🚪).</>
          : <>Encontrá las parejas de dibujos iguales.</>}
      </p>
      <div className="mw-stats-bar">
        <span>Parejas <strong>{matched.size}/{config.pairs}</strong></span>
        <span>Intentos <strong>{attempts}</strong></span>
        <span>⏱ <strong>{formatSeconds(seconds)}</strong></span>
      </div>
      <div className="mw-cards" style={{ gridTemplateColumns: `repeat(${config.cols}, 1fr)` }}>
        {deck.map((card, index) => {
          const up = open.includes(index) || matched.has(card.key)
          return (
            <button
              key={index}
              type="button"
              className={`mw-card${up ? ' is-up' : ''}${matched.has(card.key) ? ' is-matched' : ''}`}
              aria-label={up ? card.face : 'Ficha boca abajo'}
              onClick={() => flip(index)}
            >
              <span className="mw-card-inner">
                <span className="mw-card-back"><img src="/brand-mark.svg" alt="" /></span>
                <span className="mw-card-face">{card.face}</span>
              </span>
            </button>
          )
        })}
      </div>
    </div>
  )
}
