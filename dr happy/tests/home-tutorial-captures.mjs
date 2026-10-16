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
  await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 960, deviceScaleFactor: 2, mobile: false })
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
        enabled:true,price:5000,letterhead:'Profesional de ejemplo',logoDataUrl:'',paymentReady:true,
        url:'https://drhappy.com.ar/consulta/ejemplo-no-valido'}};
      else if(url.endsWith('/paid-clinical-documents'))data={success:true,requests:[],settings:{slug:'ejemplo',
        professionalName:'Profesional de ejemplo',service:{enabled:true,price:5000},paymentReady:true}};
      else if(url.endsWith('/subscription-account'))data={success:true,account:{plan:'monthly',status:'active',
        expiresAt:'2027-12-31T00:00:00Z',usage:{used:12,limit:100,inputTokens:2000,outputTokens:1000,totalTokens:3000,
        resetsAt:'2026-11-01T00:00:00Z'},payments:[]}};
      else if(url.endsWith('/dental-records'))data={success:true,record:null,revision:0,history:[]};
      return Response.json(data);
    };
  ` })
  const anchors = {
    ambulance: [
      { selector: '.ambulance-fullscreen input', placeholder: 'paciente' },
      { selector: '.ambulance-fullscreen textarea', placeholder: 'Ubicación' },
      { selector: '.ambulance-fullscreen button', text: 'Guardar en ficha' },
    ],
    attention: [
      { selector: '.clinical-summary-card' },
      { selector: '[name="motivoConsulta"]' },
      { selector: '[name="planManejo"]' },
    ],
    appointments: [
      { selector: '.screen-action', text: 'Cupos y link público' },
      { selector: '.screen-action', text: 'Nuevo turno' },
      { selector: '.screen-action', text: 'Lista de turnos' },
    ],
    patients: [
      { selector: '.directory-search input' },
      { selector: '.patient-directory-actions button', text: 'Abrir ficha' },
      { selector: '.patient-directory-actions', text: 'Evolucionar' },
    ],
    invite: [
      { selector: '.invite-link-row' },
      { selector: '.invite-share-actions' },
      { selector: '.invite-qr-card' },
    ],
    'virtual-consult': [
      { selector: '.vc-settings-row' },
      { selector: '.vc-link' },
      { selector: '.vc-tabs' },
    ],
    'paid-documents': [
      { selector: '.paid-documents-service-list' },
      { selector: '.paid-documents-link-card' },
      { selector: '.paid-documents-tabs button', text: 'Solicitudes' },
    ],
    tools: [
      { selector: '.screen-action-bar' },
      { selector: 'input', placeholder: 'pediatr' },
      { selector: 'span', text: 'Ver protocolo completo' },
    ],
    ledger: [
      { selector: '.ledger-summary-grid' },
      { selector: '.turnera-ledger-header button' },
      { selector: '.ledger-toolbar' },
    ],
    profile: [
      { selector: 'input[name="fullName"]' },
      { selector: '.profile-signature-field' },
      { selector: '.screen-stage button', text: 'Guardar perfil' },
    ],
    subscription: [
      { selector: '.subscription-account-modal > p', text: 'Vencimiento' },
      { selector: '.subscription-account-modal progress' },
      { selector: '.subscription-account-plans' },
    ],
    'attention-dental': [
      { selector: '.dental-preview input' },
      { selector: '.dental-chart-canvas' },
      { selector: '.dental-preview button', text: 'Guardar cambios' },
    ],
    'tools-dental': [
      { selector: 'input', placeholder: 'Escribe al menos' },
      { selector: '.admin-user-list button' },
      { selector: '.medication-detail-panel' },
    ],
    sofia: [
      { selector: '.sofia-compose textarea' },
      { selector: '.sofia-compose button', text: 'Dictar' },
      { selector: '.sofia-compose button[type="submit"]' },
    ],
    video: [
      { selector: '#patient-selection' },
      { selector: '#create' },
      { selector: '.video-controls' },
    ],
  }
  const capture = async (key, surface) => {
    await wait(`document.querySelector(${JSON.stringify(surface)})`)
    await evaluate('document.fonts.ready')
    for (let index = 0; index < 3; index++) {
      if (key === 'video' && index === 1) {
        await evaluate(`(() => {const e=document.querySelector('#patient-select'); e.value='demo';
          e.dispatchEvent(new Event('change',{bubbles:true}));})()`)
      }
      if (key === 'tools-dental' && index === 1) {
        await evaluate(`(() => {const e=document.querySelector('input[placeholder^="Escribe al menos"]');
          Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(e,'ibup');
          e.dispatchEvent(new Event('input',{bubbles:true}));})()`)
        await wait(`document.querySelector('.admin-user-list button')`)
      }
      if (key === 'tools-dental' && index === 2) {
        await evaluate(`document.querySelector('.admin-user-list button').click()`)
      }
      const anchor = anchors[key][index]
      const find = `(() => {
        const nodes=[...document.querySelectorAll(${JSON.stringify(anchor.selector)})];
        return nodes.find(e=>e.getBoundingClientRect().width>0
          ${anchor.text ? `&& e.textContent.includes(${JSON.stringify(anchor.text)})` : ''}
          ${anchor.placeholder ? `&& (e.getAttribute('placeholder')||'').toLowerCase().includes(${JSON.stringify(anchor.placeholder.toLowerCase())})` : ''});
      })()`
      await wait(find)
      await evaluate(`(${find}).scrollIntoView({block:'center',inline:'nearest',behavior:'instant'})`)
      await sleep(350)
      const clip = await evaluate(`(() => {
        const e=${find}; const r=e.getBoundingClientRect();
        const width=Math.min(900,Math.max(600,r.width+80));
        const height=360;
        const x=Math.max(0,Math.min(innerWidth-width,r.x+r.width/2-width/2));
        const y=Math.max(0,Math.min(innerHeight-height,r.y+r.height/2-height/2));
        const marker=document.createElement('div'); marker.id='tutorial-capture-marker';
        Object.assign(marker.style,{position:'fixed',pointerEvents:'none',zIndex:'2147483647',
          left:Math.max(x+12,r.x-5)+'px',top:Math.max(y+22,r.y-5)+'px',
          width:Math.min(width-24,r.width+10)+'px',height:Math.min(height-44,r.height+10)+'px',
          border:'3px solid #087c68',borderRadius:'10px',boxSizing:'border-box',
          boxShadow:'0 0 0 9999px rgba(13,32,54,.12)'});
        const badge=document.createElement('span'); badge.textContent='${index + 1}';
        Object.assign(badge.style,{position:'absolute',left:'10px',top:'-19px',width:'34px',height:'34px',
          display:'grid',placeItems:'center',borderRadius:'50%',background:'#087c68',color:'#fff',
          font:'bold 18px Arial',border:'3px solid white',boxShadow:'0 4px 12px #17324d40'});
        marker.append(badge);document.body.append(marker);
        return {x:x+scrollX,y:y+scrollY,width,height,scale:1};
      })()`)
      const image = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true, clip })
      await writeFile(new URL(`${key}-${index + 1}.png`, output), Buffer.from(image.data, 'base64'))
      await evaluate(`document.getElementById('tutorial-capture-marker').remove()`)
      console.log(`Captured ${key}, step ${index + 1}: ${Math.round(clip.width * 2)} x ${clip.height * 2} lossless`)
    }
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
  const homeActions = await evaluate(`[...document.querySelectorAll('[data-home-action]')].map(e=>e.dataset.homeAction)`)
  for (const width of [320, 390, 844, 899]) {
    await send('Emulation.setDeviceMetricsOverride', { width, height: 844, deviceScaleFactor: 2, mobile: true })
    await send('Page.navigate', { url: origin })
    await wait(`document.querySelector('[data-home-action="patients"]')`)
    assert.equal(await evaluate(`document.querySelector('.home-tool-guide') === null`), true, `No tutorial at ${width}px`)
    assert.deepEqual(await evaluate(`[...document.querySelectorAll('[data-home-action]')].map(e=>e.dataset.homeAction)`), homeActions)
    assert.equal(await evaluate(`getComputedStyle(document.querySelector('.mobile-home-menu')).display`), 'block')
    assert.equal(await evaluate(`document.documentElement.scrollWidth <= innerWidth`), true, `No mobile overflow at ${width}px`)
    assert.equal(await evaluate(`performance.getEntriesByType('resource').filter(r=>r.name.includes('/tool-tutorials/')).length`), 0)
  }
  console.log('Verified: real mobile home menu unchanged at 320/390/844/899 px; no tutorials or image requests.')
  await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 960, deviceScaleFactor: 2, mobile: false })
  await wait(`document.querySelector('.home-tool-flyer')`)
  if (process.env.TEST_CAPTURE_PREVIEW) {
    const screenshot = await send('Page.captureScreenshot', { format: 'png' })
    await writeFile(process.env.TEST_CAPTURE_PREVIEW, Buffer.from(screenshot.data, 'base64'))
    await evaluate(`document.querySelector('.home-tool-flyer').click()`)
    await wait(`document.querySelector('.home-tutorial-dialog img')?.naturalWidth > 0`)
    const tutorial = await send('Page.captureScreenshot', { format: 'png' })
    await writeFile(process.env.TEST_CAPTURE_PREVIEW.replace('.png', '-dialog.png'), Buffer.from(tutorial.data, 'base64'))
    await evaluate(`document.querySelector('[aria-label="Cerrar mini tutorial"]').click()`)
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
  await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 760, deviceScaleFactor: 2, mobile: false })
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
