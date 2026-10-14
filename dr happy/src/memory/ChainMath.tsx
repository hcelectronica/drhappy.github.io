import { useEffect, useMemo, useState } from 'react'
import type { FormEvent } from 'react'
import { pick, randInt } from './memoryCore'
import type { GameProps } from './memoryCore'
import { CHAIN_LEVELS } from './memoryLevels'

interface Step { label: string; value: number }

function buildChain(level: number, steps: number): Step[] {
  let value = randInt(3, 12)
  const chain: Step[] = [{ label: `Empezá en ${value}`, value }]
  while (chain.length <= steps) {
    const options: (() => Step | null)[] = [
      () => { const n = randInt(2, level >= 4 ? 15 : 9); return { label: `+ ${n}`, value: value + n } },
      () => { const n = randInt(2, level >= 4 ? 15 : 9); return value - n >= 1 ? { label: `− ${n}`, value: value - n } : null },
    ]
    if (level >= 2) options.push(() => { const m = pick([2, 3]); return value * m <= 60 ? { label: `× ${m}`, value: value * m } : null })
    if (level >= 3) options.push(() => { const d = pick([2, 3]); return value % d === 0 && value / d >= 2 ? { label: `÷ ${d}`, value: value / d } : null })
    const step = pick(options)()
    if (!step) continue
    chain.push(step)
    value = step.value
  }
  return chain
}

type Mode = 'menu' | 'chain' | 'sevens'

export default function ChainMath({ level, onFinish }: GameProps) {
  const [mode, setMode] = useState<Mode>('menu')
  if (mode === 'chain') return <Chain level={level} onFinish={onFinish} />
  if (mode === 'sevens') return <Sevens onFinish={onFinish} />
  return (
    <div className="mw-game">
      <p className="mw-hint">Elegí el ejercicio. Los números aparecen de a uno y desaparecen: tenés que llevar la cuenta de memoria.</p>
      <div className="mw-mode-list">
        <button type="button" className="mw-mode" onClick={() => setMode('chain')}>
          <strong>➕ Cuenta encadenada</strong>
          <span>{CHAIN_LEVELS[Math.min(level, CHAIN_LEVELS.length) - 1].steps} operaciones seguidas · nivel {level}</span>
        </button>
        <button type="button" className="mw-mode" onClick={() => setMode('sevens')}>
          <strong>➖ Restar de a 7 desde 100</strong>
          <span>5 restas seguidas sin ver las anteriores</span>
        </button>
      </div>
    </div>
  )
}

function Chain({ level, onFinish }: GameProps) {
  const config = CHAIN_LEVELS[Math.min(level, CHAIN_LEVELS.length) - 1]
  const chain = useMemo(() => buildChain(level, config.steps), [level, config])
  const [shown, setShown] = useState(-1)
  const [answer, setAnswer] = useState('')
  const [submitted, setSubmitted] = useState(false)
  const result = chain[chain.length - 1].value
  const asking = shown >= chain.length

  useEffect(() => {
    if (asking) return
    const timer = window.setTimeout(() => setShown((value) => value + 1), shown < 0 ? 900 : config.ms)
    return () => window.clearTimeout(timer)
  }, [shown, asking, config.ms])

  function submit(event: FormEvent) {
    event.preventDefault()
    if (answer.trim()) setSubmitted(true)
  }

  if (!asking) {
    return (
      <div className="mw-game">
        <p className="mw-hint">Hacé la cuenta mentalmente, paso a paso.</p>
        <div className="mw-chain-step" key={shown}>{shown < 0 ? '¿Listo?' : chain[shown].label}</div>
        <div className="mw-dots">{chain.map((_, index) => <span key={index} className={index <= shown ? 'is-on' : ''} />)}</div>
      </div>
    )
  }

  const correct = Number(answer) === result
  return (
    <div className="mw-game">
      {!submitted ? (
        <form className="mw-answer" onSubmit={submit}>
          <label htmlFor="mw-chain-answer">¿Cuál es el resultado?</label>
          <input id="mw-chain-answer" autoFocus inputMode="numeric" pattern="[0-9]*" value={answer} onChange={(e) => setAnswer(e.target.value.replace(/\D/g, '').slice(0, 4))} />
          <button type="submit" className="pp-primary">Responder</button>
        </form>
      ) : (
        <>
          <p className={`mw-verdict ${correct ? 'is-ok' : 'is-bad'}`}>{correct ? `¡Exacto! Era ${result}.` : `Era ${result}. Respondiste ${answer}.`}</p>
          <ol className="mw-chain-review">
            {chain.map((step, index) => <li key={index}><span>{step.label}</span><strong>{index ? `= ${step.value}` : ''}</strong></li>)}
          </ol>
          <button type="button" className="pp-primary" onClick={() => onFinish({
            outcome: correct ? 'up' : 'down',
            summary: correct ? `Resolviste una cadena de ${config.steps} operaciones sin ayuda.` : `La cadena tenía ${config.steps} operaciones. Revisá en qué paso se cruzó la cuenta.`,
          })}>Continuar</button>
        </>
      )}
    </div>
  )
}

function Sevens({ onFinish }: Pick<GameProps, 'onFinish'>) {
  const [answers, setAnswers] = useState<number[]>([])
  const [value, setValue] = useState('')
  const done = answers.length >= 5

  function submit(event: FormEvent) {
    event.preventDefault()
    if (!value.trim()) return
    setAnswers((current) => [...current, Number(value)])
    setValue('')
  }

  // Cada resta se evalúa contra la respuesta anterior, como en los tests de consultorio.
  const marks = answers.map((answer, index) => answer === (index ? answers[index - 1] : 100) - 7)
  const good = marks.filter(Boolean).length

  if (!done) {
    return (
      <div className="mw-game">
        <p className="mw-hint">{answers.length ? 'Seguí restando 7 al último número que dijiste.' : 'Empezá en 100 y restá 7.'}</p>
        <div className="mw-chain-step">{answers.length ? '− 7' : '100 − 7'}</div>
        <div className="mw-dots">{[0, 1, 2, 3, 4].map((index) => <span key={index} className={index < answers.length ? 'is-on' : ''} />)}</div>
        <form className="mw-answer" onSubmit={submit}>
          <input key={answers.length} autoFocus inputMode="numeric" pattern="[0-9]*" value={value} onChange={(e) => setValue(e.target.value.replace(/\D/g, '').slice(0, 3))} aria-label="Resultado" />
          <button type="submit" className="pp-primary">OK</button>
        </form>
      </div>
    )
  }

  return (
    <div className="mw-game">
      <p className={`mw-verdict ${good === 5 ? 'is-ok' : 'is-bad'}`}>{good} de 5 restas correctas</p>
      <ol className="mw-chain-review">
        {answers.map((answer, index) => (
          <li key={index}><span>{index ? answers[index - 1] : 100} − 7</span><strong>{marks[index] ? '✅' : '❌'} {answer}</strong></li>
        ))}
      </ol>
      <button type="button" className="pp-primary" onClick={() => onFinish({ outcome: 'same', summary: `Restando de a 7 desde 100: ${good} de 5 correctas.` })}>Continuar</button>
    </div>
  )
}
