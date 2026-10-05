import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createVideoServer } from './videoServer.mjs'

const origin = 'http://127.0.0.1:5195'
let clockOffset = 0
const handoffs = new Set(['a'.repeat(64), 'b'.repeat(64)])
const lifecycleEvents = []
const fixturePatients = [
  { id: 'synthetic-patient-1', name: 'Paciente de prueba Uno' },
  { id: 'synthetic-patient-2', name: 'Paciente de prueba Dos' },
]
const fixtureAppointments = [
  { id: 'synthetic-appointment-1', patientId: 'synthetic-patient-1', label: 'Turno de prueba Uno' },
  { id: 'synthetic-appointment-2', patientId: 'synthetic-patient-2', label: 'Turno de prueba Dos' },
]
const summaryCalls = []
const savedSummaries = []
const app = createVideoServer({
  origin, iceServers: [],
  now: () => Date.now() + clockOffset,
  listPatients: async () => ({ patients: fixturePatients, appointments: fixtureAppointments }),
  createConsultation: async (_session, data) => {
    const patient = fixturePatients.find(item => item.id === data.patientId)
    if (!patient || (data.appointmentId && !fixtureAppointments.some(item =>
      item.id === data.appointmentId && item.patientId === data.patientId))) {
      throw Object.assign(new Error('Paciente o turno de prueba invalido.'), { status: 403 })
    }
    return { consultationId: '7c1e4b2a-9d3f-4a6b-8e5c-1f2a3b4c5d6e', patientName: patient.name, lifecycleToken: 'd'.repeat(64) }
  },
  summarizeConsultation: async (_session, data) => {
    summaryCalls.push(data)
    return { motivoConsulta: 'Control semanal', detalleAtencion: 'Refiere estar mucho mejor.', planManejo: 'Control en una semana.' }
  },
  saveConsultationSummary: async (_session, data) => { savedSummaries.push(data); return { ok: true } },
  recordConsultationEvent: async (_token, event) => { lifecycleEvents.push(event); return { ok: true } },
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
  await command('Page.addScriptToEvaluateOnNewDocument', { source: `
    window.__testInstance=String(Date.now())+String(Math.random())
    window.__captureRequests=0
    window.__patientListRequests=0
    window.__roomCreateBody=null
    const originalFetch=window.fetch.bind(window)
    window.fetch=async (input,init={})=>{
      const path=new URL(typeof input==='string'?input:input.url,location.href).pathname
      if(path==='/api/patients')window.__patientListRequests++
      if(path==='/api/rooms'&&init.method==='POST'){
        window.__roomCreateBody=JSON.parse(init.body)
      }
      return originalFetch(input,init)
    }
    if(navigator.mediaDevices){
      const capture=navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices)
      navigator.mediaDevices.getUserMedia=(...args)=>{window.__captureRequests++;return capture(...args)}
    }
  ` })
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
  assert.equal(await professional.evaluate(`Array.from(document.querySelectorAll('.heading,.help,.muted,#stage-message,#status')).some(e=>/piloto|prueba/i.test(e.textContent))`), false, 'User-facing branding and help contain no pilot/trial wording')
  assert.equal(await professional.evaluate(`navigator.mediaDevices!==undefined`), true)
  assert.equal(await professional.evaluate(`document.querySelector('#create').hidden`), true, 'Anonymous cannot create a room')
  await professional.navigate(`${origin}/#handoff=${'c'.repeat(64)}`)
  await professional.wait(`document.querySelector('#error').textContent.includes('pase vencio')&&!document.querySelector('#login-panel').hidden`)
  assert.equal(await professional.evaluate('location.hash'), '', 'Failed pass removed immediately from address bar')
  assert.equal(await professional.evaluate(`document.querySelector('#create').hidden`), true)
  await professional.evaluate(`document.querySelector('#username').value='test-admin';document.querySelector('#password').value='test-password'`)
  await professional.click('login-submit')
  await professional.wait(`!document.querySelector('#create').hidden`)
  await professional.wait(`document.querySelector('#patient-select').options.length===3`)
  const mobileControlStyles = `['patient-select','appointment-select','link','text','duration','username','password'].map(id=>{const e=document.getElementById(id),s=getComputedStyle(e);return {id,fontSize:parseFloat(s.fontSize),minWidth:s.minWidth,maxWidth:s.maxWidth}})`
  for (const [width, height] of [[390, 844], [844, 390]]) {
    await professional.command('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: true })
    await professional.command('Emulation.setTouchEmulationEnabled', { enabled: true })
    const styles = await professional.evaluate(mobileControlStyles)
    assert(styles.every(style => style.fontSize >= 16 && style.minWidth === '0px' && style.maxWidth === '100%'), 'Mobile/coarse form controls prevent focus zoom without losing width guards: ' + JSON.stringify(styles))
    assert.equal(await professional.evaluate(`document.documentElement.scrollWidth<=innerWidth`), true, 'Patient and appointment selectors fit the mobile viewport')
    console.log('MOBILE FOCUS GUARD:', JSON.stringify({ viewport: [width, height], styles }))
  }
  const viewportPolicy = await professional.evaluate(`document.querySelector('meta[name=viewport]').content`)
  assert.equal(/user-scalable\s*=\s*no|maximum-scale/i.test(viewportPolicy), false, 'Manual pinch zoom is not restricted')
  await professional.command('Emulation.setTouchEmulationEnabled', { enabled: false })
  await professional.command('Emulation.setDeviceMetricsOverride', { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false })
  assert.equal(await professional.evaluate(`document.querySelector('#create').disabled&&document.querySelector('#patient-selection').hidden===false`), true, 'Creation waits for an explicit patient selection')
  assert.equal(await professional.evaluate(`document.querySelector('#consent')===null`), true, 'No technical-trial checkbox gates room access')
  await professional.click('logout')
  await professional.wait(`!document.querySelector('#login-panel').hidden`)
  await professional.navigate(`${origin}/#handoff=${'a'.repeat(64)}`)
  await professional.wait(`!document.querySelector('#create').hidden&&document.querySelector('#login-panel').hidden`)
  assert.equal(await professional.evaluate('location.hash'), '', 'Automatic access consumes and removes fragment without password')
  await professional.navigate(`${origin}/#handoff=${'a'.repeat(64)}`)
  await professional.wait(`document.querySelector('#error').textContent.includes('pase vencio')`)
  assert.equal(await professional.evaluate(`document.querySelector('#create').hidden`), true, 'Reused pass cannot claim successful authorization')
  await professional.navigate(`${origin}/#handoff=${'b'.repeat(64)}&patient=synthetic-patient-2&appointment=synthetic-appointment-2`)
  await professional.wait(`!document.querySelector('#create').hidden`)
  await professional.wait(`document.querySelector('#patient-select').value==='synthetic-patient-2'&&document.querySelector('#appointment-select').value==='synthetic-appointment-2'`)
  assert.equal(await professional.evaluate(`document.querySelector('#patient-selection').hidden`), false, 'Only the professional gets the patient selector')
  assert.equal(await professional.evaluate(`document.querySelector('#duration').value`), '40')
  await professional.evaluate(`document.querySelector('#duration').value='121'`)
  await professional.click('create')
  await professional.wait(`document.querySelector('#error').textContent.includes('entre 1 y 120')`)
  assert.equal(await professional.evaluate(`document.querySelector('#link').value`), '')
  await professional.evaluate(`document.querySelector('#duration').value='40'`)
  await professional.click('create')
  await professional.wait(`document.querySelector('#link').value.includes('#p=')`)
  const invite = await professional.evaluate(`document.querySelector('#link').value`)
  assert.deepEqual(await professional.evaluate(`window.__roomCreateBody`), {
    durationMinutes: 40, patientId: 'synthetic-patient-2', appointmentId: 'synthetic-appointment-2',
  }, 'Room creation sends selected patient and appointment IDs')
  assert.equal(await professional.evaluate(`document.querySelector('#patient-name').textContent`), 'Paciente: Paciente de prueba Dos')
  assert.equal(invite.includes('synthetic-patient') || invite.includes('Paciente de prueba'), false, 'Private invite contains no patient identity')
  assert.match(await professional.evaluate(`document.querySelector('#countdown').textContent`), /40 minutos.*Sin iniciar/)
  const patientTab = await fetch(`http://127.0.0.1:${port}/json/new?about:blank`, { method: 'PUT' }).then(response => response.json())
  const patient = await attach(patientTab)
  await patient.navigate(invite)
  await patient.wait(`document.querySelector('#identity')?.textContent.includes('paciente')`)
  assert.equal(await patient.evaluate('location.hash'), '', 'Invitation removed from visible URL')
  assert.equal(await patient.evaluate(`document.querySelector('#patient-selection').hidden`), true, 'Patient role never gets a patient list')
  assert.equal(await patient.evaluate(`window.__patientListRequests`), 0, 'Patient role never requests the patient list')
  assert(invite.length <= 56, 'Private patient link is short enough for easy sharing')
  assert.equal(await professional.evaluate(`document.querySelector('#duration').disabled`), true, 'Existing room duration cannot be misleadingly edited')
  for (const [width, height, mobile] of [[360, 740, true], [390, 844, true], [768, 1024, false], [1280, 900, false]]) {
    await professional.command('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile })
    assert.equal(await professional.evaluate(`document.documentElement.scrollWidth<=${width}`), true, 'Compact creation toolbar never overflows viewport')
    assert(await professional.evaluate(`(()=>{const c=document.querySelector('#create').getBoundingClientRect(),j=document.querySelector('#join').getBoundingClientRect(),s=document.querySelector('#stage').getBoundingClientRect(),d=document.querySelector('#duration').getBoundingClientRect();return Math.abs(c.top-j.top)<1&&s.top>=c.bottom&&s.top-c.bottom<20&&d.width<=72})()`), 'Create/Enter stay together immediately above video and duration stays compact')
    if (process.env.VIDEO_SCREENSHOT_DIR) {
      const image = await professional.command('Page.captureScreenshot', { format: 'png' })
      await writeFile(join(process.env.VIDEO_SCREENSHOT_DIR, `video-v6-room-${width}.png`), Buffer.from(image.data, 'base64'))
    }
  }
  await professional.command('Emulation.setDeviceMetricsOverride', { width: 844, height: 390, deviceScaleFactor: 1, mobile: true })
  assert(await professional.evaluate(`(()=>{const s=document.querySelector('#stage'),f=document.querySelector('#fullscreen');return s.getBoundingClientRect().height>=170&&f.closest('.video-controls')!==null})()`), 'Mobile landscape retains a useful video area and an in-video expand control')
  await professional.command('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true })
  await professional.evaluate(`Object.defineProperty(navigator.clipboard,'writeText',{configurable:true,value:async value=>{window.__copiedInvite=value}})`)
  await professional.click('copy')
  assert.equal(await professional.evaluate('window.__copiedInvite'), invite, 'Copy uses complete short private link')
  if (await professional.evaluate(`!document.querySelector('#share').hidden`)) {
    await professional.evaluate(`navigator.share=async data=>{window.__sharedInvite=data}`)
    await professional.click('share')
    assert.equal(await professional.evaluate('window.__sharedInvite.url'), invite, 'Native share uses same private link')
  }
  for (const client of [professional, patient]) assert.equal(await client.evaluate(`window.__captureRequests`), 0)
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
  await duplicate.click('devices')
  await duplicate.click('join')
  await duplicate.wait(`document.querySelector('#error').textContent.includes('otra pestana')`)
  assert.equal(await duplicate.evaluate(`document.querySelector('#local').srcObject===null`), true, 'Failed join releases devices')
  const fullFit = ids => `(()=>{const room=document.querySelector('#room-view'),s=document.querySelector('#stage').getBoundingClientRect(),vh=window.visualViewport?.height||innerHeight;const hits=${JSON.stringify(ids)}.concat(document.querySelector('#play-audio').hidden?[]:['play-audio']).map(id=>{const e=document.getElementById(id),r=e.getBoundingClientRect(),h=document.elementFromPoint(r.left+r.width/2,r.top+r.height/2);return {id,top:Math.round(r.top*100)/100,bottom:Math.round(r.bottom*100)/100,ok:!e.hidden&&r.width>0&&r.top>=0&&r.bottom<=vh&&(e===h||e.contains(h))}});return {container:document.fullscreenElement?.id||(document.body.classList.contains('expanded-page')?'expanded-page':null),viewport:[innerWidth,innerHeight],video:{width:s.width,height:s.height,top:s.top,bottom:s.bottom,marginTop:s.top,marginBottom:vh-s.bottom},room:{scrollHeight:room.scrollHeight,clientHeight:room.clientHeight},documentOverflow:document.documentElement.scrollHeight-innerHeight,hits}})()`
  const assertFullFit = (shape, label) => {
    console.log(label + ':', JSON.stringify(shape))
    assert(shape.video.top >= 0 && shape.video.bottom <= shape.viewport[1], label + ' video fully visible')
    assert(shape.room.scrollHeight <= shape.room.clientHeight + 1, label + ' room has no vertical scroll')
    assert(shape.hits.every(hit => hit.ok), label + ' controls visible and hit-testable: ' + JSON.stringify(shape.hits.filter(hit => !hit.ok)))
  }
  await professional.command('Page.bringToFront')
  await professional.click('fullscreen')
  await professional.wait(`document.fullscreenElement===document.querySelector('#room-view')`)
  assert.equal(await professional.evaluate(`['admit','reject','waiting','status'].every(id=>{const e=document.getElementById(id),r=e.getBoundingClientRect();return document.fullscreenElement.contains(e)&&!e.hidden&&r.top>=0&&r.bottom<=innerHeight})`), true, 'Native fullscreen shows admission, rejection and waiting/status before admission')
  await professional.click('fullscreen')
  await professional.wait(`document.fullscreenElement===null`)
  await professional.command('Emulation.setDeviceMetricsOverride', { width: 844, height: 390, deviceScaleFactor: 1, mobile: true })
  await professional.click('fullscreen')
  await professional.wait(`document.fullscreenElement===document.querySelector('#room-view')`)
  await professional.evaluate(`window.dispatchEvent(new Event('resize'))`)
  assertFullFit(await professional.evaluate(fullFit(['admit', 'reject', 'waiting', 'status', 'leave', 'end', 'mic', 'camera', 'fullscreen', 'chat-toggle'])), 'NATIVE LANDSCAPE FULLSCREEN BEFORE ADMISSION')
  await professional.click('fullscreen')
  await professional.wait(`document.fullscreenElement===null`)
  await professional.command('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true })
  await professional.click('admit')
  await professional.wait(`document.querySelector('#status').textContent.includes('conectados por WebRTC')&&!document.querySelector('#send').disabled`)
  await patient.wait(`document.querySelector('#status').textContent.includes('conectados por WebRTC')&&!document.querySelector('#send').disabled`)
  for (const client of [professional, patient]) {
    assert.equal(await client.evaluate(`window.__captureRequests`), 0, 'Admission without devices never requests capture')
    assert.equal(await client.evaluate(`document.querySelector('#mic').getAttribute('aria-pressed')==='false'&&document.querySelector('#camera').getAttribute('aria-pressed')==='false'`), true)
    assert.equal(await client.evaluate(`document.querySelector('#self-preview').hidden`), true)
  }
  assert(lifecycleEvents.includes('start'), 'Current server persists start before successful admission')
  const fullscreenControls = ['leave', 'end', 'status', 'waiting', 'admit', 'reject', 'countdown', 'error',
    'chat-toggle', 'chat-panel', 'chat-close', 'text', 'send', 'mic', 'camera', 'fullscreen', 'play-audio']
  assert.equal(await professional.evaluate(`${JSON.stringify(fullscreenControls)}.every(id=>document.querySelector('#room-view').contains(document.getElementById(id)))`), true, 'Fullscreen container owns all room controls, admission and status')
  for (const [width, height] of [[390, 844], [844, 390]]) {
    await professional.command('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: true })
    const geometry = await professional.evaluate(`(()=>{const r=document.querySelector('#stage').getBoundingClientRect();return {viewport:[innerWidth,innerHeight],video:{width:r.width,height:r.height},old25svh:innerHeight*.25,oldClamped:Math.max(180,Math.min(300,innerHeight*.25))}})()`)
    assert(geometry.video.height >= geometry.oldClamped * 1.2, 'Video is at least 20% larger than the previous mobile height: ' + JSON.stringify(geometry))
    console.log('ROOM GEOMETRY:', JSON.stringify(geometry))
  }
  await professional.command('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true })
  await professional.command('Page.bringToFront')
  const nativeSupported = await professional.evaluate(`document.fullscreenEnabled&&typeof document.querySelector('#room-view').requestFullscreen==='function'`)
  assert(nativeSupported, 'This Edge runner must exercise native fullscreen, not just a mock')
  await professional.click('fullscreen')
  await professional.wait(`document.fullscreenElement===document.querySelector('#room-view')`)
  await professional.click('chat-toggle')
  const nativeShape = await professional.evaluate(`(()=>{const f=document.fullscreenElement.getBoundingClientRect(),s=document.querySelector('#stage').getBoundingClientRect(),p=document.querySelector('#chat-panel').getBoundingClientRect();return {container:document.fullscreenElement.id,viewport:[innerWidth,innerHeight],room:{width:f.width,height:f.height},video:{width:s.width,height:s.height},chat:{left:p.left,top:p.top,right:p.right,bottom:p.bottom},allControls:${JSON.stringify(fullscreenControls)}.every(id=>document.fullscreenElement.contains(document.getElementById(id)))}})()`)
  assert(nativeShape.allControls)
  assert(nativeShape.chat.left >= 0 && nativeShape.chat.right <= nativeShape.room.width && nativeShape.chat.bottom <= nativeShape.room.height)
  const controlsUncovered = `['leave','end','mic','camera','chat-toggle','chat-close','text','send'].every(id=>{const e=document.getElementById(id),r=e.getBoundingClientRect();const hit=document.elementFromPoint(r.left+r.width/2,r.top+r.height/2);return !e.hidden&&r.top>=0&&r.bottom<=innerHeight&&(e===hit||e.contains(hit))})`
  assert.equal(await professional.evaluate(controlsUncovered), true, 'Native portrait fullscreen chat never covers leave/end or camera/microphone and editor remains actionable')
  console.log('NATIVE FULLSCREEN:', JSON.stringify(nativeShape))
  await professional.evaluate(`void(window.__realViewport=window.visualViewport);Object.defineProperty(window,'visualViewport',{configurable:true,value:Object.assign(new EventTarget(),{offsetTop:0,offsetLeft:0,width:390,height:450})});window.dispatchEvent(new Event('resize'))`)
  const keyboardShape = await professional.evaluate(`(()=>{const p=document.querySelector('#chat-panel').getBoundingClientRect(),e=document.querySelector('#text').getBoundingClientRect();return {panel:{left:p.left,top:p.top,right:p.right,bottom:p.bottom},editorBottom:e.bottom}})()`)
  assert(keyboardShape.panel.left >= 10 && keyboardShape.panel.right <= 380 && keyboardShape.panel.bottom <= 440 && keyboardShape.editorBottom <= 440, 'Fullscreen chat/editor fit the keyboard-reduced visual viewport')
  console.log('FULLSCREEN KEYBOARD (simulated visual viewport 390x450):', JSON.stringify(keyboardShape))
  await professional.evaluate(`Object.defineProperty(window,'visualViewport',{configurable:true,value:window.__realViewport});window.dispatchEvent(new Event('resize'))`)
  await professional.command('Emulation.setDeviceMetricsOverride', { width: 844, height: 390, deviceScaleFactor: 1, mobile: true })
  await professional.evaluate(`document.querySelector('#room-view').scrollTop=0;window.dispatchEvent(new Event('resize'))`)
  await professional.click('chat-close')
  const admittedLandscape = await professional.evaluate(fullFit(['leave', 'end', 'mic', 'camera', 'fullscreen', 'chat-toggle']))
  assertFullFit(admittedLandscape, 'NATIVE LANDSCAPE FULLSCREEN ADMITTED')
  assert(admittedLandscape.video.height > 220, 'Admitted landscape fullscreen video exceeds the former fixed 220px stage')
  await professional.click('chat-toggle')
  const nativeLandscape = await professional.evaluate(`(()=>{const s=document.querySelector('#stage').getBoundingClientRect(),p=document.querySelector('#chat-panel').getBoundingClientRect();return {container:document.fullscreenElement?.id,viewport:[innerWidth,innerHeight],video:{width:s.width,height:s.height,top:s.top,bottom:s.bottom},chat:{top:p.top,bottom:p.bottom},editorBottom:document.querySelector('#text').getBoundingClientRect().bottom}})()`)
  assert.equal(nativeLandscape.container, 'room-view')
  assert(nativeLandscape.chat.bottom <= 390 && nativeLandscape.editorBottom <= 390)
  assert.equal(await professional.evaluate(controlsUncovered), true, 'Native landscape fullscreen keeps room actions/media controls and chat editor clickable: ' + JSON.stringify(await professional.evaluate(`['leave','end','mic','camera','chat-close','text','send'].map(id=>{const e=document.getElementById(id),r=e.getBoundingClientRect();return {id,top:r.top,bottom:r.bottom,hit:document.elementFromPoint(r.left+r.width/2,r.top+r.height/2)?.id}})`)))
  console.log('NATIVE LANDSCAPE FULLSCREEN:', JSON.stringify(nativeLandscape))
  await professional.command('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true })
  await professional.evaluate(`window.dispatchEvent(new Event('resize'))`)
  await professional.click('chat-close')
  await professional.click('fullscreen')
  await professional.wait(`document.fullscreenElement===null`)
  await professional.evaluate(`Object.defineProperty(document,'fullscreenEnabled',{configurable:true,value:false});window.scrollTo(0,80);document.querySelector('#fullscreen').focus({preventScroll:true});window.__expandedScroll=scrollY`)
  await professional.click('fullscreen')
  assert.equal(await professional.evaluate(`document.body.classList.contains('expanded-page')&&document.querySelector('#fullscreen').getAttribute('aria-pressed')==='true'`), true, 'Unsupported native fullscreen uses expanded-page fallback')
  assert.equal(await professional.evaluate(`!document.querySelector('#leave').hidden&&!document.querySelector('#end').hidden&&!document.querySelector('#chat-toggle').hidden`), true, 'Leave, end and chat stay available in expanded-page mode')
  await professional.click('chat-toggle')
  assert.equal(await professional.evaluate(controlsUncovered), true, 'Expanded-page fallback keeps the same actionable controls as native fullscreen')
  console.log('EXPANDED-PAGE FALLBACK:', JSON.stringify(await professional.evaluate(`(()=>{const r=document.querySelector('#room-view').getBoundingClientRect(),s=document.querySelector('#stage').getBoundingClientRect();return {nativeElement:document.fullscreenElement,room:{width:r.width,height:r.height},video:{width:s.width,height:s.height},originalScroll:window.__expandedScroll}})()`)))
  await professional.command('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 })
  assert.equal(await professional.evaluate(`!document.body.classList.contains('expanded-page')&&scrollY===window.__expandedScroll&&document.activeElement===document.querySelector('#fullscreen')`), true, 'Fallback Escape restores original scroll and focus')
  assert.equal(await professional.evaluate(`document.querySelector('#chat-panel').hidden`), true, 'Fallback Escape closes chat')
  await professional.command('Emulation.setDeviceMetricsOverride', { width: 844, height: 390, deviceScaleFactor: 1, mobile: true })
  await professional.click('fullscreen')
  assert.equal(await professional.evaluate(`document.body.classList.contains('expanded-page')&&document.fullscreenElement===null`), true)
  assertFullFit(await professional.evaluate(fullFit(['leave', 'end', 'mic', 'camera', 'fullscreen', 'chat-toggle'])), 'EXPANDED-PAGE LANDSCAPE FALLBACK ADMITTED')
  await professional.command('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 })
  await professional.command('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true })
  await professional.evaluate(`delete document.fullscreenEnabled;window.scrollTo(0,0)`)
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
  for (const client of [professional, patient]) {
    assert.match(await client.evaluate(`document.querySelector('#countdown').textContent`), /40 minutos.*Tiempo restante: (40:00|39:\d\d)/)
    assert.deepEqual(await client.evaluate(`(()=>{const l=document.querySelector('#local').srcObject,r=document.querySelector('#remote').srcObject;return{localAudio:l.getAudioTracks().length,remoteAudio:r.getAudioTracks().length,remoteVideo:r.getVideoTracks().length,separate:l.getAudioTracks()[0]!==r.getAudioTracks()[0]}})()`),
      { localAudio: 1, remoteAudio: 1, remoteVideo: 1, separate: true })
    await client.wait(`document.querySelector('#remote').videoWidth>0`)
  }
  assert.equal(await patient.evaluate(`document.querySelector('#transcribe').hidden&&document.querySelector('#transcript-notice').hidden`), true, 'Patient cannot transcribe and sees no notice before it starts')
  assert.equal(await professional.evaluate(`!document.querySelector('#transcribe').hidden&&document.querySelector('#transcript-panel').hidden`), true, 'Professional can start transcription once admitted')
  await professional.evaluate(`window.webkitSpeechRecognition=undefined;window.SpeechRecognition=class{static async available(){return 'unavailable'}};window.SpeechRecognition.prototype.processLocally=false;window.confirm=()=>true`)
  await professional.click('transcribe')
  await professional.wait(`document.querySelector('#error').textContent.includes('no tiene reconocimiento de voz en español')`)
  assert.equal(await patient.evaluate(`document.querySelector('#transcript-notice').hidden`), true, 'No notice when local recognition is unavailable')
  await professional.evaluate(`window.__recs=[];window.SpeechRecognition=class{constructor(){window.__recs.push(this)}start(track){this.track=track}stop(){this.stopped=true}static async available({langs,processLocally}){return processLocally===true&&langs[0]==='es-AR'?'available':'unavailable'}};window.SpeechRecognition.prototype.processLocally=false;window.__confirmed=0;window.confirm=()=>{window.__confirmed++;return true}`)
  await professional.click('transcribe')
  await patient.wait(`!document.querySelector('#transcript-notice').hidden`)
  await professional.wait(`window.__recs.length===2`)
  assert.deepEqual(await professional.evaluate(`(()=>{const l=document.querySelector('#local').srcObject.getAudioTracks()[0],r=document.querySelector('#remote').srcObject.getAudioTracks()[0];return{confirmed:window.__confirmed,local:window.__recs[0].track===l,remote:window.__recs[1].track===r,processLocally:window.__recs.every(x=>x.processLocally===true&&x.lang==='es-AR'&&x.continuous)}})()`),
    { confirmed: 1, local: true, remote: true, processLocally: true }, 'Professional microphone and patient audio use separate on-device recognizers')
  await professional.evaluate(`(()=>{const res=t=>Object.assign([{transcript:t}],{isFinal:true});window.__recs[1].onspeechstart();window.__recs[0].onresult({resultIndex:0,results:[res('¿Cómo estuviste esta semana?')]});window.__recs[1].onresult({resultIndex:0,results:[res('Mucho mejor, gracias')]})})()`)
  await professional.wait(`document.querySelector('#transcript-status').textContent.includes('2 fragmentos')`)
  assert.equal(await professional.evaluate(`document.body.innerText.includes('Mucho mejor')`), false, 'Transcribed text is not shown on screen')
  await professional.click('transcribe')
  await patient.wait(`document.querySelector('#transcript-notice').hidden`)
  assert.equal(await professional.evaluate(`window.__recs.every(x=>x.stopped)&&!document.querySelector('#transcript-download-professional').hidden&&!document.querySelector('#transcript-download-patient').hidden`), true, 'Stopping halts both recognizers and offers both downloads')
  const grab = id => professional.evaluate(`new Promise(resolve=>{const original=URL.createObjectURL;URL.createObjectURL=blob=>{blob.text().then(resolve);URL.createObjectURL=original;return 'blob:test'};HTMLAnchorElement.prototype.__click=HTMLAnchorElement.prototype.click;HTMLAnchorElement.prototype.click=function(){window.__download=this.download;HTMLAnchorElement.prototype.click=HTMLAnchorElement.prototype.__click};document.querySelector('#${id}').click()})`)
  const professionalFile = await grab('transcript-download-professional')
  assert.match(await professional.evaluate('window.__download'), /^transcripcion-profesional-\d{4}-\d{2}-\d{2}-\d{4}\.txt$/)
  const patientFile = await grab('transcript-download-patient')
  assert.match(await professional.evaluate('window.__download'), /^transcripcion-paciente-\d{4}-\d{2}-\d{2}-\d{4}\.txt$/)
  for (const file of [professionalFile, patientFile]) {
    assert.match(file, /Paciente: Paciente de prueba Dos/)
    assert.match(file, /Inicio: \d{2}\/\d{2}\/\d{4}, ([01]\d|2[0-3]):\d{2}/)
  }
  assert.match(professionalFile, /Canal: Profesional\n[\s\S]*\] ¿Cómo estuviste esta semana\?/)
  assert.ok(!professionalFile.includes('Mucho mejor'), 'Professional file only has professional speech')
  assert.match(patientFile, /Canal: Paciente\n[\s\S]*\] Mucho mejor, gracias/)
  assert.ok(!patientFile.includes('Cómo estuviste'), 'Patient file only has patient speech')
  assert.equal(await professional.evaluate(`!document.querySelector('#transcript-summarize').hidden&&document.querySelector('#transcript-discard').textContent==='Finalizar sin resumir'`), true, 'Professional can summarize with Sofia or finish without summarizing')
  await professional.click('transcript-summarize')
  await professional.wait(`!document.querySelector('#summary-editor').hidden`)
  assert.equal(summaryCalls.length, 1)
  assert.equal(summaryCalls[0].consultationId, '7c1e4b2a-9d3f-4a6b-8e5c-1f2a3b4c5d6e')
  assert.match(summaryCalls[0].professional, /^\[\d{2}:\d{2}\] ¿Cómo estuviste esta semana\?$/)
  assert.match(summaryCalls[0].patient, /^\[\d{2}:\d{2}\] Mucho mejor, gracias$/)
  assert.deepEqual(await professional.evaluate(`[...document.querySelectorAll('#summary-editor textarea')].map(x=>x.value)`),
    ['Control semanal', 'Refiere estar mucho mejor.', 'Control en una semana.'], 'Sofia draft is shown for review')
  assert.equal(await professional.evaluate(`document.querySelector('#transcript-summarize').hidden`), true, 'No second summary while reviewing')
  await professional.click('summary-cancel')
  assert.equal(await professional.evaluate(`document.querySelector('#summary-editor').hidden&&!document.querySelector('#transcript-summarize').hidden`), true, 'Discarding the draft keeps the transcript')
  await professional.click('transcript-summarize')
  await professional.wait(`!document.querySelector('#summary-editor').hidden`)
  await professional.evaluate(`document.querySelector('#summary-detail').value='Refiere estar mucho mejor. Corregido por el profesional.'`)
  await professional.click('summary-save')
  await professional.wait(`!document.querySelector('#summary-saved').hidden`)
  assert.deepEqual(savedSummaries, [{ consultationId: '7c1e4b2a-9d3f-4a6b-8e5c-1f2a3b4c5d6e', motivoConsulta: 'Control semanal',
    detalleAtencion: 'Refiere estar mucho mejor. Corregido por el profesional.', planManejo: 'Control en una semana.' }], 'Reviewed summary is saved')
  assert.equal(await professional.evaluate(`document.querySelector('#transcript-panel').hidden&&document.querySelector('#summary-editor').hidden&&document.querySelector('#summary-saved').textContent.includes('Paciente de prueba Dos')`), true, 'Saving clears the local transcript')
  await professional.click('transcribe')
  await professional.wait(`window.__recs.length===4`)
  await professional.evaluate(`window.__recs[2].onresult({resultIndex:0,results:[Object.assign([{transcript:'Nos vemos la semana que viene'}],{isFinal:true})]})`)
  await professional.wait(`document.querySelector('#transcript-status').textContent.includes('1 fragmento')`)
  await professional.click('transcribe')
  await professional.wait(`!document.querySelector('#transcript-discard').hidden`)
  await professional.click('transcript-discard')
  assert.equal(await professional.evaluate(`document.querySelector('#transcript-panel').hidden&&document.querySelector('#transcribe').getAttribute('aria-label')==='Transcribir consulta'`), true, 'Finishing without summary clears transcript from memory')
  assert.equal(summaryCalls.length, 2, 'Finishing without summary does not call Sofia')
  console.log('TRANSCRIPTION: on-device recognizers per speaker, patient notice, hidden text, downloads, Sofia review/save and finish without summary verified with a simulated local engine.')
  await professional.click('chat-toggle')
  await professional.evaluate(`document.querySelector('#text').value='Hola desde profesional de prueba'`)
  await professional.click('send')
  await patient.wait(`document.querySelector('#messages').textContent.includes('Hola desde profesional de prueba')`)
  await professional.wait(`document.querySelector('#messages').textContent.includes('Recibido por el otro navegador')`)
  assert.equal(await patient.evaluate(`document.querySelector('#chat-panel').hidden&&document.querySelector('#chat-badge').textContent==='1'&&!document.querySelector('#chat-badge').hidden`), true, 'Closed chat shows unread message without opening or scrolling')
  for (let index = 0; index < 12; index++) {
    await professional.evaluate(`document.querySelector('#text').value=${JSON.stringify('Mensaje de prueba de scroll interno ')}+${index};document.querySelector('#chat').requestSubmit()`)
    await professional.wait(`Array.from(document.querySelectorAll('#messages small')).at(-1).textContent.includes('Recibido')`)
  }
  await patient.wait(`document.querySelector('#chat-badge').textContent==='13'`)
  for (const [width, height, mobile] of [[360, 740, true], [390, 844, true], [1280, 900, false]]) {
    await professional.command('Page.bringToFront')
    await professional.command('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile })
    await professional.evaluate(`window.scrollTo(0,0)`)
    await professional.wait(`(()=>{const p=document.querySelector('#chat-panel').getBoundingClientRect(),d=document.querySelector('#chat-toggle').getBoundingClientRect();return p.bottom<=${height}&&Math.abs(p.width-d.width)<1})()`)
    const panel = await professional.evaluate(`(()=>{const p=document.querySelector('#chat-panel').getBoundingClientRect(),s=document.querySelector('#stage').getBoundingClientRect();return{top:p.top,bottom:p.bottom,stageBottom:s.bottom}})()`)
    assert(panel.top >= 0 && panel.bottom <= height, 'Professional floating chat stays within viewport: ' + JSON.stringify({ width, height, ...panel }))
    assert(await professional.evaluate(`document.querySelector('#end').getBoundingClientRect().bottom<=document.querySelector('#stage').getBoundingClientRect().top`), 'Open chat never covers finalization control above video')
  }
  await professional.command('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true })
  for (const [width, height, mobile] of [[390, 844, true], [1280, 900, false]]) {
    await patient.command('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile })
    await patient.evaluate(`window.scrollTo(0,0)`)
    const geometry = await patient.evaluate(`(()=>{const r=document.querySelector('#stage').getBoundingClientRect();return{top:r.top,height:r.height,scroll:scrollY,documentHeight:document.documentElement.scrollHeight}})()`)
    await patient.click('chat-toggle')
    await patient.wait(`!document.querySelector('#chat-panel').hidden`)
    const expanded = await patient.evaluate(`(()=>{const s=document.querySelector('#stage').getBoundingClientRect(),p=document.querySelector('#chat-panel').getBoundingClientRect();return{top:s.top,height:s.height,scroll:scrollY,documentHeight:document.documentElement.scrollHeight,panelTop:p.top,panelBottom:p.bottom,stageBottom:s.bottom}})()`)
    assert.equal(expanded.top, geometry.top, 'Opening chat never moves video')
    assert.equal(expanded.height, geometry.height, 'Opening chat never shrinks video')
    assert.equal(expanded.scroll, geometry.scroll, 'Opening chat never scrolls page')
    assert.equal(expanded.documentHeight, geometry.documentHeight, 'Chat expansion never grows document')
    assert(expanded.panelTop >= 0 && expanded.panelBottom <= height, 'Drawer stays inside viewport without resizing the larger video')
    assert.equal(await patient.evaluate(`document.querySelector('#messages').scrollHeight>document.querySelector('#messages').clientHeight`), true, 'Long conversations scroll within messages only')
    await patient.evaluate(`document.querySelector('#messages').scrollTop=0`)
    assert.equal(await patient.evaluate('scrollY'), geometry.scroll, 'Scrolling conversation does not move page')
    if (process.env.VIDEO_SCREENSHOT_DIR) {
      const image = await patient.command('Page.captureScreenshot', { format: 'png' })
      await writeFile(join(process.env.VIDEO_SCREENSHOT_DIR, `video-v6-chat-${width}.png`), Buffer.from(image.data, 'base64'))
    }
    assert.equal(await patient.evaluate(`document.querySelector('#chat-badge').hidden`), true)
    await patient.click('chat-close')
    assert.equal(await patient.evaluate(`document.activeElement===document.querySelector('#chat-toggle')`), true, 'Minimize returns focus to chat toggle')
  }
  await patient.command('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true })
  await patient.click('chat-toggle')
  await patient.evaluate(`document.querySelector('#text').value='<img src=x onerror=alert(1)>'`)
  await patient.click('send')
  await professional.wait(`document.querySelector('#messages').textContent.includes('<img src=x onerror=alert(1)>')`)
  assert.equal(await professional.evaluate(`document.querySelector('#messages img')===null`), true)
  assert.equal(await professional.evaluate(`document.querySelector('#chat-badge').hidden`), true, 'Open chat does not accumulate unread badge')
  await patient.command('Page.bringToFront')
  await patient.evaluate(`document.querySelector('#text').focus({preventScroll:true})`)
  await patient.command('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 })
  assert.equal(await patient.evaluate(`document.querySelector('#chat-panel').hidden&&document.activeElement===document.querySelector('#chat-toggle')`), true, 'Escape minimizes chat without moving video focus')
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
  await professional.wait(`document.querySelector('#status').textContent.includes('finalizo')`)
  assert(lifecycleEvents.includes('completed'), 'Current server persists finalization before completion is acknowledged')
  for (const client of [professional, patient]) {
    await client.wait(`document.querySelector('#status').textContent.includes('finalizo')`)
    assert.equal(await client.evaluate(`window.__testTracks.every(track=>track.readyState==='ended')`), true)
    assert.equal(await client.evaluate(`document.querySelector('#remote').srcObject===null&&document.querySelector('#send').disabled`), true)
  }
  await duplicate.navigate(invite)
  await duplicate.wait(`document.querySelector('#identity')?.textContent.includes('paciente')`)
  await duplicate.click('devices')
  await duplicate.click('join')
  await duplicate.wait(`document.querySelector('#error').textContent.includes('no es valido')`)
  await professional.click('create')
  await professional.wait(`document.querySelector('#link').value.includes('#p=')&&document.querySelector('#link').value!==${JSON.stringify(invite)}`)
  const nextInvite = await professional.evaluate(`document.querySelector('#link').value`)
  assert.equal(await professional.evaluate(`document.querySelector('#messages').children.length`), 0, 'New room never retains previous patient messages')
  assert.equal(await professional.evaluate(`document.querySelector('#chat-panel').hidden&&document.querySelector('#chat-badge').hidden`), true)
  await professional.click('camera')
  await professional.wait(`document.querySelector('#camera').getAttribute('aria-pressed')==='true'`)
  await professional.click('join')
  await patient.navigate(nextInvite)
  await patient.wait(`document.querySelector('#identity')?.textContent.includes('paciente')`)
  await patient.click('devices')
  await patient.click('join')
  await professional.wait(`!document.querySelector('#reject').hidden`)
  const authorization = await patient.evaluate(`new Promise(resolve=>{const test=io({auth:{token:${JSON.stringify(nextInvite.split('#p=')[1])}},reconnection:false});test.on('connect_error',e=>{test.disconnect();resolve(e.message)});})`)
  assert(authorization.includes('otra pestana'))
  await professional.click('reject')
  await patient.wait(`document.querySelector('#status').textContent.includes('rechazo')`)
  assert.equal(await patient.evaluate(`document.querySelector('#local').srcObject===null`), true)
  await professional.click('end')
  await professional.wait(`document.querySelector('#status').textContent.includes('finalizo')`)
  await professional.evaluate(`document.querySelector('#duration').value='1'`)
  await professional.click('create')
  await professional.wait(`document.querySelector('#link').value.includes('#p=')&&document.querySelector('#link').value!==${JSON.stringify(nextInvite)}`)
  const timedInvite = await professional.evaluate(`document.querySelector('#link').value`)
  await professional.click('camera')
  await professional.wait(`document.querySelector('#camera').getAttribute('aria-pressed')==='true'`)
  await professional.click('join')
  await patient.navigate(timedInvite)
  await patient.wait(`document.querySelector('#identity')?.textContent.includes('paciente')`)
  assert.equal(await patient.evaluate(`document.querySelector('#duration-panel').hidden`), true)
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
  console.log('PASS: opaque invitations; professional patient/appointment selection; room patient metadata; compact creation controls; responsive/fullscreen room UI; no-device admission, chat, WebRTC frames, draggable PiP, duration/expiry, admission/reentry/rejection and automatic login.')
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
