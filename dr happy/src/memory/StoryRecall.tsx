import { useCallback, useEffect, useMemo, useState } from 'react'
import MathDrill from './MathDrill'
import { pick, shuffle } from './memoryCore'
import type { GameProps } from './memoryCore'
import { STORY_LEVELS } from './memoryLevels'
import { STORIES } from './memoryStories'

type Phase = 'read' | 'math' | 'quiz' | 'review'

export default function StoryRecall({ level, onFinish }: GameProps) {
  const config = STORY_LEVELS[Math.min(level, STORY_LEVELS.length) - 1]
  const story = useMemo(() => pick(STORIES), [])
  const questions = useMemo(() => shuffle(story.questions).slice(0, config.questions).map((question) => ({
    ...question,
    options: shuffle([question.answer, ...question.wrong]),
  })), [story, config])
  const [phase, setPhase] = useState<Phase>('read')
  const [left, setLeft] = useState(config.readSeconds)
  const [current, setCurrent] = useState(0)
  const [answers, setAnswers] = useState<string[]>([])
  const [math, setMath] = useState({ correct: 0, total: 0 })

  const afterReading = useCallback(() => setPhase(config.math ? 'math' : 'quiz'), [config])

  useEffect(() => {
    if (phase !== 'read' || !config.readSeconds) return
    const timer = window.setTimeout(() => (left <= 1 ? afterReading() : setLeft(left - 1)), 1000)
    return () => window.clearTimeout(timer)
  }, [phase, left, config, afterReading])

  const finishMath = useCallback((correct: number, total: number) => {
    setMath({ correct, total })
    setPhase('quiz')
  }, [])

  function answer(option: string) {
    const next = [...answers, option]
    setAnswers(next)
    if (next.length >= questions.length) setPhase('review')
    else setCurrent(current + 1)
  }

  if (phase === 'read') {
    return (
      <div className="mw-game">
        <p className="mw-hint">Leé con atención esta historia. Después te vamos a hacer preguntas <strong>sin poder volver a leerla</strong>.</p>
        {config.readSeconds > 0 && <div className="mw-countdown"><span style={{ width: `${left / config.readSeconds * 100}%` }} /></div>}
        <article className="mw-story">
          <h3>{story.title}</h3>
          <p>{story.text}</p>
        </article>
        <button type="button" className="pp-primary" onClick={afterReading}>Ya la leí</button>
      </div>
    )
  }

  if (phase === 'math') return <MathDrill seconds={config.math} onDone={finishMath} />

  if (phase === 'quiz') {
    const question = questions[current]
    return (
      <div className="mw-game">
        <div className="mw-stats-bar"><span>Pregunta <strong>{current + 1}/{questions.length}</strong></span><span>{story.title}</span></div>
        <p className="mw-hint mw-story-q">{question.q}</p>
        <div className="mw-story-options">
          {question.options.map((option) => <button key={option} type="button" onClick={() => answer(option)}>{option}</button>)}
        </div>
      </div>
    )
  }

  const correct = questions.filter((question, index) => answers[index] === question.answer).length
  function finish() {
    const n = questions.length
    const outcome = correct === n || (correct >= n - 1 && n >= 6) ? 'up' : correct < n / 2 ? 'down' : 'same'
    const mathText = math.total ? ` En las cuentas: ${math.correct} de ${math.total} bien.` : ''
    onFinish({ outcome, summary: `Recordaste ${correct} de ${n} detalles de "${story.title}".${mathText}` })
  }

  return (
    <div className="mw-game">
      <p className={`mw-verdict ${correct >= questions.length - 1 ? 'is-ok' : 'is-bad'}`}>{correct} de {questions.length} respuestas correctas</p>
      <ul className="mw-story-review">
        {questions.map((question, index) => {
          const ok = answers[index] === question.answer
          return (
            <li key={question.q} className={ok ? 'is-ok' : 'is-bad'}>
              <span>{ok ? '✅' : '❌'} {question.q}</span>
              <strong>{question.answer}{ok ? '' : ` (pusiste: ${answers[index]})`}</strong>
            </li>
          )
        })}
      </ul>
      <details className="mw-story-again">
        <summary>Volver a leer la historia</summary>
        <p>{story.text}</p>
      </details>
      <button type="button" className="pp-primary" onClick={finish}>Ver resultado</button>
    </div>
  )
}
