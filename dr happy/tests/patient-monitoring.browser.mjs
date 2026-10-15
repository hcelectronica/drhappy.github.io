import assert from 'node:assert/strict'
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'

const origin = process.env.TEST_PATIENT_ORIGIN || 'http://127.0.0.1:5194'
const cdp = process.env.TEST_PATIENT_CDP || 'http://127.0.0.1:9379'
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))
const target = (await (await fetch(`${cdp}/json`)).json()).find(page => page.type === 'page')
const socket = new WebSocket(target.webSocketDebuggerUrl)
await new Promise(resolve => socket.addEventListener('open', resolve))
let sequence = 0, failure = false, noticePending = 1
const pending = new Map(), activity = [], pages = []
const send = (method, params = {}) => new Promise((resolve, reject) => {
  const id = ++sequence
  pending.set(id, { resolve, reject })
  socket.send(JSON.stringify({ id, method, params }))
})
const patient = { id: 'browser-fixture', fullName: 'Paciente ficticio', firstName: 'Prueba', email: 'fixture@example.invalid', storageUsedBytes: 0, storageQuotaBytes: 52428800 }
function fixture(page) {
  return {
    summary: { total: 51, verified: 40, pending: 11, registrations7d: 8, registrations30d: 20,
      active_today: 4, active7d: 12, active30d: 25, minutes30d: 120, games30d: 7, invites30d: 3 },
    documents: { count: 10, bytes: 10485760, patients: 6 }, pressure: { count: 8, patients: 3 },
    shares: { doctor: 3, link: 1 }, notices: { sent: 2, pending: noticePending },
    daily: [{ date: '2026-10-15', registrations: 8, verified: 7, active: 4 }],
    features: { memory: 12, game_completed: 7, invite_clicked: 3 },
    recent: [{ id: 'fixture', full_name: page ? 'Paciente página dos' : 'Paciente de prueba',
      email: 'fixture@example.invalid', created_at: '2026-10-15T18:00:00Z',
      email_verified_at: null, active: true, last_login_at: null, last_seen_at: null }],
    trackingSince: '2026-10-15', generatedAt: '2026-10-15T18:00:00Z',
  }
}
socket.addEventListener('message', async message => {
  const event = JSON.parse(message.data)
  if (event.id && pending.has(event.id)) {
    const callback = pending.get(event.id)
    pending.delete(event.id)
    if (event.error) callback.reject(new Error(JSON.stringify(event.error)))
    else callback.resolve(event.result)
  }
  if (event.method === 'Fetch.requestPaused') {
    const request = event.params.request
    const body = JSON.parse(request.postData || '{}')
    let result
    if (request.url.includes('/admin-stats')) {
      if (body.action === 'patient-notice-retry') { noticePending = 0; result = { success: true, sent: 1 } }
      else { pages.push(body.page); result = failure ? { success: false, message: 'Error controlado de prueba' } : { success: true, stats: fixture(body.page) } }
    } else {
      if (body.action === 'activity') activity.push(body)
      result = { success: true, patient, documents: [], requests: [] }
    }
    await send('Fetch.fulfillRequest', { requestId: event.params.requestId, responseCode: 200,
      responseHeaders: [{ name: 'content-type', value: 'application/json' }, { name: 'access-control-allow-origin', value: '*' },
        { name: 'access-control-allow-methods', value: 'POST, OPTIONS' },
        { name: 'access-control-allow-headers', value: request.headers['Access-Control-Request-Headers'] || '*' }],
      body: Buffer.from(JSON.stringify(result)).toString('base64') })
  }
})
const evaluate = async expression => {
  const result = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })
  if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails))
  return result.result.value
}
const wait = async expression => {
  const end = Date.now() + 12000
  while (Date.now() < end) { if (await evaluate(expression)) return; await sleep(100) }
  throw new Error(`Timed out: ${expression}`)
}
const click = text => evaluate(`(() => { const b = [...document.querySelectorAll('button')].find(x => x.textContent.includes(${JSON.stringify(text)})); if(!b) throw Error('Missing button'); b.click() })()`)

try {
  await send('Page.enable')
  await send('Fetch.enable', { patterns: [{ urlPattern: '*/functions/v1/*', requestStage: 'Request' }] })
  await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true })
  await send('Page.navigate', { url: `${origin}/tests/patient-monitoring.ui.html` })
  await wait(`document.body.innerText.includes('Cuentas creadas')`)
  assert.equal(await evaluate(`document.querySelectorAll('.analytics-stat-card').length`), 17)
  for (const width of [320, 390, 1280]) {
    await send('Emulation.setDeviceMetricsOverride', { width, height: 844, deviceScaleFactor: 1, mobile: width < 500 })
    assert.equal(await evaluate('document.documentElement.scrollWidth <= innerWidth'), true, `Overflow at ${width}`)
  }
  await click('Siguiente')
  await wait(`document.body.innerText.includes('Paciente página dos')`)
  assert.ok(pages.includes(1))
  await click('Reintentar avisos')
  await wait(`document.body.innerText.includes('Avisos enviados en este intento: 1')`)
  failure = true
  await click('Actualizar')
  await wait(`document.body.innerText.includes('Error controlado de prueba')`)
  assert.equal(await evaluate(`document.querySelectorAll('.analytics-stat-card').length`), 0)
  failure = false
  await click('Actualizar')
  await wait(`document.body.innerText.includes('Cuentas creadas')`)
  if (process.env.TEST_PATIENT_SCREENSHOT) {
    const screenshot = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true })
    await writeFile(join(process.env.TEST_PATIENT_SCREENSHOT, 'patient-admin-stats.png'), Buffer.from(screenshot.data, 'base64'))
  }
  await send('Page.navigate', { url: `${origin}/paciente` })
  await wait(`!!document.querySelector('.pp-auth')`)
  await evaluate(`localStorage.setItem('drhappy-patient-session','browser-fixture')`)
  await send('Page.reload')
  await wait(`!!document.querySelector('.pp-tile.is-friend')`)
  await click('Entendido').catch(() => {})
  await evaluate(`document.querySelector('.pp-tile.is-friend').addEventListener('click',e=>e.preventDefault(),{once:true}); document.querySelector('.pp-tile.is-friend').click()`)
  await click('Taller de memoria')
  await wait(`!!document.querySelector('.mw-area')`)
  await click('Historias para recordar')
  await wait(`!!document.querySelector('.mw-story')`)
  await click('Ya la leí')
  while (await evaluate(`!!document.querySelector('.mw-story-options')`)) {
    await evaluate(`document.querySelector('.mw-story-options button').click()`)
    await sleep(100)
  }
  await click('Ver resultado')
  await wait(`!!document.querySelector('.mw-result')`)
  await sleep(300)
  assert.ok(activity.some(item => item.event === 'heartbeat'))
  assert.ok(activity.some(item => item.event === 'view' && item.feature === 'memory'))
  assert.ok(activity.some(item => item.event === 'invite_clicked'))
  assert.ok(activity.some(item => item.event === 'game_completed'))
  assert.ok(activity.every(item => Object.keys(item).every(key => ['action','event','feature'].includes(key))))
  await evaluate(`localStorage.removeItem('drhappy-patient-session')`)
  console.log('PASS: admin cards, responsive tables, pagination, email retry, explicit errors, and patient/game/invite telemetry.')
} finally {
  socket.close()
}
