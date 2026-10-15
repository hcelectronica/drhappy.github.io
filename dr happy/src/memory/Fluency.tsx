import { useEffect, useMemo, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import { pick } from './memoryCore'
import type { GameProps } from './memoryCore'
import { FLUENCY_LEVELS } from './memoryLevels'

interface Category { name: string; examples: string[] }

const EASY: Category[] = [
  { name: 'Animales', examples: ['perro', 'gato', 'caballo', 'vaca', 'león', 'tigre', 'elefante', 'jirafa', 'conejo', 'oveja', 'gallina', 'pato', 'mono', 'oso', 'zorro', 'loro', 'tortuga', 'ballena'] },
  { name: 'Frutas', examples: ['manzana', 'pera', 'banana', 'naranja', 'mandarina', 'uva', 'frutilla', 'durazno', 'ciruela', 'kiwi', 'ananá', 'sandía', 'melón', 'limón', 'cereza', 'damasco', 'mango', 'pomelo'] },
  { name: 'Cosas de la cocina', examples: ['olla', 'sartén', 'cuchillo', 'tenedor', 'cuchara', 'plato', 'vaso', 'taza', 'heladera', 'horno', 'pava', 'colador', 'rallador', 'mate', 'jarra', 'fuente', 'espumadera', 'tabla'] },
  { name: 'Prendas de ropa', examples: ['camisa', 'pantalón', 'pollera', 'vestido', 'campera', 'buzo', 'remera', 'medias', 'zapatos', 'bufanda', 'gorro', 'guantes', 'saco', 'chaleco', 'pijama', 'corbata', 'zapatillas', 'tapado'] },
  { name: 'Colores', examples: ['rojo', 'azul', 'verde', 'amarillo', 'blanco', 'negro', 'gris', 'marrón', 'naranja', 'violeta', 'rosa', 'celeste', 'bordó', 'beige', 'turquesa', 'dorado', 'plateado', 'lila'] },
  { name: 'Verduras', examples: ['papa', 'zanahoria', 'tomate', 'lechuga', 'cebolla', 'zapallo', 'acelga', 'espinaca', 'batata', 'choclo', 'morrón', 'berenjena', 'zapallito', 'ajo', 'apio', 'remolacha', 'brócoli', 'pepino'] },
]

const HARD: Category[] = [
  { name: 'Países', examples: ['Argentina', 'Uruguay', 'Chile', 'Brasil', 'Paraguay', 'Bolivia', 'Perú', 'México', 'España', 'Italia', 'Francia', 'Alemania', 'Japón', 'China', 'Canadá', 'Portugal', 'Grecia', 'Egipto'] },
  { name: 'Profesiones y oficios', examples: ['médico', 'enfermera', 'maestro', 'abogado', 'carpintero', 'plomero', 'electricista', 'panadero', 'albañil', 'contador', 'cocinero', 'peluquero', 'mecánico', 'arquitecto', 'farmacéutico', 'chofer', 'costurera', 'bombero'] },
  { name: 'Herramientas', examples: ['martillo', 'destornillador', 'pinza', 'serrucho', 'taladro', 'llave', 'clavo', 'tornillo', 'metro', 'nivel', 'lima', 'cincel', 'pala', 'rastrillo', 'tijera', 'alicate', 'cepillo', 'escalera'] },
  { name: 'Partes del cuerpo', examples: ['cabeza', 'brazo', 'pierna', 'mano', 'pie', 'rodilla', 'codo', 'hombro', 'cuello', 'espalda', 'ojo', 'nariz', 'boca', 'oreja', 'dedo', 'tobillo', 'muñeca', 'cadera'] },
  { name: 'Ciudades argentinas', examples: ['Córdoba', 'Rosario', 'Mendoza', 'Salta', 'Tucumán', 'Mar del Plata', 'Bariloche', 'Neuquén', 'Corrientes', 'Posadas', 'Ushuaia', 'Santa Fe', 'Paraná', 'La Plata', 'San Juan', 'Jujuy', 'Resistencia', 'Rawson'] },
  { name: 'Instrumentos musicales', examples: ['guitarra', 'piano', 'violín', 'bandoneón', 'bombo', 'flauta', 'trompeta', 'batería', 'saxofón', 'arpa', 'acordeón', 'charango', 'quena', 'bajo', 'clarinete', 'violonchelo', 'órgano', 'tambor'] },
  { name: 'Deportes', examples: ['fútbol', 'tenis', 'básquet', 'vóley', 'rugby', 'natación', 'boxeo', 'golf', 'hockey', 'ciclismo', 'atletismo', 'bochas', 'pádel', 'polo', 'esgrima', 'remo', 'handball', 'ajedrez'] },
]

const LETTERS = ['P', 'M', 'C', 'S', 'T', 'L', 'A', 'R', 'F', 'B', 'D', 'E']

const normalize = (text: string) => text.trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\s+/g, ' ')

function otherCategory(key: string, current: Category): boolean {
  return [...EASY, ...HARD].some((category) => category !== current && category.examples.some((example) => normalize(example) === key))
}

