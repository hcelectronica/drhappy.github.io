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
  await viewport(1280)
  await send('Page.navigate', { url: `${origin}/tests/home-tool-guide.ui.html` })
  await wait(`document.querySelector('.home-tool-flyer')`)
  const next = () => evaluate(`document.querySelector('[aria-label="Tutorial siguiente"]').click()`)
  const previous = () => evaluate(`document.querySelector('[aria-label="Tutorial anterior"]').click()`)
  const position = index => wait(`document.querySelector('.home-tool-carousel-controls > span').textContent.startsWith('${index} / 13')`)
  await previous()
  await position(13)
  await next()
  await position(1)
  for (const width of [900, 1280, 1920]) {
    await viewport(width)
    assert.equal(await evaluate('document.documentElement.scrollWidth <= innerWidth'), true, `Guide overflow: ${width}`)
    assert.equal(await evaluate(`document.querySelectorAll('.home-tool-flyer').length`), 1)
    assert.equal(await evaluate(`document.querySelectorAll('.home-tool-guide a').length`), 0)
    assert.equal(await evaluate(`document.querySelector('.home-tool-carousel').getBoundingClientRect().height < 410`), true)
    for (let index = 1; index <= 13; index++) {
      await position(index)
      await evaluate(`document.querySelector('.home-tool-flyer').focus(); document.querySelector('.home-tool-flyer').click()`)
      await wait(`document.querySelector('.home-tutorial-dialog')?.open`)
      assert.equal(await evaluate(`document.querySelector('[aria-label="Navegación de pasos"] button').disabled`), true)
      for (let step = 1; step <= 3; step++) {
      await wait(`document.querySelector('.home-tutorial-dialog img')?.src.endsWith('-${step}.png') && document.querySelector('.home-tutorial-dialog img')?.naturalWidth >= 1200`)
      assert.equal(await evaluate(`document.querySelector('.home-tutorial-step-controls > span').textContent`), `Paso ${step} de 3`)
      const summary = await evaluate(`(() => {
        const p=document.querySelector('.home-tutorial-summary');
        return {lines:p.getBoundingClientRect().height/parseFloat(getComputedStyle(p).lineHeight),
          truncated:p.scrollHeight>p.clientHeight+1,text:p.textContent};
      })()`)
      assert.ok(summary.lines <= 4.01 && !summary.truncated, `${width}px tutorial ${index}: ${JSON.stringify(summary)}`)
      assert.equal(await evaluate(`document.querySelector('.home-tutorial-dialog').scrollWidth <= document.querySelector('.home-tutorial-dialog').clientWidth`), true)
      await evaluate(`document.body.classList.add('theme-night')`)
      const contrast = await evaluate(`(() => {
        const luminance=color=>{
          const rgb=color.match(/\\d+/g).slice(0,3).map(value=>Number(value)/255)
            .map(value=>value<=.04045?value/12.92:((value+.055)/1.055)**2.4);
          return rgb[0]*.2126+rgb[1]*.7152+rgb[2]*.0722;
        };
        const text=luminance(getComputedStyle(document.querySelector('.home-tutorial-summary')).color);
        const surface=luminance(getComputedStyle(document.querySelector('.home-tutorial-dialog')).backgroundColor);
        return (Math.max(text,surface)+.05)/(Math.min(text,surface)+.05);
      })()`)
      assert.ok(contrast >= 4.5, `Night summary contrast: ${contrast}`)
      await evaluate(`document.body.classList.remove('theme-night')`)
      if (step < 3) await evaluate(`document.querySelector('.home-tutorial-step-controls button:last-child').click()`)
      }
      await evaluate(`document.querySelector('.home-tutorial-stepper li:first-child button').click()`)
      await wait(`document.querySelector('.home-tutorial-step-controls > span').textContent === 'Paso 1 de 3'`)
      await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 })
      await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 })
      await wait(`!document.querySelector('.home-tutorial-dialog')`)
      assert.equal(await evaluate(`document.activeElement === document.querySelector('.home-tool-flyer')`), true)
      await next()
    }
    await position(1)
  }
  assert.equal(await evaluate('window.toolNavigationCount || 0'), 0)
  await evaluate(`document.querySelector('.home-tool-flyer').click()`)
  await wait(`document.querySelector('.home-tutorial-dialog')?.open`)
  await evaluate(`document.querySelector('[aria-label="Cerrar mini tutorial"]').click()`)
  await wait(`!document.querySelector('.home-tutorial-dialog')`)
  await send('Page.navigate', { url: `${origin}/tests/home-tool-guide.ui.html?dental` })
  await wait(`document.querySelector('.home-tool-flyer')`)
  for (let index = 1; index <= 13; index++) {
    await position(index)
    if (index === 3 || index === 10) {
      await evaluate(`document.querySelector('.home-tool-flyer').click()`)
      await wait(`document.querySelector('.home-tutorial-dialog')?.open`)
      const image = index === 3 ? 'attention-dental' : 'tools-dental'
      for (let step = 1; step <= 3; step++) {
        await wait(`document.querySelector('.home-tutorial-dialog img').src.endsWith('/${image}-${step}.png') && document.querySelector('.home-tutorial-dialog img').naturalWidth >= 1200`)
        if (step < 3) await evaluate(`document.querySelector('.home-tutorial-step-controls button:last-child').click()`)
      }
      await evaluate(`document.querySelector('[aria-label="Cerrar mini tutorial"]').click()`)
      await wait(`!document.querySelector('.home-tutorial-dialog')`)
    }
    await next()
  }
  await evaluate(`document.querySelector('.home-tool-flyer').click()`)
  await wait(`document.querySelector('.home-tutorial-dialog')?.open`)
  await viewport(390)
  await wait(`!document.querySelector('.home-tool-guide') && !document.querySelector('.home-tutorial-dialog')`)
  assert.equal(await evaluate(`document.body.style.overflow`), '')
  for (const width of [320, 390, 844, 899]) {
    await viewport(width)
    await send('Page.navigate', { url: `${origin}/tests/home-tool-guide.ui.html` })
    await wait(`document.querySelector('#root > main')`)
    assert.equal(await evaluate(`document.querySelector('.home-tool-guide') === null`), true)
    assert.equal(await evaluate(`performance.getEntriesByType('resource').filter(r=>r.name.includes('/tool-tutorials/')).length`), 0)
    assert.equal(await evaluate(`document.querySelector('#root > main').innerHTML`), '')
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
  console.log('PASS: 13 desktop tutorials x 3 illustrated steps at 900/1280/1920 px; high-DPI screenshots, four-line summaries, dental variants, keyboard/focus/contrast. No tutorial DOM or images at 320/390/844/899 px; resize closes dialog. Public support preserved.')
} finally {
  const closed = new Promise(resolve => socket.addEventListener('close', resolve, { once: true }))
  socket.close()
  await closed
  await fetch(`${cdp}/json/close/${target.id}`)
}
