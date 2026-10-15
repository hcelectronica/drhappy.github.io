import { useEffect, useState } from 'react'
import type { ComponentType } from 'react'
import MemoryCards from './MemoryCards'
import WordList from './WordList'
import ChainMath from './ChainMath'
import PathGrid from './PathGrid'
import WordSearch from './WordSearch'
import Crossword from './Crossword'
import SpeedGame from './SpeedGame'
import Fluency from './Fluency'
import StoryRecall from './StoryRecall'
import ShopMath from './ShopMath'
import { currentStreak, dayKey, gameStats, loadWorkshop, recordPlay } from './memoryCore'
import type { GameId, GameProps, GameResult } from './memoryCore'
import { CARD_LEVELS, CHAIN_LEVELS, CROSSWORD_LEVELS, FLUENCY_LEVELS, PATH_LEVELS, SEARCH_LEVELS, SHOP_LEVELS, SPEED_LEVELS, STORY_LEVELS, WORD_LEVELS } from './memoryLevels'
import './MemoryWorkshop.css'

type Area = 'memory' | 'attention' | 'language' | 'math'

const AREAS: { id: Area; title: string; note: string }[] = [
  { id: 'memory', title: '🧠 Memoria', note: 'Recordar listas, imágenes, historias y recorridos' },
  { id: 'attention', title: '⚡ Atención y velocidad', note: 'Mirar rápido y encontrar lo importante' },
  { id: 'language', title: '🗣️ Lenguaje', note: 'Encontrar las palabras justas' },
  { id: 'math', title: '➗ Cálculo', note: 'Cuentas de todos los días' },
]

interface GameMeta {
  id: GameId
  emoji: string
  title: string
  skill: string
  area: Area
  levels: number
  component: ComponentType<GameProps>
}

const GAMES: GameMeta[] = [
  { id: 'cards', emoji: '🃏', title: 'Fichas de memoria', skill: 'Memoria visual', area: 'memory', levels: CARD_LEVELS.length, component: MemoryCards },
  { id: 'words', emoji: '📝', title: 'Lista para recordar', skill: 'Memoria verbal', area: 'memory', levels: WORD_LEVELS.length, component: WordList },
  { id: 'story', emoji: '📖', title: 'Historias para recordar', skill: 'Memoria de relatos', area: 'memory', levels: STORY_LEVELS.length, component: StoryRecall },
  { id: 'path', emoji: '🔷', title: 'Seguí el camino', skill: 'Memoria de secuencias', area: 'memory', levels: PATH_LEVELS.length, component: PathGrid },
  { id: 'speed', emoji: '👁️', title: 'Ojo rápido', skill: 'Velocidad de atención', area: 'attention', levels: SPEED_LEVELS.length, component: SpeedGame },
  { id: 'search', emoji: '🔤', title: 'Sopa de letras', skill: 'Atención visual', area: 'attention', levels: SEARCH_LEVELS.length, component: WordSearch },
  { id: 'crossword', emoji: '✏️', title: 'Crucigrama', skill: 'Vocabulario y memoria', area: 'language', levels: CROSSWORD_LEVELS.length, component: Crossword },
  { id: 'fluency', emoji: '💬', title: 'Palabras al vuelo', skill: 'Fluidez verbal', area: 'language', levels: FLUENCY_LEVELS.length, component: Fluency },
  { id: 'chain', emoji: '➕', title: 'Cuenta encadenada', skill: 'Cálculo mental', area: 'math', levels: CHAIN_LEVELS.length, component: ChainMath },
  { id: 'shop', emoji: '🛒', title: 'Hacer los mandados', skill: 'Cuentas con plata', area: 'math', levels: SHOP_LEVELS.length, component: ShopMath },
]
function dailyGame(): GameMeta {
  const start = new Date(new Date().getFullYear(), 0, 0).getTime()
  const day = Math.floor((Date.now() - start) / 86_400_000)
  return GAMES[day % GAMES.length]
}

interface Finished {
  game: GameMeta
  result: GameResult
  before: number
  after: number
}

