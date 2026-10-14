import { useEffect, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import { randInt } from './memoryCore'

interface Problem { text: string; answer: number }

function makeProblem(): Problem {
  const kind = randInt(0, 2)
  if (kind === 0) {
    const a = randInt(12, 68), b = randInt(3, 29)
    return { text: `${a} + ${b}`, answer: a + b }
  }
  if (kind === 1) {
    const a = randInt(25, 90), b = randInt(3, 19)
    return { text: `${a} − ${b}`, answer: a - b }
  }
  const a = randInt(3, 9), b = randInt(3, 9)
  return { text: `${a} × ${b}`, answer: a * b }
}

// Cuentas rápidas que sirven de distracción entre memorizar y recordar.
export default function MathDrill({ seconds, onDone }: { seconds: number; onDone: (correct: number, total: number) => void }) {
  const [problem, setProblem] = useState(makeProblem)
  const [value, setValue] = useState('')
  const [left, setLeft] = useState(seconds)
  const [score, setScore] = useState({ correct: 0, total: 0 })
  const [flash, setFlash] = useState<'' | 'ok' | 'bad'>('')
  const scoreRef = useRef(score)
  const doneRef = useRef(false)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    const timer = window.setInterval(() => setLeft((current) => current - 1), 1000)
    return () => window.clearInterval(timer)
  }, [])

  useEffect(() => {
    if (left > 0 || doneRef.current) return
    doneRef.current = true
    onDone(scoreRef.current.correct, scoreRef.current.total)
  }, [left, onDone])

  function submit(event: FormEvent) {
    event.preventDefault()
    if (!value.trim()) return
    const ok = Number(value) === problem.answer
    const nextScore = { correct: score.correct + (ok ? 1 : 0), total: score.total + 1 }
    scoreRef.current = nextScore
    setScore(nextScore)
    setFlash(ok ? 'ok' : 'bad')
    window.setTimeout(() => setFlash(''), 400)
    setProblem(makeProblem())
    setValue('')
    inputRef.current?.focus()
  }

  return (
    <div className="mw-math">
      <p className="mw-hint">Ahora, unas cuentas para distraerte. Resolvé todas las que puedas.</p>
      <div className="mw-countdown"><span style={{ width: `${Math.max(0, left) / seconds * 100}%` }} /></div>
      <form onSubmit={submit} className={`mw-math-form${flash ? ` is-${flash}` : ''}`}>
        <span className="mw-math-problem">{problem.text} =</span>
        <input ref={inputRef} autoFocus inputMode="numeric" pattern="[0-9]*" value={value} onChange={(e) => setValue(e.target.value.replace(/\D/g, '').slice(0, 4))} aria-label="Resultado" />
        <button type="submit" className="pp-primary">OK</button>
      </form>
      <p className="pp-muted">Correctas: {score.correct} de {score.total} · quedan {Math.max(0, left)} s</p>
    </div>
  )
}
