import { useEffect, useMemo, useState } from 'react'
import type { PointerEvent as ReactPointerEvent } from 'react'
import { SEARCH_THEMES } from './memoryData'
import { formatSeconds, pick, randInt, shuffle } from './memoryCore'
import type { GameProps } from './memoryCore'
import { SEARCH_LEVELS } from './memoryLevels'

const FILL = 'AAAAEEEEIIIOOOUUSSRRNNLLTTCCDDMMPPBGVHFJZYQX'

interface Cell { r: number; c: number }
interface Placement { word: string; cells: Cell[] }
interface Puzzle { theme: string; grid: string[][]; placements: Placement[] }

function buildPuzzle(size: number, count: number, diagonal: boolean, reverse: boolean): Puzzle {
  const forward: [number, number][] = [[0, 1], [1, 0]]
  if (diagonal) forward.push([1, 1], [-1, 1])
  const directions = reverse ? [...forward, ...forward.map(([dr, dc]) => [-dr, -dc] as [number, number])] : forward
  for (;;) {
    const theme = pick(SEARCH_THEMES)
    const grid: string[][] = Array.from({ length: size }, () => Array<string>(size).fill(''))
    const placements: Placement[] = []
    for (const word of shuffle(theme.words.filter((item) => item.length <= size))) {
      if (placements.length >= count) break
      for (let attempt = 0; attempt < 150; attempt++) {
        const [dr, dc] = pick(directions)
        const r0 = randInt(0, size - 1), c0 = randInt(0, size - 1)
        const cells = [...word].map((_, i) => ({ r: r0 + dr * i, c: c0 + dc * i }))
        const fits = cells.every(({ r, c }, i) => r >= 0 && c >= 0 && r < size && c < size && (grid[r][c] === '' || grid[r][c] === word[i]))
        if (!fits) continue
        cells.forEach(({ r, c }, i) => { grid[r][c] = word[i] })
        placements.push({ word, cells })
        break
      }
    }
    if (placements.length < count) continue
    for (const row of grid) row.forEach((letter, c) => { if (!letter) row[c] = FILL[randInt(0, FILL.length - 1)] })
    return { theme: theme.name, grid, placements: placements.sort((a, b) => a.word.localeCompare(b.word)) }
  }
}

function lineBetween(a: Cell, b: Cell): Cell[] | null {
  const dr = b.r - a.r, dc = b.c - a.c
  if (!(dr === 0 || dc === 0 || Math.abs(dr) === Math.abs(dc))) return null
  const steps = Math.max(Math.abs(dr), Math.abs(dc))
  const sr = Math.sign(dr), sc = Math.sign(dc)
  return Array.from({ length: steps + 1 }, (_, i) => ({ r: a.r + sr * i, c: a.c + sc * i }))
}

const key = (cell: Cell) => `${cell.r}-${cell.c}`

function cellFromPoint(x: number, y: number): Cell | null {
  const element = document.elementFromPoint(x, y) as HTMLElement | null
  const r = element?.dataset.r, c = element?.dataset.c
  return r !== undefined && c !== undefined ? { r: Number(r), c: Number(c) } : null
}