export default function Fluency({ level, onFinish }: GameProps) {
  const config = FLUENCY_LEVELS[Math.min(level, FLUENCY_LEVELS.length) - 1]
  const task = useMemo(() => config.mode === 'letter'
    ? { kind: 'letter' as const, letter: pick(LETTERS) }
    : { kind: 'category' as const, category: pick(config.mode === 'category-easy' ? EASY : HARD) }, [config])
  const [started, setStarted] = useState(false)
  const [left, setLeft] = useState<number>(config.seconds)
  const [words, setWords] = useState<string[]>([])
  const [value, setValue] = useState('')
  const [message, setMessage] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!started || left <= 0) return
    const timer = window.setTimeout(() => setLeft(left - 1), 1000)
    return () => window.clearTimeout(timer)
  }, [started, left])
  const done = started && left <= 0

  const prompt = task.kind === 'letter'
    ? <>Palabras que empiecen con <strong className="mw-fluency-letter">{task.letter}</strong>{config.minLength > 3 ? <> (de {config.minLength} letras o más)</> : null}</>
    : <>Escribí todo lo que se te ocurra de la categoría <strong>{task.category.name}</strong></>

  function submit(event: FormEvent) {
    event.preventDefault()
    const word = value.trim()
    if (!word) return
    const key = normalize(word)
    if (key.length < 2) { setMessage('Escribí una palabra completa.') }
    else if (words.some((existing) => normalize(existing) === key)) { setMessage(`"${word}" ya la pusiste.`) }
    else if (task.kind === 'category' && !task.category.examples.some((example) => normalize(example) === key) && otherCategory(key, task.category)) { setMessage(`"${word}" no parece de esta categoría.`) }
    else if (task.kind === 'letter' && !key.startsWith(task.letter.toLowerCase())) { setMessage(`Tiene que empezar con ${task.letter}.`) }
    else if (task.kind === 'letter' && key.replace(/ /g, '').length < config.minLength) { setMessage(`Tiene que tener ${config.minLength} letras o más.`) }
    else {
      setWords((current) => [...current, word])
      setMessage('')
    }
    setValue('')
    inputRef.current?.focus()
  }

  function finish() {
    const n = words.length
    const outcome = n >= config.target ? 'up' : n < Math.ceil(config.target / 2) ? 'down' : 'same'
    const what = task.kind === 'letter' ? `con la ${task.letter}` : `de ${task.category.name.toLowerCase()}`
    onFinish({ outcome, summary: `Dijiste ${n} ${n === 1 ? 'palabra' : 'palabras'} ${what} en ${config.seconds} segundos.` })
  }

  if (!started) {
    return (
      <div className="mw-game">
        <p className="mw-hint">Tenés <strong>{config.seconds} segundos</strong>. {prompt}.</p>
        <p className="pp-muted">Escribí una y apretá OK (o Enter). No valen repetidas. Si se te traba, pensá en lugares: la casa, el campo, el mercado…</p>
        <button type="button" className="pp-primary" onClick={() => { setStarted(true); window.setTimeout(() => inputRef.current?.focus(), 50) }}>Empezar</button>
      </div>
    )
  }

  if (done) {
    const said = new Set(words.map(normalize))
    const others = task.kind === 'category' ? task.category.examples.filter((example) => !said.has(normalize(example))).slice(0, 8) : []
    return (
      <div className="mw-game">
        <p className="mw-verdict is-ok">⏰ ¡Tiempo! Escribiste {words.length} {words.length === 1 ? 'palabra' : 'palabras'}</p>
        {words.length > 0 && <div className="mw-fluency-words">{words.map((word) => <span key={word}>{word}</span>)}</div>}
        {others.length > 0 && (
          <>
            <p className="pp-muted">Otras que también valían:</p>
            <div className="mw-fluency-words is-others">{others.map((word) => <span key={word}>{word}</span>)}</div>
          </>
        )}
        <button type="button" className="pp-primary" onClick={finish}>Ver resultado</button>
      </div>
    )
  }

  return (
    <div className="mw-game">
      <p className="mw-hint">{prompt}</p>
      <div className="mw-countdown"><span style={{ width: `${left / config.seconds * 100}%` }} /></div>
      <form className="mw-fluency-form" onSubmit={submit}>
        <input ref={inputRef} value={value} onChange={(event) => setValue(event.target.value.slice(0, 30))} autoCapitalize="none" autoComplete="off" autoCorrect="off" spellCheck={false} enterKeyHint="send" aria-label="Palabra" />
        <button type="submit" className="pp-primary">OK</button>
      </form>
      {message && <p className="mw-fluency-msg">{message}</p>}
      <div className="mw-stats-bar">
        <span>Palabras <strong>{words.length}</strong></span>
        <span>Meta <strong>{config.target}</strong></span>
        <span>Quedan <strong>{left} s</strong></span>
      </div>
      {words.length > 0 && <div className="mw-fluency-words">{[...words].reverse().map((word) => <span key={word}>{word}</span>)}</div>}
    </div>
  )
}
