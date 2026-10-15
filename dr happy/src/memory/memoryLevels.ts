// Configuración de dificultad de cada juego (nivel 1 = índice 0).

export const CARD_LEVELS = [
  { pairs: 6, related: false, cols: 4 },
  { pairs: 10, related: false, cols: 4 },
  { pairs: 15, related: false, cols: 5 },
  { pairs: 8, related: true, cols: 4 },
  { pairs: 10, related: true, cols: 4 },
  { pairs: 15, related: true, cols: 5 },
]

export const WORD_LEVELS = [
  { count: 6, perWord: 3, math: 20 },
  { count: 8, perWord: 3, math: 25 },
  { count: 9, perWord: 2.5, math: 30 },
  { count: 10, perWord: 2.5, math: 30 },
  { count: 12, perWord: 2.2, math: 40 },
  { count: 14, perWord: 2, math: 45 },
]

export const CHAIN_LEVELS = [
  { steps: 3, ms: 2800 },
  { steps: 4, ms: 2600 },
  { steps: 5, ms: 2400 },
  { steps: 6, ms: 2200 },
  { steps: 7, ms: 2000 },
  { steps: 8, ms: 1800 },
]

export const PATH_LEVELS = [
  { size: 3, start: 3, reverse: false, ms: 750 },
  { size: 3, start: 4, reverse: false, ms: 700 },
  { size: 4, start: 4, reverse: false, ms: 700 },
  { size: 4, start: 5, reverse: false, ms: 600 },
  { size: 4, start: 4, reverse: true, ms: 650 },
  { size: 4, start: 5, reverse: true, ms: 600 },
]

export const SEARCH_LEVELS = [
  { size: 8, words: 5, diagonal: false, reverse: false },
  { size: 9, words: 6, diagonal: true, reverse: false },
  { size: 10, words: 7, diagonal: true, reverse: false },
  { size: 11, words: 8, diagonal: true, reverse: true },
  { size: 12, words: 9, diagonal: true, reverse: true },
]

export const CROSSWORD_LEVELS = [
  { words: 5, size: 8 },
  { words: 6, size: 9 },
  { words: 8, size: 10 },
  { words: 9, size: 11 },
  { words: 11, size: 12 },
  { words: 12, size: 12 },
]

// ms = tiempo inicial que se muestra la imagen; options = figuras posibles en el centro.
export const SPEED_LEVELS = [
  { ms: 900, options: 2, distractors: false },
  { ms: 700, options: 2, distractors: false },
  { ms: 650, options: 3, distractors: false },
  { ms: 600, options: 3, distractors: true },
  { ms: 500, options: 4, distractors: true },
  { ms: 420, options: 4, distractors: true },
]

export const FLUENCY_LEVELS = [
  { seconds: 90, mode: 'category-easy', minLength: 0, target: 8 },
  { seconds: 90, mode: 'letter', minLength: 3, target: 8 },
  { seconds: 75, mode: 'category-hard', minLength: 0, target: 8 },
  { seconds: 75, mode: 'letter', minLength: 5, target: 7 },
  { seconds: 60, mode: 'category-hard', minLength: 0, target: 8 },
  { seconds: 60, mode: 'letter', minLength: 5, target: 8 },
] as const

export const STORY_LEVELS = [
  { questions: 4, math: 0, readSeconds: 0 },
  { questions: 5, math: 20, readSeconds: 0 },
  { questions: 5, math: 30, readSeconds: 60 },
  { questions: 6, math: 30, readSeconds: 50 },
  { questions: 6, math: 45, readSeconds: 40 },
]

export const SHOP_LEVELS = [
  { items: 2, quantities: false, discount: false },
  { items: 3, quantities: false, discount: false },
  { items: 3, quantities: true, discount: false },
  { items: 4, quantities: true, discount: false },
  { items: 4, quantities: true, discount: true },
  { items: 5, quantities: true, discount: true },
]