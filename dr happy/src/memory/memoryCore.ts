export type GameId = 'cards' | 'words' | 'chain' | 'path' | 'search' | 'crossword' | 'speed' | 'fluency' | 'story' | 'shop'
export type Outcome = 'up' | 'same' | 'down'

export interface GameResult {
  outcome: Outcome
  summary: string
}

export interface GameProps {
  level: number
  onFinish: (result: GameResult) => void
}

export interface GameStats {
  level: number
  maxLevel: number
  plays: number
}

export interface WorkshopState {
  streak: number
  bestStreak: number
  lastDay: string
  dailyDone: string
  games: Partial<Record<GameId, GameStats>>
}

const STORAGE_KEY = 'drhappy-memory-v1'

export function dayKey(date = new Date()): string {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

function yesterdayKey(): string {
  const date = new Date()
  date.setDate(date.getDate() - 1)
  return dayKey(date)
}

export function loadWorkshop(): WorkshopState {
  const empty: WorkshopState = { streak: 0, bestStreak: 0, lastDay: '', dailyDone: '', games: {} }
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    return raw ? { ...empty, ...JSON.parse(raw) as Partial<WorkshopState> } : empty
  } catch {
    return empty
  }
}

export function currentStreak(state: WorkshopState): number {
  return state.lastDay === dayKey() || state.lastDay === yesterdayKey() ? state.streak : 0
}

export function gameStats(state: WorkshopState, id: GameId): GameStats {
  return state.games[id] ?? { level: 1, maxLevel: 1, plays: 0 }
}

export function recordPlay(state: WorkshopState, id: GameId, outcome: Outcome, levels: number, isDaily: boolean): WorkshopState {
  const today = dayKey()
  const streak = state.lastDay === today ? state.streak : state.lastDay === yesterdayKey() ? state.streak + 1 : 1
  const stats = gameStats(state, id)
  const delta = outcome === 'up' ? 1 : outcome === 'down' ? -1 : 0
  const level = Math.min(levels, Math.max(1, stats.level + delta))
  const next: WorkshopState = {
    ...state,
    streak,
    bestStreak: Math.max(state.bestStreak, streak),
    lastDay: today,
    dailyDone: isDaily ? today : state.dailyDone,
    games: { ...state.games, [id]: { level, maxLevel: Math.max(stats.maxLevel, level), plays: stats.plays + 1 } },
  }
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(next)) } catch { /* sin almacenamiento: se juega igual */ }
  return next
}

export function shuffle<T>(items: readonly T[]): T[] {
  const copy = [...items]
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[copy[i], copy[j]] = [copy[j], copy[i]]
  }
  return copy
}

export function randInt(min: number, max: number): number {
  return min + Math.floor(Math.random() * (max - min + 1))
}

export function pick<T>(items: readonly T[]): T {
  return items[Math.floor(Math.random() * items.length)]
}

export function formatSeconds(total: number): string {
  const m = Math.floor(total / 60)
  const s = total % 60
  return m ? `${m}:${String(s).padStart(2, '0')}` : `${s} s`
}
