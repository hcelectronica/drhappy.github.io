import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import ts from 'typescript'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'

const require = createRequire(import.meta.url)
globalThis.matchMedia = () => ({ matches: true })
const modelSource = readFileSync(new URL('../src/homeToolTutorials.ts', import.meta.url), 'utf8')
const compile = source => ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
}).outputText
const model = {}
new Function('require', 'exports', compile(modelSource.replace('import.meta.env.BASE_URL', "'/'")))(require, model)
const source = readFileSync(new URL('../src/HomeToolGuide.tsx', import.meta.url), 'utf8')
const exports = {}
new Function('require', 'exports', compile(source.replace("import './homeToolGuide.css'", '')))(
  name => name === './homeToolTutorials' ? model : require(name), exports,
)
const render = actions => renderToStaticMarkup(createElement(exports.HomeToolGuide, { actions }))

test('guide shows one tutorial flyer, not a grid or duplicate tool navigation', () => {
  const html = render([
    { key: 'patients', icon: 'P', label: 'Mis pacientes' },
    { key: 'invite', icon: 'I', label: 'Invitar paciente' },
    { key: 'logout', icon: 'L', label: 'Cerrar sesión' },
  ])
  assert.match(html, /Mis pacientes/)
  assert.match(html, /1 \/ 2/)
  assert.doesNotMatch(html, /Cerrar sesión|Turnera|<a[\s>]/)
  assert.equal((html.match(/class="home-tool-flyer"/g) || []).length, 1)
  assert.match(html, /aria-haspopup="dialog"/)
  assert.match(html, /Tutorial anterior/)
  assert.match(html, /Tutorial siguiente/)
})

test('specialty labels and account availability are preserved', () => {
  const html = render([{ key: 'attention', icon: 'A', label: 'Atención odontológica' }])
  assert.match(html, /Atención odontológica/)
  assert.match(html, /attention-dental-1\.png/)
  assert.doesNotMatch(html, /Videoconsulta|Balance|Atención médica/)
  assert.equal(render([]), '')
})

test('every tutorial has benefit copy and three short illustrated steps in lossless high DPI', () => {
  const tutorials = [
    ...Object.values(model.homeToolTutorials),
    model.getHomeToolTutorial('attention', 'Atención odontológica'),
    model.getHomeToolTutorial('tools', 'Vademécum'),
  ]
  assert.equal(model.getHomeToolTutorial('logout', 'Cerrar sesión'), undefined)
  assert.equal(model.getHomeToolTutorial('__proto__', 'Inexistente'), undefined)
  assert.equal(new Set(tutorials.map(t => t.image)).size, tutorials.length)
  for (const tutorial of tutorials) {
    assert.ok(tutorial.benefit.length > 15)
    assert.ok(tutorial.promise.length > 15)
    assert.equal(tutorial.steps.length, 3)
    assert.equal(new Set(tutorial.steps.map(step => step.title)).size, 3)
    tutorial.steps.forEach((step, index) => {
      assert.ok(step.summary.length <= 120, step.summary)
      const image = readFileSync(new URL(`../public/tool-tutorials/${tutorial.image}-${index + 1}.png`, import.meta.url))
      assert.equal(image.subarray(1, 4).toString(), 'PNG')
      assert.ok(image.readUInt32BE(16) >= 1200, 'Capture must be at least 1200 physical pixels wide')
      assert.ok(image.readUInt32BE(20) >= 720, 'Capture must be at least 720 physical pixels tall')
      assert.equal(model.homeToolTutorialImage(tutorial.image, index), `/tool-tutorials/${tutorial.image}-${index + 1}.png`)
    })
  }
})

test('mobile home has no tutorial elements or images', () => {
  globalThis.matchMedia = () => ({ matches: false })
  try {
    assert.equal(render([{ key: 'patients', icon: 'P', label: 'Mis pacientes' }]), '')
  } finally {
    globalThis.matchMedia = () => ({ matches: true })
  }
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
  assert.match(app, /<HomeToolGuide actions=\{\[\{ key: 'sofia',[\s\S]*?\.\.\.homeQuickActions\]\} \/>/)
})
