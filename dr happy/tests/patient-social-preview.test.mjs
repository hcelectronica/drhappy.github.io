import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const read = path => readFileSync(new URL(path, import.meta.url), 'utf8')

test('patient link serves its own static metadata for crawlers without JavaScript', () => {
  const html = read('../paciente.html')
  assert.match(read('../public/.htaccess'), /RewriteRule \^paciente\/\?\$ \/paciente\.html\?patient_portal=1 \[QSA,L\]/)
  assert.match(read('../vite.config.ts'), /patient: resolve\(process\.cwd\(\), 'paciente\.html'\)/)
  for (const property of ['og:image', 'og:image:secure_url']) {
    assert.ok(html.includes(`property="${property}" content="https://www.drhappy.com.ar/social-preview-patient-01.png"`))
  }
  assert.match(html, /name="twitter:image" content="https:\/\/www.drhappy.com.ar\/social-preview-patient-01.png"/)
  assert.match(html, /property="og:url" content="https:\/\/www.drhappy.com.ar\/paciente"/)
  assert.match(html, /href="https:\/\/www.drhappy.com.ar\/paciente"/)
  assert.match(html, /Tu salud, siempre a mano/)
  assert.doesNotMatch(html, /social-preview-drh-08|Probá gratis por 7 días/)
  assert.match(html, /paciente.webmanifest/)
  assert.match(html, /patient-icon-192.png/)
  assert.match(read('../index.html'), /social-preview-drh-08.png/)
})

test('patient preview is a real 1200 by 630 PNG', () => {
  const png = readFileSync(new URL('../public/social-preview-patient-01.png', import.meta.url))
  assert.deepEqual([...png.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10])
  assert.equal(png.readUInt32BE(16), 1200)
  assert.equal(png.readUInt32BE(20), 630)
})
