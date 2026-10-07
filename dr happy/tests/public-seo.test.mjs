import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', process.env.SEO_BUILD_DIR || '.')
const publicRoot = process.env.SEO_BUILD_DIR ? root : join(root, 'public')
const home = readFileSync(join(root, 'index.html'), 'utf8')
const privacy = readFileSync(join(publicRoot, 'privacidad.html'), 'utf8')
const sitemap = readFileSync(join(publicRoot, 'sitemap.xml'), 'utf8')

test('public pages declare the canonical URLs listed in the sitemap', () => {
  const pages = [
    [home, 'https://www.drhappy.com.ar/'],
    [privacy, 'https://www.drhappy.com.ar/privacidad.html'],
  ]
  const locations = [...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)].map(match => match[1])
  assert.deepEqual(locations, pages.map(([, url]) => url))
  for (const [html, url] of pages) {
    assert.equal((html.match(/rel="canonical"/g) || []).length, 1)
    assert(html.includes(`<link rel="canonical" href="${url}" />`))
    assert(!/<meta[^>]+(?:noindex|nofollow)/i.test(html))
  }
})

test('search and social descriptions remain consistent', () => {
  const description = home.match(/<meta name="description" content="([^"]+)" \/>/)?.[1]
  assert(description)
  assert(home.includes(`<meta property="og:description" content="${description}" />`))
  assert(home.includes(`<meta name="twitter:description" content="${description}" />`))
  const schema = JSON.parse(home.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/)[1])
  const page = schema['@graph'].find(entity => entity['@type'] === 'WebPage')
  const app = schema['@graph'].find(entity => entity['@type'] === 'WebApplication')
  assert.equal(page.description, description)
  assert.equal(app.description, description)
  assert.equal(page.url, 'https://www.drhappy.com.ar/')
})

test('structured identity describes a website and application, not a medical practice', () => {
  const schema = JSON.parse(home.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/)[1])
  assert.equal(schema['@context'], 'https://schema.org')
  const graph = schema['@graph']
  assert.deepEqual(graph.map(entity => entity['@type']), ['WebSite', 'WebPage', 'WebApplication'])
  assert.equal(new Set(graph.map(entity => entity['@id'])).size, 3)
  const [website, page, app] = graph
  assert.equal(website.name, 'Dr Happy')
  assert.equal(website.url, 'https://www.drhappy.com.ar/')
  assert.equal(page.isPartOf['@id'], website['@id'])
  assert.equal(page.mainEntity['@id'], app['@id'])
  assert.equal(app.name, 'Dr Happy')
  assert.equal(app.applicationCategory, 'HealthApplication')
  assert.equal(app.operatingSystem, 'Web')
  assert(!home.includes('MedicalBusiness'))
  assert(!home.includes('MedicalWebPage'))
})

test('public favicons use a stable PNG URL and declared square dimensions', () => {
  for (const html of [home, privacy]) {
    const icon = html.match(/<link rel="icon"[^>]+>/)?.[0]
    assert(icon)
    assert(icon.includes('type="image/png"'))
    assert(icon.includes('sizes="192x192"'))
    assert.match(icon, /href="(?:%BASE_URL%|\.\/|\/)icon-192\.png"/)
  }
  const png = readFileSync(join(publicRoot, 'icon-192.png'))
  assert.equal(png.subarray(0, 8).toString('hex'), '89504e470d0a1a0a')
  assert.equal(png.readUInt32BE(16), 192)
  assert.equal(png.readUInt32BE(20), 192)
})

test('robots announces the canonical sitemap and does not block its resources', () => {
  const robots = readFileSync(join(publicRoot, 'robots.txt'), 'utf8')
  assert.match(robots, /^User-agent: \*$/m)
  assert.match(robots, /^Allow: \/$/m)
  assert.match(robots, /^Sitemap: https:\/\/www\.drhappy\.com\.ar\/sitemap\.xml$/m)
  assert(!/^Disallow:\s*\S+/m.test(robots))
})

test('shared links advertise the same new brand PNG at its actual dimensions', () => {
  const imageUrl = 'https://www.drhappy.com.ar/social-preview-drh-08.png'
  const registration = readFileSync(join(publicRoot, 'registro', 'index.html'), 'utf8')
  const consultation = readFileSync(join(publicRoot, 'consulta', 'index.html'), 'utf8')
  for (const html of [home, registration, consultation]) {
    assert(html.includes(`<meta property="og:image" content="${imageUrl}" />`))
    assert(html.includes(`<meta property="og:image:secure_url" content="${imageUrl}" />`))
    assert(html.includes('<meta property="og:image:type" content="image/png" />'))
    assert(html.includes('<meta property="og:image:width" content="1200" />'))
    assert(html.includes('<meta property="og:image:height" content="630" />'))
    assert(html.includes(`<meta name="twitter:image" content="${imageUrl}" />`))
    assert(!html.includes('store-feature-graphic.png'))
  }
  assert.match(registration, /<meta name="robots" content="noindex,\s*nofollow"\s*\/?>/)
  const png = readFileSync(join(publicRoot, 'social-preview-drh-08.png'))
  assert.equal(png.subarray(0, 8).toString('hex'), '89504e470d0a1a0a')
  assert.equal(png.readUInt32BE(16), 1200)
  assert.equal(png.readUInt32BE(20), 630)
})

test('patient consultation remains noindex and absent from the sitemap', () => {
  const consultation = readFileSync(join(publicRoot, 'consulta', 'index.html'), 'utf8')
  assert.match(consultation, /<meta name="robots" content="noindex,\s*nofollow"\s*\/?>/)
  assert(!sitemap.includes('/consulta'))
})
