import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import ts from 'typescript'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'

const require = createRequire(import.meta.url)
const source = readFileSync(new URL('../src/HomeToolGuide.tsx', import.meta.url), 'utf8')
const compiled = ts.transpileModule(source.replace("import './homeToolGuide.css'", ''), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
}).outputText
const exports = {}
new Function('require', 'exports', compiled)(require, exports)
const render = actions => renderToStaticMarkup(createElement(exports.HomeToolGuide, { actions }))

test('guide describes enabled tools without duplicating navigation', () => {
  const html = render([
    { key: 'patients', icon: 'P', label: 'Mis pacientes' },
    { key: 'invite', icon: 'I', label: 'Invitar paciente' },
    { key: 'logout', icon: 'L', label: 'Cerrar sesión' },
  ])
  assert.match(html, /Mis pacientes/)
  assert.match(html, /atenciones previas/)
  assert.match(html, /Con su autorización/)
  assert.doesNotMatch(html, /Cerrar sesión|Turnera|<button|<a[\s>]/)
  assert.equal((html.match(/<article/g) || []).length, 2)
})

test('specialty labels and account availability are preserved', () => {
  const html = render([{ key: 'attention', icon: 'A', label: 'Atención odontológica' }])
  assert.match(html, /Atención odontológica/)
  assert.doesNotMatch(html, /Videoconsulta|Balance|Atención médica/)
  assert.equal((render([]).match(/<article/g) || []).length, 0)
})

test('public contact is outside the collapsed login and opens existing support', () => {
  const app = readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8')
  const footer = app.match(/<footer className="auth-developer-contact">[\s\S]*?<\/footer>/)?.[0]
  assert.ok(footer)
  assert.match(footer, /setContactModalOpen\(true\)/)
  assert.match(footer, /Contactar con los desarrolladores/)
  assert.ok(app.indexOf(footer) > app.indexOf('className="auth-patient-access"'))
  const secondary = app.match(/<details className="auth-secondary-options">[\s\S]*?<\/details>/)?.[0]
  assert.doesNotMatch(secondary, /Contactar/)
  assert.match(app, /<HomeToolGuide actions=\{homeQuickActions\} \/>/)
})
