import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdtemp, rm } from 'node:fs/promises'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createVideoServer } from './videoServer.mjs'

const origin = 'http://127.0.0.1:5195'
let clockOffset = 0
const handoffs = new Set(['a'.repeat(64), 'b'.repeat(64)])
const app = createVideoServer({
  origin, iceServers: [],
  now: () => Date.now() + clockOffset,
  exchangeHandoff: async token => {
    if (!handoffs.delete(token)) throw Object.assign(new Error('El pase vencio o ya se uso. Abri nuevamente desde Dr Happy.'), { status: 401 })
    return 'test-upstream-session'
  },
  login: async (username, password) => {
    if (username !== 'test-admin' || password !== 'test-password') throw Object.assign(new Error('Acceso denegado.'), { status: 401 })
    return 'test-upstream-session'
  },
  verifyAdmin: async value => {
    if (value !== 'test-upstream-session') throw Object.assign(new Error('Acceso denegado.'), { status: 403 })
    return 'test-admin-id'
  },
})
await new Promise(resolve => app.server.listen(5195, '127.0.0.1', resolve))
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))
const profile = await mkdtemp(join(tmpdir(), 'drhappy-video-test-'))
const reservation = createServer()
await new Promise(resolve => reservation.listen(0, '127.0.0.1', resolve))
const port = reservation.address().port
await new Promise(resolve => reservation.close(resolve))
const browser = spawn(String.raw`C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe`, [
  '--headless', '--disable-gpu', '--no-first-run', '--use-fake-device-for-media-stream',
  '--use-fake-ui-for-media-stream', '--autoplay-policy=no-user-gesture-required',
  `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, 'about:blank',
], { stdio: 'ignore' })
let launchError
browser.on('error', error => { launchError = error })
const sockets = []
async function attach(tab) {
  const socket = new WebSocket(tab.webSocketDebuggerUrl)
  sockets.push(socket)
  await new Promise((resolve, reject) => {
    socket.addEventListener('open', resolve, { once: true })
    socket.addEventListener('error', reject, { once: true })
  })
  let id = 0
  const runtimeErrors = []
  const requests = new Map()
  socket.addEventListener('message', event => {
    const result = JSON.parse(event.data)
    if (result.method === 'Runtime.exceptionThrown') runtimeErrors.push(result.params.exceptionDetails.exception?.description || result.params.exceptionDetails.text)
    const request = requests.get(result.id)
    if (!request) return
    requests.delete(result.id)
    clearTimeout(request.timer)
    if (result.error) request.reject(new Error(result.error.message))
    else request.resolve(result.result)
  })
  const command = (method, params = {}) => new Promise((resolve, reject) => {
    const next = ++id
    const timer = setTimeout(() => { requests.delete(next); reject(new Error(`CDP timeout: ${method}`)) }, 15000)
    requests.set(next, { resolve, reject, timer })
    socket.send(JSON.stringify({ id: next, method, params }))
  })
  const evaluate = async expression => {
    const result = await command('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true, userGesture: true })
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text)
    return result.result.value
  }
  const wait = async expression => {
    for (let attempt = 0; attempt < 150; attempt++) {
      if (await evaluate(expression)) return
      await sleep(100)
    }
    throw new Error(`Timeout: ${expression}\n${await evaluate('document.body.innerText')}\n${runtimeErrors.join('\n')}\n${await evaluate(`JSON.stringify({tracks:document.querySelector('#local')?.srcObject?.getTracks().map(t=>({kind:t.kind,state:t.readyState,enabled:t.enabled})),mic:document.querySelector('#mic')?.outerHTML})`)}`)
  }
  const click = async element => {
    if (element === 'devices') {
      await click('mic')
      await wait(`document.querySelector('#mic').getAttribute('aria-pressed')==='true'`)
      await click('camera')
      await wait(`document.querySelector('#camera').getAttribute('aria-pressed')==='true'`)
      return
    }
    if (element === 'audio-only') {
      await click('mic')
      await wait(`document.querySelector('#mic').getAttribute('aria-pressed')==='true'`)
      return
    }
    await wait(`!!document.getElementById(${JSON.stringify(element)})&&!document.getElementById(${JSON.stringify(element)}).disabled`)
    await evaluate(`document.getElementById(${JSON.stringify(element)}).click()`)
  }
  await command('Page.enable')
  await command('Runtime.enable')
  await command('Page.addScriptToEvaluateOnNewDocument', { source: 'window.__testInstance=String(Date.now())+String(Math.random())' })
  const navigate = async url => {
    let before = await evaluate('window.__testInstance')
    if (before) {
      await command('Page.navigate', { url: 'about:blank' })
      await wait(`window.__testInstance&&window.__testInstance!==${JSON.stringify(before)}`)
      before = await evaluate('window.__testInstance')
    }
    await command('Page.navigate', { url })
    await wait(`window.__testInstance&&window.__testInstance!==${JSON.stringify(before) || 'undefined'}`)
  }
  return { command, evaluate, wait, click, navigate }
}
try {
  let tabs
  for (let attempt = 0; attempt < 100; attempt++) {
    if (launchError) throw launchError
    try {
      tabs = await fetch(`http://127.0.0.1:${port}/json`).then(response => response.json())
      if (tabs.some(tab => tab.type === 'page')) break
    } catch (error) { if (error.cause?.code !== 'ECONNREFUSED') throw error }
    await sleep(200)
  }
  assert(tabs?.some(tab => tab.type === 'page'))
  const professional = await attach(tabs.find(tab => tab.type === 'page'))
  await professional.navigate(origin)
  await professional.wait(`!!document.querySelector('#create')`)
  await professional.wait(`typeof document.querySelector('#login').onsubmit==='function'`)
  assert.equal(await professional.evaluate(`navigator.mediaDevices!==undefined`), true)
  assert.equal(await professional.evaluate(`document.querySelector('#create').hidden`), true, 'Anonymous cannot create a room')
  await professional.navigate(`${origin}/#handoff=${'c'.repeat(64)}`)
  await professional.wait(`document.querySelector('#error').textContent.includes('pase vencio')&&!document.querySelector('#login-panel').hidden`)
  assert.equal(await professional.evaluate('location.hash'), '', 'Failed pass removed immediately from address bar')
  assert.equal(await professional.evaluate(`document.querySelector('#create').hidden`), true)
  await professional.evaluate(`document.querySelector('#username').value='test-admin';document.querySelector('#password').value='test-password'`)
  await professional.click('login-submit')
  await professional.wait(`!document.querySelector('#create').hidden`)
  await professional.click('logout')
  await professional.wait(`!document.querySelector('#login-panel').hidden`)
  await professional.navigate(`${origin}/#handoff=${'a'.repeat(64)}`)
  await professional.wait(`!document.querySelector('#create').hidden&&document.querySelector('#login-panel').hidden`)
  assert.equal(await professional.evaluate('location.hash'), '', 'Automatic access consumes and removes fragment without password')
  await professional.navigate(`${origin}/#handoff=${'a'.repeat(64)}`)
  await professional.wait(`document.querySelector('#error').textContent.includes('pase vencio')`)
  assert.equal(await professional.evaluate(`document.querySelector('#create').hidden`), true, 'Reused pass cannot claim successful authorization')
  await professional.navigate(`${origin}/#handoff=${'b'.repeat(64)}`)
  await professional.wait(`!document.querySelector('#create').hidden`)
  assert.equal(await professional.evaluate(`document.querySelector('#duration').value`), '40')
  await professional.evaluate(`document.querySelector('#duration').value='121'`)
  await professional.click('create')
  await professional.wait(`document.querySelector('#error').textContent.includes('entre 1 y 120')`)
  assert.equal(await professional.evaluate(`document.querySelector('#link').value`), '')
  await professional.evaluate(`document.querySelector('#duration').value='40'`)
  await professional.click('consent')
  await professional.click('create')
  await professional.wait(`document.querySelector('#link').value.includes('#invite=')`)
  const invite = await professional.evaluate(`document.querySelector('#link').value`)
  assert.match(await professional.evaluate(`document.querySelector('#countdown').textContent`), /40 minutos.*Sin iniciar/)
  const patientTab = await fetch(`http://127.0.0.1:${port}/json/new?about:blank`, { method: 'PUT' }).then(response => response.json())
  const patient = await attach(patientTab)
  await patient.navigate(invite)
  await patient.wait(`document.querySelector('#identity')?.textContent.includes('paciente')`)
  await patient.click('consent')
  assert.equal(await patient.evaluate('location.hash'), '', 'Invitation removed from visible URL')
  await professional.click('devices')
  await patient.click('mic')
  await patient.wait(`document.querySelector('#mic').getAttribute('aria-pressed')==='true'`)
  await patient.evaluate(`void(window.__getUserMedia=navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices));navigator.mediaDevices.getUserMedia=async()=>{throw new DOMException('Cámara bloqueada','NotAllowedError')}`)
  await patient.click('camera')
  await patient.wait(`document.querySelector('#error').textContent.includes('Cámara bloqueada')`)
  assert.equal(await patient.evaluate(`document.querySelector('#local').srcObject.getAudioTracks()[0].readyState`), 'live', 'Camera denial preserves microphone')
  await patient.evaluate(`navigator.mediaDevices.getUserMedia=window.__getUserMedia`)
  await patient.click('camera')
  await patient.wait(`document.querySelector('#camera').getAttribute('aria-pressed')==='true'`)
  await professional.click('join')
  await patient.click('join')
  await professional.wait(`!document.querySelector('#admit').hidden`)
  assert.equal(await patient.evaluate(`document.querySelector('#remote').srcObject===null`), true, 'No media before admission')
  assert.equal(await patient.evaluate(`document.querySelector('#send').disabled`), true, 'No chat before admission')
  assert.match(await patient.evaluate(`document.querySelector('#countdown').textContent`), /40 minutos.*Sin iniciar/)
  const duplicateTab = await fetch(`http://127.0.0.1:${port}/json/new?about:blank`, { method: 'PUT' }).then(response => response.json())
  const duplicate = await attach(duplicateTab)
  await duplicate.navigate(invite)
  await duplicate.wait(`document.querySelector('#identity')?.textContent.includes('paciente')`)
  await duplicate.click('consent')
  await duplicate.click('devices')
  await duplicate.click('join')
  await duplicate.wait(`document.querySelector('#error').textContent.includes('otra pestana')`)
  assert.equal(await duplicate.evaluate(`document.querySelector('#local').srcObject===null`), true, 'Failed join releases devices')
  await professional.click('admit')
  await professional.wait(`document.querySelector('#status').textContent.includes('conectados por WebRTC')&&!document.querySelector('#send').disabled`)
  await patient.wait(`document.querySelector('#status').textContent.includes('conectados por WebRTC')&&!document.querySelector('#send').disabled`)
  for (const client of [professional, patient]) {
    assert.match(await client.evaluate(`document.querySelector('#countdown').textContent`), /40 minutos.*Tiempo restante: (40:00|39:\d\d)/)
    assert.deepEqual(await client.evaluate(`(()=>{const l=document.querySelector('#local').srcObject,r=document.querySelector('#remote').srcObject;return{localAudio:l.getAudioTracks().length,remoteAudio:r.getAudioTracks().length,remoteVideo:r.getVideoTracks().length,separate:l.getAudioTracks()[0]!==r.getAudioTracks()[0]}})()`),
      { localAudio: 1, remoteAudio: 1, remoteVideo: 1, separate: true })
    await client.wait(`document.querySelector('#remote').videoWidth>0`)
  }
  await professional.evaluate(`document.querySelector('#text').value='Hola desde profesional de prueba'`)
  await professional.click('send')
  await patient.wait(`document.querySelector('#messages').textContent.includes('Hola desde profesional de prueba')`)
  await professional.wait(`document.querySelector('#messages').textContent.includes('Recibido por el otro navegador')`)
  await patient.evaluate(`document.querySelector('#text').value='<img src=x onerror=alert(1)>'`)
  await patient.click('send')
  await professional.wait(`document.querySelector('#messages').textContent.includes('<img src=x onerror=alert(1)>')`)
  assert.equal(await professional.evaluate(`document.querySelector('#messages img')===null`), true)
  await patient.click('mic')
  assert.equal(await patient.evaluate(`document.querySelector('#local').srcObject.getAudioTracks()[0].enabled`), false)
  await patient.evaluate(`void(window.__oldCamera=document.querySelector('#local').srcObject.getVideoTracks()[0])`)
  await patient.click('camera')
  await patient.wait(`document.querySelector('#camera').getAttribute('aria-pressed')==='false'`)
  assert.equal(await patient.evaluate(`window.__oldCamera.readyState`), 'ended', 'Camera off releases capture')
  assert.equal(await patient.evaluate(`document.querySelector('#local').srcObject.getVideoTracks().length`), 0)
  await professional.wait(`!document.querySelector('#stage-placeholder').hidden`)
  await patient.click('mic')
  await patient.click('camera')
  await patient.wait(`document.querySelector('#camera').getAttribute('aria-pressed')==='true'`)
  await professional.wait(`document.querySelector('#stage-placeholder').hidden`)
  await patient.click('leave')
  await professional.wait(`document.querySelector('#remote').srcObject===null&&document.querySelector('#send').disabled`)
  await patient.click('audio-only')
  await patient.wait(`!!document.querySelector('#local').srcObject&&!document.querySelector('#join').disabled`)
  assert.equal(await patient.evaluate(`document.querySelector('#local').srcObject.getVideoTracks().length`), 0)
  assert.equal(await patient.evaluate(`document.querySelector('#camera').disabled`), false, 'Audio-only can enable camera later')
  await patient.click('join')
  await professional.wait(`!document.querySelector('#admit').hidden`)
  assert.equal(await patient.evaluate(`document.querySelector('#remote').srcObject===null`), true, 'Reentry requires fresh admission')
  await professional.click('admit')
  for (const client of [professional, patient]) {
    await client.wait(`document.querySelector('#status').textContent.includes('conectados por WebRTC')&&!document.querySelector('#send').disabled`)
  }
  assert.equal(await professional.evaluate(`document.querySelector('#remote').srcObject.getAudioTracks().length`), 1)
  await patient.wait(`document.querySelector('#remote').videoWidth>0`)
  await professional.wait(`!document.querySelector('#stage-placeholder').hidden`)
  await patient.click('camera')
  await patient.wait(`document.querySelector('#camera').getAttribute('aria-pressed')==='true'`)
  await professional.wait(`document.querySelector('#stage-placeholder').hidden&&document.querySelector('#remote').videoWidth>0`)
  assert.equal(await patient.evaluate(`document.querySelector('#send').disabled`), false, 'Adding video preserves chat and admission')
  await patient.command('Emulation.setDeviceMetricsOverride', { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false })
  const previewRect = await patient.evaluate(`(()=>{document.querySelector('#stage').scrollIntoView({block:'center'});const r=document.querySelector('#self-preview').getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2,left:r.left,top:r.top}})()`)
  await patient.command('Input.dispatchMouseEvent', { type: 'mousePressed', x: previewRect.x, y: previewRect.y, button: 'left', clickCount: 1 })
  await patient.command('Input.dispatchMouseEvent', { type: 'mouseMoved', x: previewRect.x - 140, y: previewRect.y - 90, button: 'left', buttons: 1 })
  await patient.command('Input.dispatchMouseEvent', { type: 'mouseReleased', x: previewRect.x - 140, y: previewRect.y - 90, button: 'left', clickCount: 1 })
  assert(await patient.evaluate(`document.querySelector('#self-preview').getBoundingClientRect().left<${previewRect.left}-50`), 'Mouse drag moves preview')
  await patient.evaluate(`document.querySelector('#self-preview').focus()`)
  const beforeKey = await patient.evaluate(`document.querySelector('#self-preview').offsetLeft`)
  await patient.command('Input.dispatchKeyEvent', { type: 'keyDown', key: 'ArrowLeft', code: 'ArrowLeft', windowsVirtualKeyCode: 37 })
  assert.equal(await patient.evaluate(`document.querySelector('#self-preview').offsetLeft`), beforeKey - 16, 'Keyboard moves preview')
  await patient.command('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true })
  await patient.command('Emulation.setTouchEmulationEnabled', { enabled: true })
  await patient.command('Page.bringToFront')
  const touchRect = await patient.evaluate(`(()=>{document.querySelector('#stage').scrollIntoView({block:'center'});const r=document.querySelector('#self-preview').getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2,left:r.left,top:r.top}})()`)
  await patient.command('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: touchRect.x, y: touchRect.y }] })
  await patient.command('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: touchRect.x - 60, y: touchRect.y - 60 }] })
  await patient.command('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
  assert(await patient.evaluate(`(()=>{const p=document.querySelector('#self-preview'),s=document.querySelector('#stage'),c=document.querySelector('.video-controls');return p.offsetLeft>=8&&p.offsetLeft+p.offsetWidth<=s.clientWidth-7&&p.offsetTop+p.offsetHeight<=c.offsetTop-9})()`), 'Touch drag and resize remain in stage above controls')
  assert(await patient.evaluate(`document.querySelector('#self-preview').getBoundingClientRect().left!==${touchRect.left}`), 'Touch moves preview')
  await patient.command('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] })
  assert.equal(await patient.evaluate(`getComputedStyle(document.querySelector('.stage-logo')).animationName`), 'none')
  await patient.command('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'no-preference' }] })
  assert.equal(await patient.evaluate(`getComputedStyle(document.querySelector('.stage-logo')).animationName`), 'logo-breathe')
  for (const client of [professional, patient]) await client.evaluate(`void(window.__testTracks=document.querySelector('#local').srcObject.getTracks())`)
  await professional.click('end')
  for (const client of [professional, patient]) {
    await client.wait(`document.querySelector('#status').textContent.includes('finalizo')`)
    assert.equal(await client.evaluate(`window.__testTracks.every(track=>track.readyState==='ended')`), true)
    assert.equal(await client.evaluate(`document.querySelector('#remote').srcObject===null&&document.querySelector('#send').disabled`), true)
  }
  await duplicate.navigate(invite)
  await duplicate.wait(`document.querySelector('#identity')?.textContent.includes('paciente')`)
  await duplicate.click('consent')
  await duplicate.click('devices')
  await duplicate.click('join')
  await duplicate.wait(`document.querySelector('#error').textContent.includes('no es valido')`)
  await professional.click('create')
  await professional.wait(`document.querySelector('#link').value!==${JSON.stringify(invite)}&&!document.querySelector('#create').disabled`)
  const nextInvite = await professional.evaluate(`document.querySelector('#link').value`)
  await professional.click('camera')
  await professional.wait(`document.querySelector('#camera').getAttribute('aria-pressed')==='true'`)
  await professional.click('join')
  await patient.navigate(nextInvite)
  await patient.wait(`document.querySelector('#identity')?.textContent.includes('paciente')`)
  await patient.click('consent')
  await patient.click('devices')
  await patient.click('join')
  await professional.wait(`!document.querySelector('#reject').hidden`)
  const authorization = await patient.evaluate(`new Promise(resolve=>{const test=io({auth:{token:${JSON.stringify(nextInvite.split('#invite=')[1])}},reconnection:false});test.on('connect_error',e=>{test.disconnect();resolve(e.message)});})`)
  assert(authorization.includes('otra pestana'))
  await professional.click('reject')
  await patient.wait(`document.querySelector('#status').textContent.includes('rechazo')`)
  assert.equal(await patient.evaluate(`document.querySelector('#local').srcObject===null`), true)
  await professional.click('end')
  await professional.wait(`document.querySelector('#status').textContent.includes('finalizo')`)
  await professional.evaluate(`document.querySelector('#duration').value='1'`)
  await professional.click('create')
  await professional.wait(`document.querySelector('#link').value!==${JSON.stringify(nextInvite)}`)
  const timedInvite = await professional.evaluate(`document.querySelector('#link').value`)
  await professional.click('camera')
  await professional.wait(`document.querySelector('#camera').getAttribute('aria-pressed')==='true'`)
  await professional.click('join')
  await patient.navigate(timedInvite)
  await patient.wait(`document.querySelector('#identity')?.textContent.includes('paciente')`)
  assert.equal(await patient.evaluate(`document.querySelector('#duration-panel').hidden`), true)
  await patient.click('consent')
  await patient.click('devices')
  await patient.click('join')
  await professional.wait(`!document.querySelector('#admit').hidden`)
  await professional.click('admit')
  for (const client of [professional, patient]) {
    await client.wait(`document.querySelector('#status').textContent.includes('conectados por WebRTC')`)
    assert.match(await client.evaluate(`document.querySelector('#time-warning').textContent`), /5 minutos o menos/)
    await client.evaluate(`void(window.__timedTracks=document.querySelector('#local').srcObject.getTracks())`)
  }
  assert.equal(await professional.evaluate(`document.querySelector('#local').srcObject.getAudioTracks().length`), 0, 'Video-only entry needs no microphone')
  await professional.click('mic')
  await professional.wait(`document.querySelector('#mic').getAttribute('aria-pressed')==='true'`)
  await patient.wait(`document.querySelector('#remote').srcObject.getAudioTracks().some(t=>!t.muted)`)
  await professional.evaluate(`void(window.__timedTracks=document.querySelector('#local').srcObject.getTracks())`)
  clockOffset += 60_000
  for (const client of [professional, patient]) {
    await client.wait(`/duraci[oó]n elegida/.test(document.querySelector('#status').textContent)`)
    assert.equal(await client.evaluate(`window.__timedTracks.every(t=>t.readyState==='ended')`), true, 'Timed expiry stops all devices')
  }
  await professional.command('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true })
  assert.equal(await professional.evaluate(`document.documentElement.scrollWidth<=390`), true, 'No horizontal overflow on mobile')
  await professional.click('logout')
  await professional.wait(`!document.querySelector('#login-panel').hidden`)
  assert.equal(await professional.evaluate(`document.querySelector('#create').hidden`), true)
  console.log('PASS: independent camera/mic icons, camera denial preserves mic, camera off releases capture, audio-only/video-only entry and adding the other device live, mouse/touch/keyboard PiP drag and resize bounds, waiting logo/reduced motion; duration, expiry releases devices, WebRTC tracks/frames, chat, admission, readmission, rejection and mobile layout.')
} finally {
  await app.close()
  for (const socket of sockets) socket.close()
  browser.kill()
  await new Promise(resolve => browser.exitCode !== null ? resolve() : browser.once('exit', resolve))
  for (let attempt = 0; attempt < 20; attempt++) {
    try { await rm(profile, { recursive: true, force: true }); break }
    catch (error) {
      if (!['EBUSY', 'EPERM', 'ENOTEMPTY'].includes(error.code) || attempt === 19) throw error
      await sleep(200)
    }
  }
}
