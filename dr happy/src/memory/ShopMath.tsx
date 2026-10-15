import { useMemo, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import { pick, randInt, shuffle } from './memoryCore'
import type { GameProps } from './memoryCore'
import { SHOP_LEVELS } from './memoryLevels'

interface Product { one: string; many: string; price: number }

const PRODUCTS: Product[] = [
  { one: 'kilo de pan', many: 'kilos de pan', price: 2000 },
  { one: 'litro de leche', many: 'litros de leche', price: 1400 },
  { one: 'paquete de yerba', many: 'paquetes de yerba', price: 3500 },
  { one: 'docena de huevos', many: 'docenas de huevos', price: 3200 },
  { one: 'paquete de fideos', many: 'paquetes de fideos', price: 1200 },
  { one: 'kilo de tomates', many: 'kilos de tomates', price: 1800 },
  { one: 'kilo de papas', many: 'kilos de papas', price: 900 },
  { one: 'paquete de azúcar', many: 'paquetes de azúcar', price: 1300 },
  { one: 'kilo de manzanas', many: 'kilos de manzanas', price: 2500 },
  { one: 'botella de aceite', many: 'botellas de aceite', price: 3000 },
  { one: 'paquete de galletitas', many: 'paquetes de galletitas', price: 1500 },
  { one: 'pote de dulce de leche', many: 'potes de dulce de leche', price: 2800 },
  { one: 'kilo de bananas', many: 'kilos de bananas', price: 1600 },
  { one: 'paquete de arroz', many: 'paquetes de arroz', price: 1100 },
  { one: 'caja de té', many: 'cajas de té', price: 1700 },
]

const SHOPS = ['el almacén', 'la verdulería', 'el súper', 'el mercadito del barrio', 'la despensa']

interface Problem {
  shop: string
  items: { product: Product; qty: number }[]
  kind: 'total' | 'change'
  discount: number
  pay: number
  answer: number
  explain: string
}

const money = (value: number) => `$${value.toLocaleString('es-AR')}`

function makeProblem(kind: 'total' | 'change', itemCount: number, quantities: boolean, discount: boolean): Problem {
  const items = shuffle(PRODUCTS).slice(0, itemCount).map((product) => ({ product, qty: quantities ? randInt(1, 3) : 1 }))
  const subtotal = items.reduce((sum, { product, qty }) => sum + product.price * qty, 0)
  const percent = discount ? pick([10, 20]) : 0
  const total = subtotal - subtotal * percent / 100
  const parts = items.map(({ product, qty }) => qty > 1 ? `${qty} × ${money(product.price)}` : money(product.price)).join(' + ')
  let explain = `${parts} = ${money(subtotal)}`
  if (percent) explain += `; menos el ${percent}% (${money(subtotal - total)}) = ${money(total)}`
  if (kind === 'total') return { shop: pick(SHOPS), items, kind, discount: percent, pay: 0, answer: total, explain }
  const pay = Math.ceil((total + 1) / 10000) * 10000
  explain += `; ${money(pay)} − ${money(total)} = ${money(pay - total)}`
  return { shop: pick(SHOPS), items, kind, discount: percent, pay, answer: pay - total, explain }
}

const ROUND = 5

export default function ShopMath({ level, onFinish }: GameProps) {
  const config = SHOP_LEVELS[Math.min(level, SHOP_LEVELS.length) - 1]
  const problems = useMemo(() => Array.from({ length: ROUND }, (_, index) =>
    makeProblem(index % 2 ? 'change' : 'total', config.items, config.quantities, config.discount && index >= 3)), [config])
  const [index, setIndex] = useState(0)
  const [value, setValue] = useState('')
  const [feedback, setFeedback] = useState<boolean | null>(null)
  const [correct, setCorrect] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const problem = problems[index]

  function submit(event: FormEvent) {
    event.preventDefault()
    if (feedback !== null || !value) return
    const ok = Number(value) === problem.answer
    setFeedback(ok)
    if (ok) setCorrect(correct + 1)
  }

  function next() {
    if (index + 1 >= ROUND) {
      const outcome = correct >= 4 ? 'up' : correct <= 2 ? 'down' : 'same'
      onFinish({ outcome, summary: `Resolviste bien ${correct} de ${ROUND} compras.` })
      return
    }
    setIndex(index + 1)
    setValue('')
    setFeedback(null)
    window.setTimeout(() => inputRef.current?.focus(), 50)
  }

  return (
    <div className="mw-game">
      <div className="mw-stats-bar"><span>Compra <strong>{index + 1}/{ROUND}</strong></span><span>Bien <strong>{correct}</strong></span></div>
      <div className="mw-ticket">
        <p className="mw-ticket-title">🛒 En {problem.shop} llevás:</p>
        <ul>
          {problem.items.map(({ product, qty }) => (
            <li key={product.one}>
              <span>{qty} {qty > 1 ? product.many : product.one}</span>
              <span>{money(product.price)}{qty > 1 ? ' c/u' : ''}</span>
            </li>
          ))}
        </ul>
        {problem.discount > 0 && <p className="mw-ticket-note">🏷️ Hoy hay <strong>{problem.discount}% de descuento</strong> sobre el total.</p>}
      </div>
      <p className="mw-hint">
        {problem.kind === 'total'
          ? <>¿Cuánto tenés que pagar <strong>en total</strong>?</>
          : <>Pagás con <strong>{money(problem.pay)}</strong>. ¿Cuánto te tienen que dar <strong>de vuelto</strong>?</>}
      </p>
      <form className="mw-math-form" onSubmit={submit}>
        <span className="mw-math-problem">$</span>
        <input ref={inputRef} autoFocus inputMode="numeric" pattern="[0-9]*" value={value} disabled={feedback !== null} onChange={(event) => setValue(event.target.value.replace(/\D/g, '').slice(0, 6))} aria-label="Monto" />
        <button type="submit" className="pp-primary" disabled={feedback !== null}>OK</button>
      </form>
      {feedback !== null && (
        <>
          <p className={`mw-verdict ${feedback ? 'is-ok' : 'is-bad'}`}>{feedback ? '✅ ¡Justo!' : `Era ${money(problem.answer)}`}</p>
          <p className="pp-muted mw-center-text">{problem.explain}</p>
          <button type="button" className="pp-primary" onClick={next}>{index + 1 >= ROUND ? 'Ver resultado' : 'Siguiente compra'}</button>
        </>
      )}
    </div>
  )
}