export default function WordSearch({ level, onFinish }: GameProps) {
  const config = SEARCH_LEVELS[Math.min(level, SEARCH_LEVELS.length) - 1]
  const puzzle = useMemo(() => buildPuzzle(config.size, config.words, config.diagonal, config.reverse), [config])
  const [found, setFound] = useState<string[]>([])
  const [start, setStart] = useState<Cell | null>(null)
  const [end, setEnd] = useState<Cell | null>(null)
  const [dragging, setDragging] = useState(false)
  const [revealed, setRevealed] = useState(false)
  const [startedAt] = useState(() => Date.now())
  const [seconds, setSeconds] = useState(0)
  const done = found.length === puzzle.placements.length

  useEffect(() => {
    if (done || revealed) return
    const timer = window.setInterval(() => setSeconds(Math.round((Date.now() - startedAt) / 1000)), 1000)
    return () => window.clearInterval(timer)
  }, [done, revealed, startedAt])

  useEffect(() => {
    if (!done || revealed) return
    const total = Math.round((Date.now() - startedAt) / 1000)
    const outcome = total <= puzzle.placements.length * 30 ? 'up' : 'same'
    const timer = window.setTimeout(() => onFinish({ outcome, summary: `Encontraste las ${puzzle.placements.length} palabras de "${puzzle.theme}" en ${formatSeconds(total)}.` }), 900)
    return () => window.clearTimeout(timer)
    // Solo al completar la sopa.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [done])

  const foundCells = useMemo(() => {
    const set = new Set<string>()
    for (const placement of puzzle.placements) {
      if (revealed || found.includes(placement.word)) placement.cells.forEach((cell) => set.add(key(cell)))
    }
    return set
  }, [puzzle, found, revealed])

  const selection = useMemo(() => {
    if (!start) return new Set<string>()
    return new Set((end && lineBetween(start, end) || [start]).map(key))
  }, [start, end])

  function trySelect(a: Cell, b: Cell) {
    const line = lineBetween(a, b)
    if (!line) return
    const text = line.map(({ r, c }) => puzzle.grid[r][c]).join('')
    const reversed = [...text].reverse().join('')
    const match = puzzle.placements.find((item) => !found.includes(item.word) && (item.word === text || item.word === reversed))
    if (match) setFound((current) => [...current, match.word])
  }

  function onPointerDown(event: ReactPointerEvent) {
    if (done || revealed) return
    const cell = cellFromPoint(event.clientX, event.clientY)
    if (!cell) return
    // Segundo toque: completa la selección sin arrastrar.
    if (start && !dragging && key(start) !== key(cell)) {
      trySelect(start, cell)
      setStart(null)
      setEnd(null)
      return
    }
    setStart(cell)
    setEnd(cell)
    setDragging(true)
  }

  function onPointerMove(event: ReactPointerEvent) {
    if (!dragging) return
    const cell = cellFromPoint(event.clientX, event.clientY)
    if (cell) setEnd(cell)
  }

  function onPointerUp() {
    if (!dragging) return
    setDragging(false)
    if (start && end && key(start) !== key(end)) {
      trySelect(start, end)
      setStart(null)
      setEnd(null)
    }
  }

  return (
    <div className="mw-game">
      <p className="mw-hint">
        Tema: <strong>{puzzle.theme}</strong>. Deslizá el dedo sobre cada palabra, o tocá la primera y la última letra.
        {config.reverse ? ' Algunas están escritas al revés.' : config.diagonal ? ' Hay palabras en diagonal.' : ''}
      </p>
      <div className="mw-stats-bar">
        <span>Encontradas <strong>{found.length}/{puzzle.placements.length}</strong></span>
        <span>⏱ <strong>{formatSeconds(seconds)}</strong></span>
      </div>
      <div
        className="mw-search"
        style={{ gridTemplateColumns: `repeat(${config.size}, 1fr)` }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
      >
        {puzzle.grid.flatMap((row, r) => row.map((letter, c) => {
          const id = `${r}-${c}`
          return (
            <span key={id} data-r={r} data-c={c} className={`mw-search-cell${foundCells.has(id) ? ' is-found' : ''}${selection.has(id) ? ' is-selected' : ''}`}>
              {letter}
            </span>
          )
        }))}
      </div>
      <ul className="mw-search-words">
        {puzzle.placements.map(({ word }) => <li key={word} className={found.includes(word) ? 'is-found' : ''}>{word}</li>)}
      </ul>
      {!done && !revealed && (
        <button type="button" className="pp-secondary" onClick={() => setRevealed(true)}>Me rindo, mostrame las palabras</button>
      )}
      {revealed && (
        <button type="button" className="pp-primary" onClick={() => onFinish({ outcome: 'same', summary: `Encontraste ${found.length} de ${puzzle.placements.length} palabras de "${puzzle.theme}".` })}>Continuar</button>
      )}
    </div>
  )
}
