import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { PATIENT_APP_URL, PATIENT_APP_SHARE_TEXT, PATIENT_APP_WHATSAPP_URL } from '../src/patientAppShare.ts'

test('WhatsApp receives the full invitation and the public patient login only', () => {
  const whatsapp = new URL(PATIENT_APP_WHATSAPP_URL)
  assert.equal(whatsapp.origin, 'https://wa.me')
  assert.equal(whatsapp.searchParams.get('text'), PATIENT_APP_SHARE_TEXT)
  assert.deepEqual([...whatsapp.searchParams.keys()], ['text'])
  const links = PATIENT_APP_SHARE_TEXT.match(/https:\/\/\S+/g)
  assert.deepEqual(links, ['https://www.drhappy.com.ar/paciente'])
  assert.equal(PATIENT_APP_URL, links[0])
  assert.match(PATIENT_APP_SHARE_TEXT, /crear tu propia carpeta/)
  assert.equal(new URL(PATIENT_APP_URL).search, '')
  assert.equal(new URL(PATIENT_APP_URL).hash, '')
})

test('invitation never reads patient data, session, or current URL', () => {
  const source = readFileSync(new URL('../src/patientAppShare.ts', import.meta.url), 'utf8')
  assert.doesNotMatch(source, /\bimport\b|localStorage|sessionStorage|location|patientFolderService/)
})

test('home menu has a clearly labeled WhatsApp link separate from medical sharing', () => {
  const portal = readFileSync(new URL('../src/PatientPortal.tsx', import.meta.url), 'utf8')
  assert.match(portal, /<a className="pp-tile is-friend" href=\{PATIENT_APP_WHATSAPP_URL\} target="_blank" rel="noopener noreferrer"[^>]*>[\s\S]*?Compartir con un amigo[\s\S]*?Por WhatsApp[\s\S]*?<\/a>/)
  assert.match(portal, /setView\('share'\).*Compartir con mi médico/)
})

test('home offers the existing paid virtual orientation without sharing folder data', () => {
  const portal = readFileSync(new URL('../src/PatientPortal.tsx', import.meta.url), 'utf8')
  const tile = portal.match(/<a className="pp-tile is-evaluation"[\s\S]*?<\/a>/)?.[0]
  assert.ok(tile)
  assert.match(tile, /href="https:\/\/www\.drhappy\.com\.ar\/consulta\/alan-moodie-dc876a"/)
  assert.match(tile, /target="_blank" rel="noopener noreferrer"/)
  assert.match(tile, /EVALUAR ESTUDIOS CON INTELIGENCIA ARTIFICIAL/)
  assert.match(tile, /paga, revisada por un médico\. No atiende urgencias/)
  assert.doesNotMatch(tile, /sessionToken|patient\.|documents|onClick/)
  const css = readFileSync(new URL('../src/PatientPortal.css', import.meta.url), 'utf8')
  assert.match(css, /\.pp-tile\.is-evaluation \{ grid-column: 1 \/ -1;/)
})
