import { useCallback, useEffect, useMemo, useState } from 'react'
import { CROSSWORD_BANK } from './crosswordBank'
import { shuffle } from './memoryCore'
import type { GameProps } from './memoryCore'
import { CROSSWORD_LEVELS } from './memoryLevels'

type Dir = 'across' | 'down'

interface Entry {
  word: string
  clue: string
  row: number
  col: number
  dir: Dir
  number: number
}

interface Layout {
  rows: number
  cols: number
  entries: Entry[]
  letters: (string | null)[][]
  numbers: (number | null)[][]
}

const cellKey = (r: number, c: number) => `${r},${c}`

function tryGenerate(count: number, maxSize: number): Layout | null {
  const bank = shuffle(CROSSWORD_BANK.filter(({ word }) => word.length >= 3 && word.length <= maxSize))
  const cells = new Map<string, { ch: string; across: boolean; down: boolean }>()
  const placed: Omit<Entry, 'number'>[] = []
  let minR = 0, maxR = 0, minC = 0, maxC = 0

  function score(word: string, r: number, c: number, dir: Dir): number {
    const dr = dir === 'down' ? 1 : 0, dc = dir === 'across' ? 1 : 0
    const endR = r + dr * (word.length - 1), endC = c + dc * (word.length - 1)
    if (Math.max(maxR, endR) - Math.min(minR, r) + 1 > maxSize) return -1
    if (Math.max(maxC, endC) - Math.min(minC, c) + 1 > maxSize) return -1
    if (cells.has(cellKey(r - dr, c - dc)) || cells.has(cellKey(endR + dr, endC + dc))) return -1
    let crossings = 0
    for (let i = 0; i < word.length; i++) {
      const rr = r + dr * i, cc = c + dc * i
      const cell = cells.get(cellKey(rr, cc))
      if (cell) {
        if (cell.ch !== word[i] || cell[dir]) return -1
        crossings++
      } else if (cells.has(cellKey(rr + dc, cc + dr)) || cells.has(cellKey(rr - dc, cc - dr))) {
        return -1
      }
    }
    return crossings
  }

  function place(word: string, clue: string, r: number, c: number, dir: Dir) {
    const dr = dir === 'down' ? 1 : 0, dc = dir === 'across' ? 1 : 0
    for (let i = 0; i < word.length; i++) {
      const key = cellKey(r + dr * i, c + dc * i)
      const cell = cells.get(key) ?? { ch: word[i], across: false, down: false }
      cell[dir] = true
      cells.set(key, cell)
    }
    minR = Math.min(minR, r); minC = Math.min(minC, c)
    maxR = Math.max(maxR, r + dr * (word.length - 1)); maxC = Math.max(maxC, c + dc * (word.length - 1))
    placed.push({ word, clue, row: r, col: c, dir })
  }

  const [first, ...rest] = bank.filter(({ word }) => word.length >= 5)
  if (!first) return null
  place(first.word, first.clue, 0, 0, 'across')

  for (const { word, clue } of [...rest, ...bank.filter(({ word }) => word.length < 5)]) {
    if (placed.length >= count) break
    let best: { r: number; c: number; dir: Dir; s: number } | null = null
    for (const [key, cell] of cells) {
      const [cr, cc] = key.split(',').map(Number)
      for (let i = 0; i < word.length; i++) {
        if (word[i] !== cell.ch) continue
        for (const dir of ['across', 'down'] as Dir[]) {
          const r = dir === 'down' ? cr - i : cr
          const c = dir === 'across' ? cc - i : cc
          const s = score(word, r, c, dir)
          if (s > 0 && (!best || s + Math.random() > best.s)) best = { r, c, dir, s: s + Math.random() }
        }
      }
    }
    if (best) place(word, clue, best.r, best.c, best.dir)
  }
  if (placed.length < count) return null

  const rows = maxR - minR + 1, cols = maxC - minC + 1
  const letters: (string | null)[][] = Array.from({ length: rows }, () => Array<string | null>(cols).fill(null))
  for (const [key, cell] of cells) {
    const [r, c] = key.split(',').map(Number)
    letters[r - minR][c - minC] = cell.ch
  }
  const shifted = placed.map((entry) => ({ ...entry, row: entry.row - minR, col: entry.col - minC }))
  const numbers: (number | null)[][] = Array.from({ length: rows }, () => Array<number | null>(cols).fill(null))
  let next = 1
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      if (shifted.some((entry) => entry.row === r && entry.col === c)) numbers[r][c] = next++
    }
  }
  const entries = shifted
    .map((entry) => ({ ...entry, number: numbers[entry.row][entry.col] ?? 0 }))
    .sort((a, b) => a.number - b.number)
  return { rows, cols, entries, letters, numbers }
}

