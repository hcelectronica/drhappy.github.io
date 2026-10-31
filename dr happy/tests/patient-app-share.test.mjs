import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { PATIENT_APP_URL, PATIENT_APP_SHARE_TEXT, PATIENT_APP_WHATSAPP_URL, patientAppWhatsAppUrl } from '../src/patientAppShare.ts'

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
  assert.match(portal, /<a className="pp-tile is-friend"[\s\S]*?target="_blank" rel="noopener noreferrer"[\s\S]*?Compartir con un amigo[\s\S]*?Por WhatsApp[\s\S]*?<\/a>/)
  assert.match(portal, /setView\('share'\).*Compartir con mi médico/)
})

test('home offers the existing paid virtual orientation without sharing folder data', () => {
  const portal = readFileSync(new URL('../src/PatientPortal.tsx', import.meta.url), 'utf8')
  const tile = portal.match(/<a className="pp-tile is-evaluation"[\s\S]*?<\/a>/)?.[0]
  assert.ok(tile)
  assert.match(tile, /href=\{orientation.url\}/)
  assert.match(portal, /orientation\?\.url && <a/)
  assert.doesNotMatch(portal, /alan-moodie-dc876a/)
  assert.match(tile, /target="_blank" rel="noopener noreferrer"/)
  assert.match(tile, /EVALUAR ESTUDIOS CON INTELIGENCIA ARTIFICIAL/)
  assert.match(tile, /paga, revisada por un médico\. No atiende urgencias/)
  assert.doesNotMatch(tile, /sessionToken|patient\.|documents|onClick/)
  const css = readFileSync(new URL('../src/PatientPortal.css', import.meta.url), 'utf8')
  assert.match(css, /\.pp-tile\.is-evaluation \{ grid-column: 1 \/ -1;/)
})

test('forwarded invitations preserve the sharing professional without patient information', () => {
  const link = 'https://www.drhappy.com.ar/paciente?prof=doctor-b'
  const text = new URL(patientAppWhatsAppUrl(link)).searchParams.get('text')
  assert.ok(text.endsWith(link))
  assert.equal(text.split('https://').length, 2)
})

test('short invitations forward the same code and redirect inside the patient app scope', () => {
  const link = 'https://www.drhappy.com.ar/s/aaaaaaaaaa'
  assert.ok(new URL(patientAppWhatsAppUrl(link)).searchParams.get('text').endsWith(link))
  const rules = readFileSync(new URL('../public/.htaccess', import.meta.url), 'utf8')
  assert.ok(rules.includes('RewriteRule ^s/([a-f0-9]{10})/?$ /paciente?ref=$1 [R=302,L]'))
  const portal = readFileSync(new URL('../src/PatientPortal.tsx', import.meta.url), 'utf8')
  assert.match(portal, /params\.has\('ref'\)/)
  assert.match(portal, /folderCode: referringProfessional\.slice\(5\)/)
})