export default function MemoryWorkshop() {
  const [state, setState] = useState(loadWorkshop)
  const [playing, setPlaying] = useState<{ game: GameMeta; daily: boolean; round: number } | null>(null)
  const [finished, setFinished] = useState<Finished | null>(null)
  const daily = dailyGame()
  const dailyDone = state.dailyDone === dayKey()
  const streak = currentStreak(state)

  useEffect(() => { window.scrollTo({ top: 0 }) }, [playing, finished])

  function play(game: GameMeta, isDaily = false) {
    setFinished(null)
    setPlaying((current) => ({ game, daily: isDaily, round: (current?.round ?? 0) + 1 }))
  }

  function handleFinish(result: GameResult) {
    if (!playing) return
    const before = gameStats(state, playing.game.id).level
    const next = recordPlay(state, playing.game.id, result.outcome, playing.game.levels, playing.daily)
    setState(next)
    setFinished({ game: playing.game, result, before, after: gameStats(next, playing.game.id).level })
    setPlaying(null)
  }

  if (playing) {
    const Game = playing.game.component
    const level = gameStats(state, playing.game.id).level
    return (
      <section className="mw">
        <div className="mw-play-head">
          <button type="button" className="pp-back" onClick={() => setPlaying(null)}>← Juegos</button>
          <span>{playing.game.emoji} {playing.game.title} · Nivel {level}</span>
        </div>
        <Game key={playing.round} level={level} onFinish={handleFinish} />
      </section>
    )
  }

  if (finished) {
    const { game, result, before, after } = finished
    const title = after > before ? `¡Excelente! Subís al nivel ${after}` : after < before ? 'Buen ejercicio' : result.outcome === 'up' ? '¡Excelente! Ya estás en el nivel más alto' : '¡Bien hecho!'
    const note = after > before ? 'La próxima va a ser un poco más desafiante.' : after < before ? `Probamos el nivel ${after}, un poco más tranquilo, y vamos subiendo de a poco.` : 'Seguí practicando en este nivel para subir.'
    return (
      <section className="mw">
        <div className="pp-card mw-result">
          <span className="mw-result-emoji" aria-hidden>{after > before ? '🏆' : '🌟'}</span>
          <h2>{title}</h2>
          <p>{result.summary}</p>
          <p className="pp-muted">{note}</p>
          {streak > 1 && <p className="mw-streak-inline">🔥 {streak} días seguidos ejercitando</p>}
          <div className="pp-row">
            <button type="button" className="pp-secondary" onClick={() => setFinished(null)}>Otros juegos</button>
            <button type="button" className="pp-primary" onClick={() => play(game)}>Jugar de nuevo</button>
          </div>
        </div>
      </section>
    )
  }

  return (
    <section className="mw">
      <div className="pp-card mw-head">
        <h1>🧠 Taller de memoria</h1>
        <p className="pp-muted">Unos minutos por día para mantener la mente activa. La dificultad se ajusta sola a medida que mejorás.</p>
        <div className="mw-streak">
          <div><strong>🔥 {streak}</strong><span>{streak === 1 ? 'día seguido' : 'días seguidos'}</span></div>
          <div><strong>⭐ {state.bestStreak}</strong><span>mejor racha</span></div>
        </div>
      </div>

      <button type="button" className={`mw-daily${dailyDone ? ' is-done' : ''}`} onClick={() => play(daily, true)}>
        <span className="mw-daily-label">{dailyDone ? '✅ Desafío de hoy cumplido' : '🎯 Desafío de hoy'}</span>
        <strong>{daily.emoji} {daily.title}</strong>
        <span>{dailyDone ? 'Podés volver a jugarlo cuando quieras' : 'Tocá para empezar'}</span>
      </button>

      {AREAS.map((area) => (
        <div key={area.id} className="mw-area">
          <div className="mw-area-head">
            <h2>{area.title}</h2>
            <span>{area.note}</span>
          </div>
          <div className="mw-games">
            {GAMES.filter((game) => game.area === area.id).map((game) => {
              const stats = gameStats(state, game.id)
              return (
                <button key={game.id} type="button" className={`mw-game-card is-${game.area}`} onClick={() => play(game)}>
                  <span className="mw-game-emoji" aria-hidden>{game.emoji}</span>
                  <strong>{game.title}</strong>
                  <span>{game.skill}</span>
                  <span className="mw-level">Nivel {stats.level} de {game.levels}{stats.plays ? ` · ${stats.plays} ${stats.plays === 1 ? 'partida' : 'partidas'}` : ''}</span>
                </button>
              )
            })}
          </div>
        </div>
      ))}
      <p className="mw-disclaimer">Estos juegos son para ejercitar y entretenerse. No son una evaluación médica: si notás olvidos que te preocupan, consultalo con tu médico.</p>
    </section>
  )
}