function generate(count: number, maxSize: number): Layout {
  for (let attempt = 0; attempt < 60; attempt++) {
    const layout = tryGenerate(count, maxSize)
    if (layout) return layout
  }
  for (let fewer = count - 1; fewer >= 3; fewer--) {
    const layout = tryGenerate(fewer, maxSize + 1)
    if (layout) return layout
  }
  return tryGenerate(3, 12) as Layout
}

function entryCells(entry: Entry): [number, number][] {
  return [...entry.word].map((_, i) => entry.dir === 'across' ? [entry.row, entry.col + i] : [entry.row + i, entry.col])
}

const KEY_ROWS = ['QWERTYUIOP', 'ASDFGHJKLÑ', 'ZXCVBNM']

export default function Crossword({ level, onFinish }: GameProps) {
  const config = CROSSWORD_LEVELS[Math.min(level, CROSSWORD_LEVELS.length) - 1]
  const layout = useMemo(() => generate(config.words, config.size), [config])
  const [guesses, setGuesses] = useState<Record<string, string>>({})
  const [selected, setSelected] = useState<[number, number]>(() => [layout.entries[0].row, layout.entries[0].col])
  const [dir, setDir] = useState<Dir>(layout.entries[0].dir)
  const [checked, setChecked] = useState(false)
  const [helps, setHelps] = useState(0)
  const [checks, setChecks] = useState(0)
  const [gaveUp, setGaveUp] = useState(false)
  const [showClues, setShowClues] = useState(false)

  const entryAt = useCallback((r: number, c: number, d: Dir) =>
    layout.entries.find((entry) => entry.dir === d && entryCells(entry).some(([er, ec]) => er === r && ec === c)), [layout])

  const current = entryAt(selected[0], selected[1], dir) ?? entryAt(selected[0], selected[1], dir === 'across' ? 'down' : 'across')
  const currentCells = useMemo(() => new Set(current ? entryCells(current).map(([r, c]) => cellKey(r, c)) : []), [current])

  const allCells = useMemo(() => {
    const list: [number, number][] = []
    layout.letters.forEach((row, r) => row.forEach((letter, c) => { if (letter) list.push([r, c]) }))
    return list
  }, [layout])
  const solved = allCells.every(([r, c]) => guesses[cellKey(r, c)] === layout.letters[r][c])
  const filled = allCells.filter(([r, c]) => guesses[cellKey(r, c)]).length

  useEffect(() => {
    if (!solved || gaveUp) return
    const outcome = helps === 0 && checks <= 1 ? 'up' : helps > layout.entries.length ? 'down' : 'same'
    const timer = window.setTimeout(() => onFinish({
      outcome,
      summary: `Completaste el crucigrama de ${layout.entries.length} palabras${helps ? ` con ${helps} ${helps === 1 ? 'letra de ayuda' : 'letras de ayuda'}` : ' sin ayuda'}.`,
    }), 1100)
    return () => window.clearTimeout(timer)
    // Solo al completarse.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [solved])

  function select(r: number, c: number) {
    if (!layout.letters[r][c] || solved || gaveUp) return
    if (selected[0] === r && selected[1] === c) {
      const other: Dir = dir === 'across' ? 'down' : 'across'
      if (entryAt(r, c, other)) setDir(other)
      return
    }
    setSelected([r, c])
    if (!entryAt(r, c, dir)) setDir(dir === 'across' ? 'down' : 'across')
  }

  function chooseEntry(entry: Entry) {
    setSelected([entry.row, entry.col])
    setDir(entry.dir)
    setShowClues(false)
  }

  const moveWithin = useCallback((step: 1 | -1) => {
    if (!current) return
    const list = entryCells(current)
    const index = list.findIndex(([r, c]) => r === selected[0] && c === selected[1])
    const next = list[index + step]
    if (next) setSelected(next)
  }, [current, selected])

  const typeLetter = useCallback((letter: string) => {
    if (solved || gaveUp) return
    setChecked(false)
    setGuesses((current) => ({ ...current, [cellKey(selected[0], selected[1])]: letter }))
    moveWithin(1)
  }, [selected, solved, gaveUp, moveWithin])

  const erase = useCallback(() => {
    if (solved || gaveUp) return
    const key = cellKey(selected[0], selected[1])
    if (guesses[key]) {
      setGuesses((current) => ({ ...current, [key]: '' }))
      return
    }
    if (!current) return
    const list = entryCells(current)
    const index = list.findIndex(([r, c]) => r === selected[0] && c === selected[1])
    const prev = list[index - 1]
    if (!prev) return
    setSelected(prev)
    setGuesses((existing) => ({ ...existing, [cellKey(prev[0], prev[1])]: '' }))
  }, [current, guesses, selected, solved, gaveUp])

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.ctrlKey || event.metaKey || event.altKey) return
      const key = event.key.toUpperCase()
      if (/^[A-ZÑ]$/.test(key)) { event.preventDefault(); typeLetter(key) }
      else if (event.key === 'Backspace') { event.preventDefault(); erase() }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [typeLetter, erase])

  function revealLetter() {
    const [r, c] = selected
    const letter = layout.letters[r][c]
    if (!letter || guesses[cellKey(r, c)] === letter) return
    setHelps((value) => value + 1)
    setGuesses((current) => ({ ...current, [cellKey(r, c)]: letter }))
    moveWithin(1)
  }

  function check() {
    setChecked(true)
    setChecks((value) => value + 1)
  }

  const across = layout.entries.filter((entry) => entry.dir === 'across')
  const down = layout.entries.filter((entry) => entry.dir === 'down')

  return (
    <div className="mw-game mw-cw">
      <div className="mw-stats-bar">
        <span>Letras <strong>{filled}/{allCells.length}</strong></span>
        <span>Ayudas <strong>{helps}</strong></span>
      </div>

      <div className="mw-cw-grid" style={{ gridTemplateColumns: `repeat(${layout.cols}, 1fr)`, maxWidth: `${layout.cols * 38}px` }}>
        {layout.letters.flatMap((row, r) => row.map((letter, c) => {
          const key = cellKey(r, c)
          if (!letter) return <span key={key} className="mw-cw-block" />
          const guess = gaveUp ? letter : guesses[key] ?? ''
          const wrong = checked && guess && guess !== letter
          const classes = ['mw-cw-cell']
          if (currentCells.has(key)) classes.push('is-word')
          if (selected[0] === r && selected[1] === c) classes.push('is-active')
          if (wrong) classes.push('is-wrong')
          if (solved) classes.push('is-solved')
          return (
            <button key={key} type="button" className={classes.join(' ')} onClick={() => select(r, c)} aria-label={`Casilla ${r + 1}-${c + 1}`}>
              {layout.numbers[r][c] ? <small>{layout.numbers[r][c]}</small> : null}
              {guess}
            </button>
          )
        }))}
      </div>

      {current && !solved && !gaveUp && (
        <button type="button" className="mw-cw-clue" onClick={() => setShowClues((value) => !value)}>
          <strong>{current.number} {current.dir === 'across' ? 'Horizontal' : 'Vertical'}</strong>
          <span>{current.clue}</span>
          <em>{current.word.length} letras · ver todas ▾</em>
        </button>
      )}

      {showClues && (
        <div className="mw-cw-list">
          {([['Horizontales', across], ['Verticales', down]] as [string, Entry[]][]).filter(([, list]) => list.length).map(([title, list]) => (
            <div key={title}>
              <h3>{title}</h3>
              <ol>
                {list.map((entry) => (
                  <li key={`${entry.dir}-${entry.number}`}>
                    <button type="button" onClick={() => chooseEntry(entry)}><strong>{entry.number}.</strong> {entry.clue}</button>
                  </li>
                ))}
              </ol>
            </div>
          ))}
        </div>
      )}

      {solved ? (
        <p className="mw-verdict is-ok">¡Crucigrama completo! 🎉</p>
      ) : gaveUp ? (
        <button type="button" className="pp-primary" onClick={() => onFinish({ outcome: 'down', summary: `Completaste ${filled} de ${allCells.length} letras. ¡La próxima sale!` })}>Continuar</button>
      ) : (
        <>
          <div className="mw-keyboard">
            {KEY_ROWS.map((row, index) => (
              <div key={row}>
                {[...row].map((letter) => <button key={letter} type="button" onClick={() => typeLetter(letter)}>{letter}</button>)}
                {index === KEY_ROWS.length - 1 && <button type="button" className="is-wide" onClick={erase} aria-label="Borrar">⌫</button>}
              </div>
            ))}
          </div>
          <div className="mw-cw-actions">
            <button type="button" className="pp-secondary" onClick={revealLetter}>💡 Una letra</button>
            <button type="button" className="pp-secondary" onClick={check}>✔ Revisar</button>
            <button type="button" className="pp-secondary" onClick={() => setGaveUp(true)}>Ver solución</button>
          </div>
        </>
      )}
    </div>
  )
}
