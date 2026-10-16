import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import ts from 'typescript'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'

const require = createRequire(import.meta.url)
globalThis.matchMedia = query => ({ matches: query.includes('min-width') })
globalThis.document = { hidden: false }
const cache = new Map()
function load(name) {
  if (!name.startsWith('./')) return require(name)
  if (name.endsWith('.css')) return {}
  if (name.endsWith('.png')) return name
  if (cache.has(name)) return cache.get(name)
  const exports = {}
  cache.set(name, exports)
  const source = readFileSync(new URL(`../src/${name.slice(2)}.tsx`, import.meta.url), 'utf8')
  const compiled = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
  }).outputText
  new Function('require', 'exports', compiled)(load, exports)
  return exports
}
const { HomePromoCarousel } = load('./HomePromoCarousel')
const render = actions => renderToStaticMarkup(createElement(HomePromoCarousel, { actions }))

test('one compact promotional flyer, no tutorials, screenshots or tool navigation', () => {
  const html = render([
    { key: 'patients', icon: 'P', label: 'Mis pacientes' },
    { key: 'invite', icon: 'I', label: 'Invitar paciente' },
    { key: 'logout', icon: 'L', label: 'Cerrar sesión' },
  ])
  assert.match(html, /Historia clínica digital/)
  assert.match(html, /1 \/ 2/)
  assert.equal((html.match(/class="home-promo-slide"/g) || []).length, 1)
  assert.match(html, /auth-promo-tool-art--patients/)
  assert.match(html, /Flyer anterior/)
  assert.match(html, /Pausar/)
  assert.doesNotMatch(html, /Cerrar sesión|<a[\s>]|dialog|tutorial|tool-tutorials/)
})

test('account availability and dental promotional artwork are preserved', () => {
  const html = render([{ key: 'attention', icon: 'A', label: 'Atención odontológica' }])
  assert.match(html, /Odontograma interactivo/)
  assert.match(html, /CADA PIEZA/)
  assert.doesNotMatch(html, /role="button"|Ver demostración|Pasá el mouse|Videoconsulta/)
  assert.equal(render([]), '')
})

test('mobile home has no promotional elements or image loads', () => {
  globalThis.matchMedia = () => ({ matches: false })
  try {
    assert.equal(render([{ key: 'patients', icon: 'P', label: 'Mis pacientes' }]), '')
  } finally {
    globalThis.matchMedia = query => ({ matches: query.includes('min-width') })
  }
})

test('public landing and professional home reuse the same promotional artwork', () => {
  const app = readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8')
  assert.equal((app.match(/<PromotionalArtwork service=/g) || []).length, 9)
  assert.match(app, /<HomePromoCarousel actions=/)
  assert.doesNotMatch(app, /HomeToolGuide/)
  const footer = app.match(/<footer className="auth-developer-contact">[\s\S]*?<\/footer>/)?.[0]
  assert.ok(footer)
  assert.match(footer, /setContactModalOpen\(true\)/)
})
