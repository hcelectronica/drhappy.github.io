import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

test('public consultation header is generic and does not use professional identity', () => {
  const html = readFileSync(new URL('../public/consulta/index.html', import.meta.url), 'utf8')
  const header = html.match(/<header class="hero">([\s\S]*?)<\/header>/)[1]
  assert.match(header, /Orientación virtual asistida/)
  assert.match(header, /Será leída por un profesional/)
  assert.match(header, /un profesional la lee y revisa/)
  assert.match(header, /src="\/brand-mark.svg"/)
  assert.doesNotMatch(html, /page\.professionalName|page\.letterhead|page\.specialty|initials\(/)
  assert.match(html, /action: 'get-page', slug: slug/)
  assert.match(html, /action: 'submit', slug: slug/)
  assert.match(html, /money\(page.price\)/)
  assert.match(html, /consult.professionalName/)
})
