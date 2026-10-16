import assert from 'node:assert/strict'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { createServer } from 'node:http'

const origin = process.env.TEST_GUIDE_ORIGIN || 'http://127.0.0.1:5194'
const cdp = process.env.TEST_GUIDE_CDP || 'http://127.0.0.1:9379'
const output = new URL('../public/tool-tutorials/', import.meta.url)
const target = await (await fetch(`${cdp}/json/new?about:blank`, { method: 'PUT' })).json()
const socket = new WebSocket(target.webSocketDebuggerUrl)
await new Promise(resolve => socket.addEventListener('open', resolve))
const pending = new Map()
let sequence = 0
let videoServer
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
  throw new Error(`Timed out: ${expression}\n${await evaluate('document.body.innerText.slice(-2500)')}`)
}

try {
  await mkdir(output, { recursive: true })
  await send('Page.enable')
  await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 960, deviceScaleFactor: 1, mobile: false })
  await send('Page.addScriptToEvaluateOnNewDocument', { source: `
    localStorage.clear(); sessionStorage.clear();
    const dental = location.search.includes('dental');
    const professional = {id:'tutorial-demo',username:'tutorial-demo',full_name:'Profesional de ejemplo',
      specialty:dental?'Odontologia':'Clinica',license_number:'DEMO',email:'demo@example.invalid',
      active:true,is_admin:true,subscription_status:'active',subscription_expires_at:'2027-12-31T00:00:00Z'};
    localStorage.setItem('drhappy-active-user',professional.id);
    localStorage.setItem('drhappy-professional-session','tutorial-session');
    localStorage.setItem('drhappy-install-prompt-dismissed',String(Date.now()+86400000));
    localStorage.setItem('drhappy-notification-prompt-dismissed',String(Date.now()+86400000));
    const nativeFetch=window.fetch.bind(window);
    window.fetch=async(input,init)=>{
      const url=typeof input==='string'?input:input instanceof Request?input.url:String(input);
      const resolved=new URL(url,location.href);
      if(resolved.origin===location.origin)return nativeFetch(input,init);
      const body=JSON.parse(init?.body||'{}');
      let data={success:true};
      if(url.includes('/auth/v1/'))data={};
      else if(url.includes('/rest/v1/'))data=[];
      else if(url.endsWith('/professionals-data'))data={success:true,professional,professionals:[professional]};
      else if(url.endsWith('/workspace-data'))data={success:true,professional,archivedPatients:[],workspace:{
        user_id:professional.id,profile_json:{fullName:professional.full_name,specialty:professional.specialty,
          license:'DEMO',email:'demo@example.invalid'},patients_json:[{id:'tutorial-patient',ownerUserId:professional.id,
          nombre:'Paciente',apellido:'de ejemplo',dni:'00000000',email:'paciente@example.invalid',birthDate:'1980-01-01',
          consultations:[],documents:[],dentalStatus:'provisional',createdAt:new Date().toISOString(),updatedAt:new Date().toISOString()}],
        appointments_json:[],treatment_ledger_json:[],treatment_ledger_initialized:true}};
      else if(url.endsWith('/patient-invite'))data={success:true,token:'ejemplo-no-valido',submissions:[]};
      else if(url.endsWith('/patient-folder'))data={success:true,requests:[],links:[]};
      else if(url.endsWith('/virtual-consultations'))data={success:true,consults:[],settings:{slug:'ejemplo',
        enabled:false,price:0,letterhead:'Profesional de ejemplo',logoDataUrl:'',paymentReady:false}};
      else if(url.endsWith('/paid-clinical-documents'))data={success:true,requests:[],settings:{slug:'ejemplo',
        professionalName:'Profesional de ejemplo',service:{enabled:false,price:0},paymentReady:false}};
      else if(url.endsWith('/subscription-account'))data={success:true,account:{plan:'monthly',status:'active',
        expiresAt:'2027-12-31T00:00:00Z',usage:{used:12,limit:100,inputTokens:2000,outputTokens:1000,totalTokens:3000,
        resetsAt:'2026-11-01T00:00:00Z'},payments:[]}};
      else if(url.endsWith('/dental-records'))data={success:true,record:null,revision:0,history:[]};
      return Response.json(data);
    };
  ` })
  const capture = async (key, selector, maxHeight = 780) => {
    await wait(`document.querySelector(${JSON.stringify(selector)})`)
    await evaluate(`document.activeElement?.blur(); window.scrollTo(0,0); document.fonts.ready`)
    await sleep(700)
    const clip = await evaluate(`(() => {
      const e=[...document.querySelectorAll(${JSON.stringify(selector)})].find(e=>e.getBoundingClientRect().width>0);
      if(!e)throw Error('No visible capture surface');
      const r=e.getBoundingClientRect();
      return {x:Math.max(0,r.x+scrollX),y:Math.max(0,r.y+scrollY),width:r.width,
        height:Math.min(r.height,${maxHeight}),scale:1};
    })()`)
    assert.ok(clip.height > 80, `${key} must have actual content`)
    const image = await send('Page.captureScreenshot', { format: 'jpeg', quality: 82, captureBeyondViewport: true, clip })
    await writeFile(new URL(`${key}.jpg`, output), Buffer.from(image.data, 'base64'))
    console.log(`Captured ${key}: ${Math.round(clip.width)} x ${Math.round(clip.height)}`)
  }
  const tools = [
    ['ambulance', 'ambulance', '.ambulance-fullscreen'],
    ['attention', 'attention', '.screen-stage'],
    ['appointments', 'appointments', '.screen-stage'],
    ['patients', 'patients', '.screen-stage'],
    ['invite', 'invite', '.invite-modal-card'],
    ['virtual-consult', 'virtual-consult', '.virtual-consult-modal'],
    ['paid-documents', 'paid-documents', '.paid-documents-modal'],
    ['tools', 'tools', '.screen-stage'],
    ['ledger', 'ledger', '.screen-stage'],
    ['profile', 'profile', '.screen-stage'],
    ['subscription', 'subscription', '.subscription-account-modal'],
    ['attention-dental', 'attention', '.screen-stage'],
    ['tools-dental', 'tools', '.screen-stage'],
  ]
  for (const [key, action, selector] of tools) {
    if (process.env.TEST_CAPTURE_ONLY && !process.env.TEST_CAPTURE_ONLY.split(',').includes(key)) continue
    await send('Page.navigate', { url: `${origin}/${key.endsWith('-dental') ? '?dental' : ''}` })
    await wait(`document.querySelector('[data-home-action="${action}"]')`)
    if (key === 'attention' || key === 'attention-dental') {
      await evaluate(`document.querySelector('[data-home-action="patients"]').click()`)
      await wait(`document.querySelector('.patient-directory-actions')`)
      await evaluate(`[...document.querySelectorAll('.patient-directory-actions button')].find(b=>/^(Evolucionar|Odontograma)$/.test(b.textContent)).click()`)
      await wait(`!document.querySelector('.patient-directory-actions')`)
      await capture(key, key === 'attention-dental' ? '.dental-preview' : '.screen-stage', key === 'attention-dental' ? 1100 : 780)
    } else {
      await evaluate(`document.querySelector('[data-home-action="${action}"]').click()`)
      await capture(key, selector)
    }
  }
  await send('Page.navigate', { url: origin })
  await wait(`document.querySelector('.sidebar-sofia')`)
  await wait(`document.querySelectorAll('.home-tool-flyer').length === 1`)
  if (process.env.TEST_CAPTURE_PREVIEW) {
    const screenshot = await send('Page.captureScreenshot', { format: 'png' })
    await writeFile(process.env.TEST_CAPTURE_PREVIEW, Buffer.from(screenshot.data, 'base64'))
  }
  await evaluate(`document.querySelector('.sidebar-sofia').click()`)
  await capture('sofia', '[role="dialog"]')
  videoServer = createServer(async (request, response) => {
    if (request.url === '/api/session' || request.url === '/api/patients') {
      response.setHeader('Content-Type', 'application/json')
      response.end(JSON.stringify(request.url === '/api/session' ? { admin: true } :
        { patients: [{ id: 'demo', name: 'Paciente de ejemplo' }], appointments: [] }))
      return
    }
    const file = request.url === '/' ? 'index.html' : request.url.slice(1)
    if (!['index.html', 'client.js', 'transcription.js', 'brand-mark.svg'].includes(file)) {
      response.writeHead(404); response.end(); return
    }
    try {
      response.setHeader('Content-Type', file.endsWith('.js') ? 'text/javascript' : file.endsWith('.svg') ? 'image/svg+xml' : 'text/html')
      response.end(await readFile(new URL(`../../video-service/${file}`, import.meta.url)))
    } catch (error) {
      console.error('Could not serve video capture asset:', error)
      response.writeHead(500); response.end()
    }
  })
  await new Promise(resolve => videoServer.listen(0, '127.0.0.1', resolve))
  await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 760, deviceScaleFactor: 1, mobile: false })
  await send('Page.navigate', { url: `http://127.0.0.1:${videoServer.address().port}/` })
  await wait(`document.querySelector('#patient-select')?.options.length === 2`)
  await capture('video', 'main')
} finally {
  if (videoServer) await new Promise((resolve, reject) => videoServer.close(error => error ? reject(error) : resolve()))
  const closed = new Promise(resolve => socket.addEventListener('close', resolve, { once: true }))
  socket.close()
  await closed
  await fetch(`${cdp}/json/close/${target.id}`)
}
