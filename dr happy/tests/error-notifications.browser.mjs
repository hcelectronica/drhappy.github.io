import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdtemp, rm } from 'node:fs/promises'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const origin = process.env.TEST_APP_ORIGIN || 'http://127.0.0.1:5175'
const profile = await mkdtemp(join(tmpdir(), 'drhappy-toast-test-'))
const reservation = createServer()
await new Promise((resolve) => reservation.listen(0, '127.0.0.1', resolve))
const port = reservation.address().port
await new Promise((resolve) => reservation.close(resolve))
const browser = spawn(process.env.EDGE_EXECUTABLE || String.raw`C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe`, [
  '--headless', '--disable-gpu', '--no-first-run', `--remote-debugging-port=${port}`,
  `--user-data-dir=${profile}`, 'about:blank',
], { stdio: 'ignore' })
let socket
let launchError
browser.on('error', (error) => { launchError = error })
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
try {
  let tabs
  for (let attempt = 0; attempt < 150; attempt++) {
    if (launchError) throw launchError
    try {
      tabs = await fetch(`http://127.0.0.1:${port}/json`).then((response) => response.json())
      if (tabs.some((tab) => tab.type === 'page')) break
    } catch (error) {
      if (error.cause?.code !== 'ECONNREFUSED') throw error
    }
    await sleep(200)
  }
  assert(tabs?.some((tab) => tab.type === 'page'), 'Browser must expose its isolated debugging port')
  socket = new WebSocket(tabs.find((tab) => tab.type === 'page').webSocketDebuggerUrl)
  await new Promise((resolve, reject) => {
    socket.addEventListener('open', resolve, { once: true })
    socket.addEventListener('error', reject, { once: true })
  })
  const pending = new Map()
  let nextId = 0
  socket.addEventListener('message', (event) => {
    const response = JSON.parse(event.data)
    const request = pending.get(response.id)
    if (!request) return
    pending.delete(response.id)
    if (response.error) request.reject(new Error(response.error.message))
    else request.resolve(response.result)
  })
  const command = (method, params = {}) => new Promise((resolve, reject) => {
    const id = ++nextId
    pending.set(id, { resolve, reject })
    socket.send(JSON.stringify({ id, method, params }))
  })
  const evaluate = async (expression) => {
    const result = await command('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true, userGesture: true })
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text)
    return result.result.value
  }
  const waitFor = async (expression) => {
    for (let attempt = 0; attempt < 300; attempt++) {
      if (await evaluate(expression)) return
      await sleep(100)
    }
    throw new Error(`UI timeout: ${expression}\n` + await evaluate(`JSON.stringify({url:location.href,state:document.readyState,body:document.body.innerText.slice(-2000),html:document.body.innerHTML.slice(0,500)})`))
  }
  await command('Page.enable')
  await command('Page.addScriptToEvaluateOnNewDocument', { source: `if(location.origin===${JSON.stringify(origin)})localStorage.removeItem('drhappy-dental-design-preview-v1')` })
  const navigation = await command('Page.navigate', { url: `${origin}/dental-design` })
  assert(!navigation.errorText, navigation.errorText)
  await waitFor(`!!document.querySelector('.dental-observations textarea')`)
  await evaluate(`(()=>{
    const input=document.querySelector('.dental-observations textarea');
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(input,'Prueba de cambios sin guardar');
    input.dispatchEvent(new Event('input',{bubbles:true}));
  })()`)
  await sleep(100)
  await evaluate(`document.querySelector('.dental-desktop-print').click()`)
  await waitFor(`document.querySelector('.app-error-toast p')?.textContent.includes('Guardá los cambios antes de imprimir')`)
  assert.equal(await evaluate(`document.querySelectorAll('.app-error-toast').length`), 1)
  await evaluate(`document.querySelector('.app-error-toast button').click()`)
  await waitFor(`!document.querySelector('.app-error-toast')`)
  await evaluate(`document.querySelector('.dental-desktop-print').click()`)
  await waitFor(`!!document.querySelector('.app-error-toast')`)
  await evaluate(`document.querySelector('.app-error-toast button').click()`)
  console.log('Dental PDF validation: immediate toast, manual dismissal, same-action retry.')

  await evaluate(`(async()=>{
    const {default:React}=await import('/node_modules/.vite/deps/react.js');
    const {createRoot}=(await import('/node_modules/.vite/deps/react-dom_client.js')).default;
    const {ErrorNotificationProvider}=await import('/src/ErrorNotifications.tsx');
    const {useErrorNotification}=await import('/src/useErrorNotification.ts');
    function Harness(){
      const [error,setError]=useErrorNotification('Aviso inicial');
      window.__notify=setError;
      return React.createElement('main',null,
        React.createElement('button',{id:'focus-target'},'Control de prueba'),
        React.createElement('p',null,error),
        React.createElement('div',{style:{height:3000}},'Contenido largo'),
        React.createElement('dialog',{id:'test-dialog'},React.createElement('button',{id:'dialog-focus'},'Control del diálogo')));
    }
    document.getElementById('root').style.display='none';
    const container=document.createElement('div');
    document.body.append(container);
    createRoot(container).render(React.createElement(React.StrictMode,null,
      React.createElement(ErrorNotificationProvider,null,React.createElement(Harness))));
  })()`)
  await waitFor(`document.querySelector('.app-error-toast p')?.textContent==='Aviso inicial'`)
  assert.equal(await evaluate(`document.querySelectorAll('.app-error-toast').length`), 1, 'StrictMode must not duplicate initial notifications')
  await evaluate(`document.querySelector('.app-error-toast button').click();document.getElementById('focus-target').focus();window.__notify(null)`)
  await sleep(100)
  assert.equal(await evaluate(`document.querySelectorAll('.app-error-toast').length`), 0, 'Clearing errors must not show an empty toast')
  await evaluate(`window.__notify('Mismo error')`)
  await waitFor(`!!document.querySelector('.app-error-toast')`)
  await sleep(1000)
  await evaluate(`window.__notify('Mismo error')`)
  await sleep(100)
  assert.equal(await evaluate(`document.querySelectorAll('.app-error-toast').length`), 1, 'Repeating must replace, not accumulate')
  assert.equal(await evaluate(`document.activeElement.id`), 'focus-target', 'Notifications must not steal focus')
  await evaluate(`window.__notify('Segundo error');window.scrollTo(0,2000)`)
  await waitFor(`document.querySelectorAll('.app-error-toast').length===2`)
  for (const width of [320, 390, 1280]) {
    await command('Emulation.setDeviceMetricsOverride', { width, height: 844, deviceScaleFactor: 1, mobile: width < 600 })
    assert(await evaluate(`Array.from(document.querySelectorAll('.app-error-toast')).every(n=>{const r=n.getBoundingClientRect();return r.left>=0&&r.right<=innerWidth&&r.top>=0&&r.bottom<=innerHeight})`), `Visible without scrolling at ${width}px`)
    assert(await evaluate(`document.documentElement.scrollWidth<=innerWidth`), `No horizontal overflow at ${width}px`)
  }
  await evaluate(`document.getElementById('test-dialog').showModal();document.getElementById('dialog-focus').focus();window.__notify('Aviso sobre el diálogo')`)
  await waitFor(`document.querySelectorAll('.app-error-toast').length===3`)
  assert(await evaluate(`(()=>{const n=Array.from(document.querySelectorAll('.app-error-toast')).at(-1);const r=n.getBoundingClientRect();return n.contains(document.elementFromPoint(r.left+20,r.top+20))})()`), 'Toast must be above a native modal')
  assert.equal(await evaluate(`document.activeElement.id`), 'dialog-focus')
  await evaluate(`document.getElementById('test-dialog').close();document.querySelectorAll('.app-error-toast button').forEach(b=>b.click())`)
  await waitFor(`!document.querySelector('.app-error-toast')`)
  await evaluate(`window.__notify('<img src=x onerror=alert(1)>')`)
  await waitFor(`!!document.querySelector('.app-error-toast')`)
  assert.equal(await evaluate(`document.querySelectorAll('.app-error-toast img').length`), 0, 'Messages are text, never interpreted as HTML')
  await evaluate(`document.querySelector('.app-error-toast button').click();window.__notify('Tiempo de lectura')`)
  await waitFor(`document.querySelector('.app-error-toast p')?.textContent==='Tiempo de lectura'`)
  await command('Emulation.setFocusEmulationEnabled', { enabled: true })
  await evaluate(`document.querySelector('.app-error-toast button').focus()`)
  assert(await evaluate(`document.activeElement===document.querySelector('.app-error-toast button')`), 'Toast close control must receive focus')
  await sleep(300)
  assert(await evaluate(`document.activeElement===document.querySelector('.app-error-toast button')`), 'Toast focus must remain after effects settle')
  await sleep(12500)
  assert.equal(await evaluate(`document.querySelectorAll('.app-error-toast').length`), 1, 'Focus pauses the dismiss timer')
  await evaluate(`document.getElementById('focus-target').focus()`)
  await sleep(12500)
  assert.equal(await evaluate(`document.querySelectorAll('.app-error-toast').length`), 0, 'Timer resumes and dismisses')
  await evaluate(`window.__notify('Reaparece después de vencer')`)
  await waitFor(`document.querySelector('.app-error-toast p')?.textContent==='Reaparece después de vencer'`)
  await sleep(10000)
  await evaluate(`window.__notify('Reaparece después de vencer')`)
  await sleep(2500)
  assert.equal(await evaluate(`document.querySelectorAll('.app-error-toast').length`), 1, 'Same-message retry resets its timer')
  await sleep(10000)
  assert.equal(await evaluate(`document.querySelectorAll('.app-error-toast').length`), 0)
  await evaluate(`window.__notify('Reaparece después de vencer')`)
  await waitFor(`!!document.querySelector('.app-error-toast')`)
  await command('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] })
  assert.equal(await evaluate(`getComputedStyle(document.querySelector('.app-error-toast')).animationName`), 'none')
  await evaluate(`document.querySelector('.app-error-toast button').click();window.__notify('Pausa con puntero')`)
  await waitFor(`document.querySelector('.app-error-toast p')?.textContent==='Pausa con puntero'`)
  const point = await evaluate(`(()=>{const r=document.querySelector('.app-error-toast').getBoundingClientRect();return{x:r.left+20,y:r.top+20}})()`)
  await command('Input.dispatchMouseEvent', { type: 'mouseMoved', ...point })
  await sleep(12500)
  assert.equal(await evaluate(`document.querySelectorAll('.app-error-toast').length`), 1, 'Hover pauses the dismiss timer')
  await command('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 0, y: 0 })
  await evaluate(`document.querySelector('.app-error-toast button').click();document.getElementById('test-dialog').showModal();window.__notify('Diálogo eliminado')`)
  await waitFor(`document.querySelector('.app-error-toast p')?.textContent==='Diálogo eliminado'`)
  await evaluate(`document.getElementById('test-dialog').remove()`)
  await waitFor(`document.querySelector('.app-error-toast-viewport.is-visible')?.parentElement.parentElement===document.body`)
  assert(await evaluate(`document.querySelector('.app-error-toast-viewport.is-visible').matches(':popover-open')`), 'Removing a native dialog must preserve its notification')
  console.log('Toast lifecycle passed: repeated errors, concurrency, responsive scroll, native modal and removal, focus, safe text, timed dismissal, focus/hover pause, reduced motion.')
} finally {
  if (socket?.readyState === WebSocket.OPEN) socket.close()
  browser.kill()
  await sleep(1500)
  await rm(profile, { recursive: true, force: true, maxRetries: 3, retryDelay: 500 })
}
