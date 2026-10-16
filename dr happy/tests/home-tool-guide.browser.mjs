import assert from 'node:assert/strict'

const origin = process.env.TEST_GUIDE_ORIGIN || 'http://127.0.0.1:5194'
const cdp = process.env.TEST_GUIDE_CDP || 'http://127.0.0.1:9379'
const target = await (await fetch(`${cdp}/json/new?about:blank`, { method: 'PUT' })).json()
const socket = new WebSocket(target.webSocketDebuggerUrl)
await new Promise(resolve => socket.addEventListener('open', resolve))
let sequence = 0
const pending = new Map()
socket.addEventListener('message', message => {
  const event = JSON.parse(message.data)
  if (!event.id || !pending.has(event.id)) return
  const callback = pending.get(event.id)
  pending.delete(event.id)
  if (event.error) callback.reject(new Error(JSON.stringify(event.error)))
  else callback.resolve(event.result)
})
const send = (method, params = {}) => new Promise((resolve, reject) => {
  const id = ++sequence
  pending.set(id, { resolve, reject })
  socket.send(JSON.stringify({ id, method, params }))
})
const evaluate = async expression => {
  const result = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })
  if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails))
  return result.result.value
}
const wait = async expression => {
  const end = Date.now() + 20000
  while (Date.now() < end) {
    if (await evaluate(`!!(${expression})`)) return
    await new Promise(resolve => setTimeout(resolve, 100))
  }
  throw new Error(`Timed out: ${expression}`)
}
const viewport = width => send('Emulation.setDeviceMetricsOverride', {
  width, height: 844, deviceScaleFactor: 1, mobile: width < 600,
})

try {
  await send('Page.enable')
  await viewport(390)
  await send('Page.navigate', { url: `${origin}/tests/home-tool-guide.ui.html` })
  await wait(`document.querySelectorAll('.home-tool-guide-card').length === 6`)
  for (const width of [320, 390, 1280]) {
    await viewport(width)
    assert.equal(await evaluate('document.documentElement.scrollWidth <= innerWidth'), true, `Guide overflow: ${width}`)
    assert.equal(await evaluate(`document.querySelectorAll('.home-tool-guide button, .home-tool-guide a').length`), 0)
    assert.equal(await evaluate(`getComputedStyle(document.querySelector('.home-tool-guide-grid')).gridTemplateColumns.split(' ').length`), width < 600 ? 1 : 3)
    await evaluate(`document.body.classList.add('theme-night')`)
    assert.equal(await evaluate(`getComputedStyle(document.querySelector('.home-tool-guide-card h3')).color.match(/\\d+/g).every(value => Number(value) > 180)`), true)
    assert.equal(await evaluate(`getComputedStyle(document.querySelector('.home-tool-guide-card')).backgroundColor.match(/\\d+/g).every(value => Number(value) < 70)`), true)
    await evaluate(`document.body.classList.remove('theme-night')`)
  }
  await send('Page.navigate', { url: origin })
  await wait(`document.querySelector('.auth-developer-contact button')`)
  assert.equal(await evaluate(`document.querySelector('#auth-login-panel').hidden`), true)
  for (const width of [320, 390, 1280]) {
    await viewport(width)
    assert.equal(await evaluate('document.documentElement.scrollWidth <= innerWidth'), true, `Public page overflow: ${width}`)
    assert.equal(await evaluate(`!!document.querySelector('.auth-developer-contact button').getClientRects().length`), true)
    assert.equal(await evaluate(`document.querySelector('.auth-card').getBoundingClientRect().bottom <= document.querySelector('.auth-developer-contact').getBoundingClientRect().top`), true)
  }
  await evaluate(`document.querySelector('.auth-developer-contact button').click()`)
  await wait(`document.querySelector('[aria-labelledby="contact-modal-title-login"]')`)
  assert.equal(await evaluate(`!!document.querySelector('[aria-labelledby="contact-modal-title-login"] form')`), true)
  await evaluate(`document.querySelector('[aria-labelledby="contact-modal-title-login"] [aria-label="Cerrar ventana"]').click()`)
  assert.equal(await evaluate(`!!document.querySelector('[aria-labelledby="contact-modal-title-login"]')`), false)
  console.log('PASS: guide and public footer at 320/390/1280 px, night theme, no duplicate navigation, support opens before login.')
} finally {
  const closed = new Promise(resolve => socket.addEventListener('close', resolve, { once: true }))
  socket.close()
  await closed
  await fetch(`${cdp}/json/close/${target.id}`)
}
