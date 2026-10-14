import { useCallback, useEffect, useMemo, useState } from 'react'
import MathDrill from './MathDrill'
import { WORD_CATEGORIES } from './memoryData'
import { shuffle } from './memoryCore'
import type { GameProps } from './memoryCore'
import { WORD_LEVELS } from './memoryLevels'

type Phase = 'study' | 'math' | 'recall' | 'review'

function buildRound(count: number) {
  const targets: string[] = []
  const traps: string[] = []
  const categories = shuffle(WORD_CATEGORIES)
  let index = 0
  while (targets.length < count) {
    const words = shuffle(categories[index % categories.length])
    const already = targets.filter((word) => categories[index % categories.length].includes(word)).length
    const fresh = words.filter((word) => !targets.includes(word) && !traps.includes(word))
    if (already < 2 && fresh.length >= 2) {
      targets.push(fresh[0])
      // La trampa es de la misma categoría: si estaba "manzana", aparece "pera".
      traps.push(fresh[1])
    }
    index++
  }
  return { targets, options: shuffle([...targets, ...traps]) }
}

export default function WordList({ level, onFinish }: GameProps) {
  const config = WORD_LEVELS[Math.min(level, WORD_LEVELS.length) - 1]
  const round = useMemo(() => buildRound(config.count), [config])
  const studySeconds = Math.round(config.count * config.perWord)
  const [phase, setPhase] = useState<Phase>('study')
  const [left, setLeft] = useState(studySeconds)
  const [chosen, setChosen] = useState<Set<string>>(() => new Set())
  const [math, setMath] = useState({ correct: 0, total: 0 })

  useEffect(() => {
    if (phase !== 'study') return
    const timer = window.setTimeout(() => (left <= 1 ? setPhase('math') : setLeft(left - 1)), 1000)
    return () => window.clearTimeout(timer)
  }, [phase, left])

  const finishMath = useCallback((correct: number, total: number) => {
    setMath({ correct, total })
    setPhase('recall')
  }, [])

  function toggle(word: string) {
    setChosen((current) => {
      const next = new Set(current)
      if (next.has(word)) next.delete(word)
      else next.add(word)
      return next
    })
  }

  const hits = round.targets.filter((word) => chosen.has(word)).length
  const falseAlarms = [...chosen].filter((word) => !round.targets.includes(word)).length

  function finish() {
    const n = round.targets.length
    const outcome = hits >= Math.ceil(n * 0.8) && falseAlarms <= 1 ? 'up' : hits < n * 0.5 || falseAlarms >= 3 ? 'down' : 'same'
    const mathText = math.total ? ` En las cuentas: ${math.correct} de ${math.total} bien.` : ''
    onFinish({ outcome, summary: `Recordaste ${hits} de ${n} palabras${falseAlarms ? ` y marcaste ${falseAlarms} que no estaban` : ' sin errores'}.${mathText}` })
  }

  if (phase === 'study') {
    return (
      <div className="mw-game">
        <p className="mw-hint">Memorizá estas <strong>{round.targets.length} palabras</strong>. Después te las vamos a preguntar.</p>
        <div className="mw-countdown"><span style={{ width: `${left / studySeconds * 100}%` }} /></div>
        <ul className="mw-word-study">
          {round.targets.map((word) => <li key={word}>{word}</li>)}
        </ul>
        <button type="button" className="pp-primary" onClick={() => setPhase('math')}>Ya las memoricé</button>
      </div>
    )
  }

  if (phase === 'math') return <MathDrill seconds={config.math} onDone={finishMath} />

  return (
    <div className="mw-game">
      <p className="mw-hint">
        {phase === 'recall'
          ? <>Tocá las palabras que <strong>estaban en la lista</strong>. Ojo: hay algunas parecidas.</>
          : <>✅ las que recordaste · 🟠 las que estaban y no marcaste · ❌ las que no estaban.</>}
      </p>
      <div className="mw-word-options">
        {round.options.map((word) => {
          const isTarget = round.targets.includes(word)
          const picked = chosen.has(word)
          const review = phase === 'review'
            ? picked && isTarget ? ' is-hit' : !picked && isTarget ? ' is-missed' : picked ? ' is-wrong' : ' is-dim'
            : picked ? ' is-picked' : ''
          return (
            <button key={word} type="button" className={`mw-word${review}`} disabled={phase === 'review'} onClick={() => toggle(word)}>
              {word}
            </button>
          )
        })}
      </div>
      {phase === 'recall'
        ? <button type="button" className="pp-primary" onClick={() => setPhase('review')}>Listo</button>
        : <button type="button" className="pp-primary" onClick={finish}>Ver resultado</button>}
    </div>
  )
}
