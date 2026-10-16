import assert from 'node:assert/strict'
import { writeFile } from 'node:fs/promises'

const origin = process.env.TEST_GUIDE_ORIGIN || 'http://127.0.0.1:5194'
const cdp = process.env.TEST_GUIDE_CDP || 'http://127.0.0.1:9379'
const target = await (await fetch(`${cdp}/json/new?about:blank`, { method: 'PUT' })).json()
const socket = new WebSocket(target.webSocketDebuggerUrl)
await new Promise(resolve => socket.addEventListener('open', resolve))
let sequence = 0
const pending = new Map()
socket.addEventListener('message', message => {
  const event = JSON.parse(message.data)
  const callback = pending.get(event.id)
  if (!callback) return
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
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))
const wait = async expression => {
  for (let i = 0; i < 200; i++) {
    if (await evaluate(`!!(${expression})`)) return
    await sleep(100)
  }
  throw new Error(`Timed out: ${expression}`)
}
const viewport = (width, height = 844) => send('Emulation.setDeviceMetricsOverride', {
  width, height, deviceScaleFactor: 1, mobile: width < 600,
})
const counter = () => evaluate(`document.querySelector('.home-promo-controls > span').textContent`)
const fixture = `${origin}/tests/home-tool-guide.ui.html`

try {
  await send('Page.enable')
  await send('Emulation.setFocusEmulationEnabled', { enabled: true })
  await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'no-preference' }] })
  await viewport(1280)
  await send('Page.navigate', { url: fixture })
  await wait(`document.querySelector('.home-promo-slide')`)
  await wait(`document.visibilityState === 'visible'`)
  await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 10, y: 600 })
  assert.equal(await counter(), '1 / 10')
  await wait(`document.querySelector('.home-promo-controls > span').textContent === '2 / 10'`)
  await evaluate(`document.querySelector('.home-promo-pause').click()`)
  await evaluate(`document.activeElement.blur()`)
  await sleep(7500)
  assert.equal(await counter(), '2 / 10', 'Pause stops automatic advance')
  await evaluate(`document.querySelector('[aria-label="Flyer anterior"]').click()`)
  assert.equal(await counter(), '1 / 10')
  await evaluate(`document.querySelector('[aria-label="Flyer anterior"]').click()`)
  assert.equal(await counter(), '10 / 10', 'Previous wraps')
  await evaluate(`document.querySelector('[aria-label="Flyer siguiente"]').click()`)
  assert.equal(await counter(), '1 / 10')
  for (const width of [900, 1280, 1920]) {
    await viewport(width, 620)
    for (let index = 0; index < 10; index++) {
      const size = await evaluate(`(() => {
        const slide=document.querySelector('.home-promo-slide').getBoundingClientRect();
        return {width:slide.width,height:slide.height,overflow:document.documentElement.scrollWidth>innerWidth,
          clipped:[...document.querySelectorAll('.home-promo-copy, .home-promo-art .auth-promo-tool-art')].some(e=>e.scrollHeight>e.clientHeight+1)};
      })()`)
      assert.ok(size.width <= 760 && size.height <= 300 && !size.overflow && !size.clipped, JSON.stringify({ width, index, size }))
      assert.equal(await evaluate(`document.querySelectorAll('.home-promo-slide').length`), 1)
      assert.equal(await evaluate(`document.querySelectorAll('.home-promo-slide button, .home-promo-slide a, dialog, .home-tutorial-dialog').length`), 0)
      await evaluate(`document.querySelector('[aria-label="Flyer siguiente"]').click()`)
    }
    await evaluate(`document.body.classList.add('theme-night')`)
    const contrast = await evaluate(`(() => {
      const l=c=>{const a=c.match(/\\d+/g).slice(0,3).map(v=>+v/255).map(v=>v<=.04045?v/12.92:((v+.055)/1.055)**2.4);return a[0]*.2126+a[1]*.7152+a[2]*.0722};
      const a=l(getComputedStyle(document.querySelector('.home-promo-copy p')).color),b=l(getComputedStyle(document.querySelector('.home-promo-slide')).backgroundColor);
      return (Math.max(a,b)+.05)/(Math.min(a,b)+.05);
    })()`)
    assert.ok(contrast >= 4.5)
    await evaluate(`document.body.classList.remove('theme-night')`)
  }
  await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] })
  await send('Page.navigate', { url: fixture })
  await wait(`document.querySelector('.home-promo-slide')`)
  await sleep(7500)
  assert.equal(await counter(), '1 / 10', 'Reduced motion disables autoplay')
  assert.equal(await evaluate(`document.querySelector('.home-promo-pause') === null`), true)
  await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'no-preference' }] })
  await evaluate(`document.querySelector('.home-promo-controls button').focus()`)
  const focusedCounter = await counter()
  await sleep(7500)
  assert.equal(await counter(), focusedCounter, 'Keyboard focus stops automatic advance')
  const hoverPoint = await evaluate(`(() => {const r=document.querySelector('.home-promo-slide').getBoundingClientRect();return {x:r.x+20,y:r.y+20}})()`)
  await send('Input.dispatchMouseEvent', { type: 'mouseMoved', ...hoverPoint })
  await evaluate(`document.activeElement.blur()`)
  const hoveredCounter = await counter()
  await sleep(7500)
  assert.equal(await counter(), hoveredCounter, 'Hover stops automatic advance')
  await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 10, y: 600 })
  await wait(`document.querySelector('.home-promo-controls > span').textContent !== ${JSON.stringify(hoveredCounter)}`)
  await send('Page.navigate', { url: `${fixture}?dental` })
  await wait(`document.querySelector('.home-promo-slide')`)
  await evaluate(`document.querySelector('[aria-label="Flyer siguiente"]').click()`)
  assert.match(await evaluate(`document.querySelector('.home-promo-slide').textContent`), /Odontograma interactivo/)
  assert.equal(await evaluate(`document.querySelectorAll('.home-promo-slide [role="button"], .home-promo-slide button').length`), 0)
  await viewport(390)
  await wait(`!document.querySelector('.home-promo-carousel')`)
  for (const width of [320, 390, 844, 899]) {
    await viewport(width)
    await send('Page.navigate', { url: fixture })
    await wait(`document.querySelector('#root > main')`)
    assert.equal(await evaluate(`document.querySelector('#root > main').innerHTML`), '')
    assert.equal(await evaluate(`performance.getEntriesByType('resource').filter(r=>r.name.includes('/tool-tutorials/')).length`), 0)
  }
  await send('Page.navigate', { url: origin })
  await wait(`document.querySelector('.auth-developer-contact button')`)
  assert.equal(await evaluate(`document.querySelectorAll('.auth-promo-tool-art').length`), 10)
  await evaluate(`document.querySelector('.auth-developer-contact button').click()`)
  await wait(`document.querySelector('[aria-labelledby="contact-modal-title-login"] form')`)
  await send('Page.addScriptToEvaluateOnNewDocument', { source: `
    localStorage.clear();sessionStorage.clear();
    const professional={id:'promo-demo',username:'promo-demo',full_name:'Profesional de ejemplo',specialty:'Clinica',
      license_number:'DEMO',email:'demo@example.invalid',active:true,is_admin:true,subscription_status:'active',
      subscription_expires_at:'2027-12-31T00:00:00Z'};
    localStorage.setItem('drhappy-active-user',professional.id);
    localStorage.setItem('drhappy-professional-session','promo-fixture-session');
    localStorage.setItem('drhappy-install-prompt-dismissed',String(Date.now()+86400000));
    localStorage.setItem('drhappy-notification-prompt-dismissed',String(Date.now()+86400000));
    const nativeFetch=window.fetch.bind(window);
    window.fetch=async(input,init)=>{
      const url=typeof input==='string'?input:input instanceof Request?input.url:String(input);
      if(new URL(url,location.href).origin===location.origin)return nativeFetch(input,init);
      let data={success:true};
      if(url.includes('/auth/v1/'))data={};
      else if(url.includes('/rest/v1/'))data=[];
      else if(url.endsWith('/professionals-data'))data={success:true,professional,professionals:[professional]};
      else if(url.endsWith('/workspace-data'))data={success:true,professional,archivedPatients:[],workspace:{
        user_id:professional.id,profile_json:{fullName:professional.full_name,specialty:professional.specialty,
          license:'DEMO',email:'demo@example.invalid'},patients_json:[],appointments_json:[],treatment_ledger_json:[],
        treatment_ledger_initialized:true}};
      else if(url.endsWith('/patient-folder'))data={success:true,requests:[],links:[]};
      return Response.json(data);
    };
  ` })
  await viewport(1280, 620)
  await send('Page.navigate', { url: origin })
  await wait(`document.querySelector('.home-promo-controls')`)
  await sleep(1500)
  const actions = await evaluate(`[...document.querySelectorAll('[data-home-action]')].map(e=>e.dataset.homeAction)`)
  for (const width of [900, 1259, 1920]) {
    await viewport(width, 620)
    await evaluate(`window.scrollTo(0,document.documentElement.scrollHeight)`)
    const reachable = await evaluate(`(() => {
      const controls=[...document.querySelectorAll('.home-promo-controls button')];
      return controls.every(e=>{const r=e.getBoundingClientRect();return r.bottom<innerHeight-90&&document.elementFromPoint(r.x+r.width/2,r.y+r.height/2)?.closest('button')===e});
    })()`)
    assert.ok(reachable, `Real home controls clear of bottom navigation at ${width}px`)
  }
  if (process.env.TEST_PROMO_PREVIEW) {
    await viewport(1259, 620)
    await evaluate(`window.scrollTo(0,document.documentElement.scrollHeight)`)
    const screenshot = await send('Page.captureScreenshot', { format: 'png' })
    await writeFile(process.env.TEST_PROMO_PREVIEW, Buffer.from(screenshot.data, 'base64'))
  }
  for (const width of [320, 390, 844, 899]) {
    await viewport(width)
    await send('Page.navigate', { url: origin })
    await wait(`document.querySelector('[data-home-action="patients"]')`)
    assert.equal(await evaluate(`document.querySelector('.home-promo-carousel') === null`), true)
    assert.deepEqual(await evaluate(`[...document.querySelectorAll('[data-home-action]')].map(e=>e.dataset.homeAction)`), actions)
    assert.equal(await evaluate(`getComputedStyle(document.querySelector('.mobile-home-menu')).display`), 'block')
    assert.equal(await evaluate(`document.documentElement.scrollWidth<=innerWidth`), true)
  }
  console.log('PASS: compact shared promotional flyers; 7s autoplay, wrap, pause, hover, focus, reduced motion; no tutorials or tool navigation. Real home controls clear of bottom bar at 900/1259/1920px; mobile menu unchanged at 320/390/844/899px; public flyers and contact preserved.')
} finally {
  const closed = new Promise(resolve => socket.addEventListener('close', resolve, { once: true }))
  socket.close()
  await closed
  await fetch(`${cdp}/json/close/${target.id}`)
}
