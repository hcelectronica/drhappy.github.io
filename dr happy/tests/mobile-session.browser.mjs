import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const origin = process.env.TEST_APP_ORIGIN || 'http://127.0.0.1:5175'
const profile = await mkdtemp(join(tmpdir(), 'drhappy-session-test-'))
const reservation = createServer()
await new Promise((resolve) => reservation.listen(0, '127.0.0.1', resolve))
const port = reservation.address().port
await new Promise((resolve) => reservation.close(resolve))
const browser = spawn(process.env.EDGE_EXECUTABLE || String.raw`C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe`,
  ['--headless', '--disable-gpu', '--no-first-run', `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, 'about:blank'], { stdio: 'ignore' })
let socket
let launchError
browser.on('error', (error) => { launchError = error })
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
function paperPdfFixture() {
  const blue = '0 0 1 rg 50 50 400 700 re f\n'
  const red = '1 0 0 rg 50 50 700 400 re f\n'
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R 5 0 R] /Count 2 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << >> /Contents 4 0 R >>',
    `<< /Length ${Buffer.byteLength(blue)} >>\nstream\n${blue}endstream`,
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 842 595] /Resources << >> /Contents 6 0 R >>',
    `<< /Length ${Buffer.byteLength(red)} >>\nstream\n${red}endstream`,
  ]
  let pdf = '%PDF-1.4\n'
  const offsets = [0]
  for (const [index, object] of objects.entries()) {
    offsets.push(Buffer.byteLength(pdf))
    pdf += `${index + 1} 0 obj\n${object}\nendobj\n`
  }
  const xref = Buffer.byteLength(pdf)
  pdf += `xref\n0 7\n0000000000 65535 f \n${offsets.slice(1).map(offset => String(offset).padStart(10, '0') + ' 00000 n \n').join('')}trailer\n<< /Size 7 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`
  return Buffer.from(pdf).toString('base64')
}
try {
  let tabs
  for (let attempt = 0; attempt < 150; attempt++) {
    if (launchError) throw launchError
    try {
      tabs = await fetch(`http://127.0.0.1:${port}/json`).then((response) => response.json())
      if (tabs.some((tab) => tab.type === 'page')) break
    } catch (error) { if (error.cause?.code !== 'ECONNREFUSED') throw error }
    await sleep(200)
  }
  assert(tabs?.some((tab) => tab.type === 'page'), 'Isolated browser must start')
  socket = new WebSocket(tabs.find((tab) => tab.type === 'page').webSocketDebuggerUrl)
  await new Promise((resolve, reject) => {
    socket.addEventListener('open', resolve, { once: true })
    socket.addEventListener('error', reject, { once: true })
  })
  let nextId = 0
  const pending = new Map()
  socket.addEventListener('message', (event) => {
    const response = JSON.parse(event.data)
    const request = pending.get(response.id)
    if (!request) return
    pending.delete(response.id)
    if (response.error) request.reject(new Error(response.error.message))
    else request.resolve(response.result)
  })
  const command = (method, params = {}, sessionId) => new Promise((resolve, reject) => {
    const id = ++nextId
    pending.set(id, { resolve, reject })
    socket.send(JSON.stringify({ id, method, params, sessionId }))
  })
  const evaluate = async (expression) => {
    const result = await command('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true, userGesture: true })
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text)
    return result.result.value
  }
  const wait = async (expression) => {
    for (let attempt = 0; attempt < 250; attempt++) {
      if (await evaluate(expression)) return
      await sleep(100)
    }
    throw new Error('UI timeout: ' + expression + '\n' + await evaluate('document.body.innerText.slice(-2000)'))
  }
  const checkTouchLayout = async label => {
    await command('Page.bringToFront')
    for (const [width, height] of [[320, 568], [375, 667], [390, 844], [430, 932], [844, 390]]) {
      await command('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: true })
      await evaluate(`new Promise((resolve,reject)=>{
        const timer=setTimeout(()=>reject(new Error('Viewport frames did not settle')),5000);
        requestAnimationFrame(()=>requestAnimationFrame(()=>{clearTimeout(timer);resolve()}));
      })`)
      const layout = await evaluate(`(()=>{
        const visible=e=>e.getClientRects().length&&getComputedStyle(e).visibility!=='hidden';
        const fields=Array.from(document.querySelectorAll('input:not([type=checkbox]):not([type=radio]):not([type=range]):not([type=hidden]):not([type=file]):not([type=color]),select,textarea')).filter(visible);
        return {width:document.documentElement.clientWidth,scroll:document.documentElement.scrollWidth,
          smallFields:fields.filter(e=>parseFloat(getComputedStyle(e).fontSize)<16).slice(0,10).map(e=>({name:e.name||e.getAttribute('aria-label')||e.placeholder,cls:e.className,font:getComputedStyle(e).fontSize})),
          overflow:Array.from(document.querySelectorAll('main *,.app *')).filter(visible).filter(e=>e.getBoundingClientRect().right>${width}+1).slice(0,10).map(e=>({tag:e.tagName,cls:typeof e.className==='string'?e.className:'SVG',right:Math.round(e.getBoundingClientRect().right)}))};
      })()`)
      const description = `${label} ${width}px: ${JSON.stringify(layout)}`
      assert.equal(layout.smallFields.length, 0, 'Touch fields must not trigger Safari auto-zoom: ' + description)
      assert(layout.scroll <= width + 1, 'Page must not escape viewport: ' + description)
    }
    await command('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true })
    console.log('Touch layout passed: ' + label)
  }
  const captureClinicalScreen = async name => {
    if (!process.env.TEST_CLINICAL_CAPTURE_DIR) return
    await command('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false })
    await evaluate(`document.querySelectorAll('.clinical-diagnosis-field input').forEach(input=>input.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true})));document.activeElement?.blur();window.scrollTo(0,0);document.fonts.ready`)
    await sleep(4500)
    let metrics = await command('Page.getLayoutMetrics')
    await command('Emulation.setDeviceMetricsOverride', { width: 1440, height: Math.ceil(metrics.cssContentSize.height), deviceScaleFactor: 1, mobile: false })
    await sleep(400)
    metrics = await command('Page.getLayoutMetrics')
    const { width, height } = metrics.cssContentSize
    const screenshot = await command('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true, clip: { x: 0, y: 0, width, height, scale: 1 } })
    const path = join(process.env.TEST_CLINICAL_CAPTURE_DIR, `DrHappy-${name}-compacta`)
    await writeFile(path + '.png', Buffer.from(screenshot.data, 'base64'))
    const target = await command('Target.createTarget', { url: 'about:blank' })
    try {
      const attached = await command('Target.attachToTarget', { targetId: target.targetId, flatten: true })
      const html = `<!doctype html><html><head><style>@page{size:${width}px ${height}px;margin:0}html,body{margin:0;padding:0}img{display:block;width:${width}px;height:${height}px}</style></head><body><img src="data:image/png;base64,${screenshot.data}" alt="Captura completa de la pantalla"></body></html>`
      await command('Runtime.evaluate', { expression: `(async()=>{document.open();document.write(${JSON.stringify(html)});document.close();await document.images[0].decode()})()`, awaitPromise: true }, attached.sessionId)
      const pdf = await command('Page.printToPDF', { printBackground: true, preferCSSPageSize: true, paperWidth: width / 96, paperHeight: height / 96, marginTop: 0, marginBottom: 0, marginLeft: 0, marginRight: 0 }, attached.sessionId)
      await writeFile(path + '.pdf', Buffer.from(pdf.data, 'base64'))
      console.log(`Captured ${path}.pdf (${width} x ${height})`)
    } finally {
      await command('Target.closeTarget', { targetId: target.targetId })
    }
  }
  await command('Page.enable')
  await command('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 })
  await command('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true })
  await command('Page.addScriptToEvaluateOnNewDocument', { source: `
    if(location.origin===${JSON.stringify(origin)}){
      if(${process.env.TEST_CLINICAL_FOLLOW_UP === '1'}){
        window.__speechSessions=[];
        window.SpeechRecognition=class{
          start(){window.__speechSessions.push(this)}
          stop(){this.stopped=true}
          emit(parts){const results=parts.map(([transcript,isFinal])=>({0:{transcript},isFinal}));results.item=index=>results[index];this.onresult?.({resultIndex:0,results})}
        };
      }
      window.__instance=crypto.randomUUID();
      window.addEventListener('beforeinstallprompt',event=>{
        if(!event.fixture){event.preventDefault();event.stopImmediatePropagation()}
      });
      const account=id=>({id,username:id,full_name:id==='account-a'?'Profesional A':'Profesional B',
        specialty:localStorage.getItem('fixture-medical')?'Clinica':'Odontologia',license_number:'TEST',email:id+'@example.invalid',active:true,is_admin:id==='account-b',
        subscription_status:'active',subscription_expires_at:'2027-12-31T00:00:00Z'});
      if(!localStorage.getItem('fixture-initialized')){
        localStorage.setItem('fixture-initialized','true');
        localStorage.setItem('drhappy-active-user','account-a');
        localStorage.setItem('drhappy-professional-session','token-account-a');
      }
      localStorage.setItem('drhappy-install-prompt-dismissed',String(Date.now()+86400000));
      localStorage.setItem('drhappy-notification-prompt-dismissed',String(Date.now()+86400000));
      sessionStorage.clear();
      const googleUser={id:'google-account-a',email:'account-a@example.invalid',app_metadata:{provider:'google'},
        user_metadata:{full_name:'Profesional A'},aud:'authenticated',created_at:'2026-10-03T12:00:00Z'};
      const jwt='eyJhbGciOiJIUzI1NiJ9.'+btoa(JSON.stringify({sub:googleUser.id,exp:Math.floor(Date.now()/1000)+3600})) + '.fixture';
      if(!localStorage.getItem('drhappy-google-auto-login-blocked')){
        localStorage.setItem('sb-stzsobirxdivbgqxwkhc-auth-token',JSON.stringify({
          access_token:jwt,refresh_token:'google-fixture',token_type:'bearer',expires_in:3600,
          expires_at:Math.floor(Date.now()/1000)+3600,user:googleUser}));
      }
      navigator.serviceWorker.register=()=>Promise.reject(new Error('Isolated session fixture'));
      const send=window.fetch.bind(window);
      window.__calls=[];
      window.fetch=async(input,init)=>{
        const url=typeof input==='string'?input:input instanceof Request?input.url:String(input);
        if(url.includes('/auth/v1/')){
          if(url.includes('/logout')&&window.__delayGoogleLogout)await new Promise(resolve=>{window.__finishGoogleLogout=resolve});
          return new Response(JSON.stringify(url.includes('/user')?googleUser:{}),{status:200,headers:{'Content-Type':'application/json'}});
        }
        if(!url.includes('/functions/v1/')&&!url.includes('/rest/v1/'))return send(input,init);
        if(url.includes('/rest/v1/'))return new Response('[]');
        const body=JSON.parse(init?.body||'{}');
        const headers=new Headers(init?.headers);
        const token=headers.get('x-drhappy-session');
        const id=token==='token-account-b'?'account-b':'account-a';
        const prof=account(id);
        window.__calls.push({slug:url.split('/').pop(),action:body.action,id,token});
        let data={success:true};
        if(url.endsWith('/dental-records'))data={success:true,record:null,revision:0,history:[]};
        if(url.endsWith('/video-handoff')){
          if(window.__delayVideo)await new Promise(resolve=>{window.__finishVideo=resolve});
          if(window.__failVideo)return new Response(JSON.stringify({error:'Pase de prueba rechazado.'}),{status:403,headers:{'content-type':'application/json'}});
          data={token:'a'.repeat(64),expiresInSeconds:60};
        }
        if(url.endsWith('/auth-email-verification')&&body.action==='register'){
          data={success:true,professionalId:'fixture-new',resumeToken:'fixture-resume',email:body.email,emailSent:true};
        }
        if(url.endsWith('/auth-professional')){
          if(body.action==='login'){
            if(window.__delayLogin)await new Promise(resolve=>{window.__finishLogin=resolve});
            data={success:true,professional:account(body.username),sessionToken:'token-'+body.username};
          }else {data={success:false,message:'Google is not used in this fixture'};}
        }
        if(url.endsWith('/professionals-data'))data={success:true,professional:prof,professionals:[account('account-a'),account('account-b')]};
        if(url.endsWith('/workspace-data')){
          if(window.__delayWorkspace)await new Promise(resolve=>{window.__finishWorkspace=resolve});
          data={success:true,professional:prof,archivedPatients:[],workspace:{user_id:id,
            profile_json:{fullName:prof.full_name,specialty:prof.specialty,email:prof.email},
            patients_json:[{id:'patient-'+id,ownerUserId:id,nombre:'Paciente',apellido:id,dni:id==='account-a'?'11111111':'22222222',
              email:'patient@example.invalid',consultations:[],documents:[],dentalStatus:'provisional',
              createdAt:new Date().toISOString(),updatedAt:new Date().toISOString()}],
            appointments_json:id==='account-b'?[{id:'appointment-b',patientId:'patient-account-b',patientName:'Paciente account-b',
              patientEmail:'patient@example.invalid',scheduledDate:new Date().toLocaleDateString('en-CA'),scheduledTime:'12:00',
              reason:'Videoconsulta fixture',createdAt:new Date().toISOString(),createdByUserId:id,status:'confirmed'}]:[],
            treatment_ledger_json:[],treatment_ledger_initialized:true}};
          if(localStorage.getItem('fixture-medical')){
            if(body.action==='save')localStorage.setItem('fixture-document-patients',JSON.stringify(body.patients));
            data.workspace.patients_json=JSON.parse(localStorage.getItem('fixture-document-patients'));
          }
        }
        if(url.endsWith('/patient-invite'))data={success:true,submissions:[]};
        if(url.endsWith('/ai-assistant')){
          window.__clinicalAiBody=body;
          if(window.__delayClinicalAi)await new Promise(resolve=>{window.__finishClinicalAi=resolve});
          data=window.__failClinicalAi?{success:false,message:'Revisión simulada fallida'}:
            {success:true,reply:'RESUMEN CLÍNICO: Control de peso; evolución organizada.\\nREFLEXIÓN / ASPECTOS A REVISAR: Verificar resultados del laboratorio.'};
        }
        return new Response(JSON.stringify(data),{status:200,headers:{'Content-Type':'application/json'}});
      };
    }
  ` })
  await command('Page.navigate', { url: origin + '/' })
  const ready = (name) => wait(`document.body?.innerText.includes(${JSON.stringify(name)})&&Array.from(document.querySelectorAll('button')).some(b=>b.textContent.includes('Cerrar sesión'))`)
  await ready('Profesional A')
  assert.equal(await evaluate(`document.querySelectorAll('button.video-consultation-link').length`), 0, 'Non-admin does not see video links')
  await wait(`performance.getEntriesByType('resource').some(r=>r.name.includes('vademecum.json'))`)
  await wait(`performance.getEntriesByType('resource').some(r=>/cie-10/.test(r.name))`)
  assert(await evaluate(`window.__calls.some(call=>call.slug==='fetch-medical-news')`), 'Clinical resources still load after authenticated restoration')
  assert.equal(await evaluate(`sessionStorage.getItem('drhappy-professional-session')`), 'token-account-a')
  assert(await evaluate(`!!localStorage.getItem('drhappy-session-v2')`), 'Legacy session migrated without signing in')
  assert(await evaluate(`!window.__calls.some(call=>call.action==='profile-update')`), 'Restoration does not overwrite professional profiles')
  assert(await evaluate(`!window.__calls.some(call=>call.action==='google-login')`), 'Existing Google identity cannot replace restored professional identity')
  await evaluate(`sessionStorage.clear();document.dispatchEvent(new Event('visibilitychange'));window.dispatchEvent(new Event('pageshow'))`)
  assert.equal(await evaluate(`sessionStorage.getItem('drhappy-professional-session')`), 'token-account-a')
  const instance = await evaluate('window.__instance')
  await command('Page.reload')
  await wait(`window.__instance&&window.__instance!==${JSON.stringify(instance)}`)
  await ready('Profesional A')
  const click = async (text) => {
    await wait(`Array.from(document.querySelectorAll('button')).some(b=>b.textContent.includes(${JSON.stringify(text)})&&!b.disabled)`)
    await evaluate(`Array.from(document.querySelectorAll('button')).find(b=>b.textContent.includes(${JSON.stringify(text)})&&!b.disabled).click()`)
  }
  if (process.env.TEST_PATIENT_DOCUMENTS !== '1' && process.env.TEST_CLINICAL_FOLLOW_UP !== '1') {
  await checkTouchLayout('authenticated home')
  await click('Mis pacientes')
  await wait(`document.querySelector('.patient-directory-grid')?.textContent.includes('account-a')`)
  await checkTouchLayout('patient directory')
  await click('+ Nuevo paciente')
  await wait(`!!document.querySelector('.dental-new-patient')`)
  await checkTouchLayout('new patient form')
  await click('Volver a pacientes')
  await click('Mis pacientes')
  await click('Abrir ficha')
  await wait(`!!document.querySelector('.dental-preview')`)
  await checkTouchLayout('dental chart')
  await click('Mis pacientes')
  await click('Perfil')
  await wait(`!!document.querySelector('.profile-stage')`)
  await checkTouchLayout('professional profile')
  await click('Turnera')
  await wait(`!!document.querySelector('.turnera-view-switch')||document.body.innerText.includes('Turnera Médica')`)
  await checkTouchLayout('appointments')
  await click('Nuevo turno')
  await wait(`!!document.querySelector('#appointment-modal-title')`)
  await checkTouchLayout('appointment modal')
  assert(await evaluate(`getComputedStyle(document.querySelector('.turnera-modal-card')).touchAction.includes('pinch-zoom')`), 'Modal scrolling preserves pinch zoom')
  await evaluate(`document.querySelector('.turnera-modal-card .drhappy-modal-close-btn').click()`)
  await wait(`!document.querySelector('#appointment-modal-title')`)
  await click('Mis pacientes')
  await wait(`document.querySelector('.patient-directory-grid')?.textContent.includes('account-a')`)
  await evaluate(`window.__delayWorkspace=true`)
  await click('Actualizar fichas')
  await wait(`!!window.__finishWorkspace`)
  await evaluate(`window.__delayGoogleLogout=true`)
  await click('Cerrar sesión')
  await wait(`!!document.querySelector('input[name="username"]')`)
  assert.equal(await evaluate(`localStorage.getItem('drhappy-session-v2')`), null, 'Logout removes session immediately')
  await wait(`!!window.__finishGoogleLogout`)
  await sleep(200)
  assert.equal(await evaluate(`localStorage.getItem('drhappy-active-user')`), null, 'Pending Google logout cannot reopen the app')
  await evaluate(`window.__finishGoogleLogout()`)
  const login = async (id) => {
    if (await evaluate(`document.querySelector('#auth-login-panel')?.hidden`)) await click('Iniciar sesión')
    await evaluate(`(()=>{for(const [name,value] of [['username',${JSON.stringify(id)}],['password','fixture-password']]){
      const n=document.querySelector('input[name="'+name+'"]');
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(n,value);
      n.dispatchEvent(new Event('input',{bubbles:true}));
    }})()`)
    await sleep(100)
    await evaluate(`document.querySelector('input[name="username"]').closest('form').requestSubmit()`)
  }
  await evaluate(`window.__delayWorkspace=false`)
  await login('account-b')
  await ready('Profesional B')
  await checkTouchLayout('administrator home')
  await click('Herramientas')
  await wait(`document.body.innerText.includes('Herramientas clínicas y protocolos')`)
  await checkTouchLayout('clinical tools')
  await click('Inicio')
  const videoLinkSelector = 'button.video-consultation-link'
  assert.equal(await evaluate(`document.querySelectorAll(${JSON.stringify(videoLinkSelector)}).length`), 2, 'Admin sees quick-action and navigation video links')
  assert(await evaluate(`!document.querySelector('.topbar .video-consultation-link')`), 'No separate header video button')
  for (const [width, height, mobile] of [[1280, 900, false], [390, 844, true]]) {
    await command('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile })
    assert.deepEqual(await evaluate(`Array.from(document.querySelectorAll(${JSON.stringify(videoLinkSelector)})).map(a=>({type:a.type,text:a.textContent.includes('Videoconsulta')}))`),
      Array.from({ length: 2 }, () => ({ type: 'button', text: true })))
    if (mobile) assert(await evaluate(`document.querySelector('.home-botonera .video-consultation-link').getBoundingClientRect().height>=44`), 'General quick action has a usable touch target')
    await evaluate(`document.querySelector('.sidebar-handle').click()`)
    await wait(`document.querySelector('.app-sidebar').classList.contains('open')`)
    assert(await evaluate(`(()=>{const a=document.querySelector('.sidebar-nav button.video-consultation-link');a.focus();const r=a.getBoundingClientRect();return document.activeElement===a&&r.width>=42&&r.height>=44&&getComputedStyle(a).display!=='none'})()`), 'Navigation video link is keyboard focusable with a usable touch target')
    await command('Page.bringToFront')
    await command('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter', text: '\r', unmodifiedText: '\r', windowsVirtualKeyCode: 13 })
    await command('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 })
    let videoTab
    for (let attempt = 0; attempt < 100; attempt++) {
      videoTab = (await command('Target.getTargets')).targetInfos.find(tab => tab.type === 'page' && tab.url.startsWith('https://video.drhappy.com.ar/'))
      if (videoTab) break
      await sleep(100)
    }
    assert(videoTab, 'Video link opens videoconsulta in a separate tab: ' + await evaluate(`JSON.stringify({body:document.body.innerText.slice(-1800),calls:window.__calls.filter(call=>call.slug==='video-handoff')})`))
    assert.equal(videoTab.url, `https://video.drhappy.com.ar/#handoff=${'a'.repeat(64)}`, 'Only short-lived pass goes in fragment, never app session/password')
    const attachedVideo = await command('Target.attachToTarget', { targetId: videoTab.targetId, flatten: true })
    const openerCheck = await command('Runtime.evaluate', { expression: 'window.opener===null', returnByValue: true }, attachedVideo.sessionId)
    assert.equal(openerCheck.result.value, true, 'Video page has no opener access to app')
    await command('Target.detachFromTarget', { sessionId: attachedVideo.sessionId })
    assert.deepEqual(await evaluate(`window.__calls.filter(call=>call.slug==='video-handoff').at(-1)`),
      { slug: 'video-handoff', action: 'create', id: 'account-b', token: 'token-account-b' }, 'Pass issued with current professional session')
    await command('Target.closeTarget', { targetId: videoTab.targetId })
    assert.equal(await evaluate(`location.origin`), origin, 'Opening video preserves the app workspace')
  }
  await evaluate(`window.__savedOpen=window.open;window.open=()=>null;document.querySelector('.home-botonera .video-consultation-link').click()`)
  await wait(`document.body.innerText.includes('El navegador bloqueó la pestaña')`)
  await evaluate(`window.open=window.__savedOpen;window.__failVideo=true;document.querySelector('.home-botonera .video-consultation-link').click()`)
  await wait(`document.body.innerText.includes('Pase de prueba rechazado.')&&!document.querySelector('.home-botonera .video-consultation-link').disabled`)
  await evaluate(`window.__failVideo=false;window.__delayVideo=true;document.querySelector('.home-botonera .video-consultation-link').click()`)
  await wait(`!!window.__finishVideo&&document.querySelector('.home-botonera .video-consultation-link').disabled`)
  await evaluate(`localStorage.setItem('drhappy-session-v2',JSON.stringify({userId:'account-a',token:'token-account-a'}));window.__finishVideo()`)
  await wait(`!document.querySelector('.home-botonera .video-consultation-link').disabled`)
  assert.equal((await command('Target.getTargets')).targetInfos.filter(tab=>tab.url==='about:blank').length, 0, 'Failed/account-changed requests close their blank tabs')
  await evaluate(`window.__delayVideo=false;localStorage.setItem('drhappy-session-v2',JSON.stringify({userId:'account-b',token:'token-account-b'}))`)
  console.log('Video access passed: permissions, keyboard/mobile entry, one-use fragment, no opener, blocked popup, rejected pass and account-change cleanup.')
  await evaluate(`window.__finishWorkspace()`)
  await sleep(500)
  assert(await evaluate(`document.body.innerText.includes('Profesional B')&&!document.body.innerText.includes('Profesional A')`))
  await click('Mis pacientes')
  await wait(`document.querySelector('.patient-directory-grid')?.textContent.includes('account-b')`)
  assert(await evaluate(`!document.querySelector('.patient-directory-grid').textContent.includes('account-a')`), 'Old account patients cannot reappear')
  await evaluate(`(()=>{
    window.__originalVideoOpen=window.open;
    window.open=()=>({opener:null,closed:false,document:{title:'',body:{textContent:''}},location:{replace:url=>{window.__patientVideoUrl=url}},close(){}});
    const card=document.querySelector('.patient-directory-card');
    Array.from(card.querySelectorAll('button')).find(button=>button.textContent.includes('Videoconsulta')).click();
  })()`)
  await wait(`!!window.__patientVideoUrl`)
  assert.equal(await evaluate(`window.__patientVideoUrl`), `https://video.drhappy.com.ar/#handoff=${'a'.repeat(64)}&patient=patient-account-b`, 'Patient action sends only the opaque patient ID and temporary pass, never name/DNI')
  await click('Turnera')
  await wait(`Array.from(document.querySelectorAll('.turnera-card-actions button')).some(button=>button.textContent.includes('Videoconsulta'))`)
  await evaluate(`window.__patientVideoUrl=null;Array.from(document.querySelectorAll('.turnera-card-actions button')).find(button=>button.textContent.includes('Videoconsulta')).click()`)
  await wait(`!!window.__patientVideoUrl`)
  assert.equal(await evaluate(`window.__patientVideoUrl`), `https://video.drhappy.com.ar/#handoff=${'a'.repeat(64)}&patient=patient-account-b&appointment=appointment-b`, 'Appointment action preselects its patient and appointment without clinical content in URL')
  await evaluate(`window.open=window.__originalVideoOpen`)
  await click('Cerrar sesión')
  await wait(`!!document.querySelector('input[name="username"]')`)
  assert.equal(await evaluate(`document.querySelectorAll('button.video-consultation-link').length`), 0, 'Logout removes admin video access')
  await evaluate(`window.__delayLogin=true`)
  await login('account-a')
  await wait(`!!window.__finishLogin`)
  await evaluate(`window.__delayLogin=false`)
  await login('account-b')
  await ready('Profesional B')
  await evaluate(`window.__finishLogin()`)
  await sleep(500)
  assert.equal(await evaluate(`JSON.parse(localStorage.getItem('drhappy-session-v2')).userId`), 'account-b', 'Late login cannot overwrite latest login')
  await click('Cerrar sesión')
  await wait(`!!document.querySelector('input[name="username"]')`)
  await command('Page.reload')
  await wait(`!!document.querySelector('input[name="username"]')`)
  assert.equal(await evaluate(`localStorage.getItem('drhappy-active-user')`), null)
  await sleep(1000)
  assert(await evaluate(`!document.querySelector('.splash-screen')`), 'Public entry has no timed splash overlay')
  assert(await evaluate(`!!document.querySelector('.auth-promo')`), 'Public service information remains available')
  assert(await evaluate(`!performance.getEntriesByType('resource').some(r=>/vademecum\\.json|cie-10|mammoth|pdfjs/.test(r.name))`), 'Anonymous entry does not download clinical catalogs or document readers')
  assert(await evaluate(`!window.__calls.some(call=>call.slug==='fetch-medical-news')`), 'Anonymous entry does not request medical news')
  console.log('Mobile sessions passed: restore without sessionStorage, resume, reload, account switch with late workspace, concurrent logins, logout and no automatic reentry.')
  console.log('Public entry passed: no splash, no anonymous clinical downloads, authenticated catalog loading preserved.')
  await checkTouchLayout('public entry')
  if (process.env.TEST_VIDEO_ACCESS !== '1') {
  assert(await evaluate(`!/(user-scalable\\s*=\\s*no|maximum-scale\\s*=\\s*1(?:\\D|$))/.test(document.querySelector('meta[name=viewport]').content)`), 'Viewport never blocks manual accessibility zoom')
  assert.equal(await evaluate(`getComputedStyle(document.documentElement).webkitTextSizeAdjust`), '100%', 'Orientation does not inflate text')
  assert.deepEqual(await evaluate(`Array.from(document.querySelector('.auth-promo-tool-grid').children).slice(0,4).map(e=>e.querySelector(':scope > strong').textContent)`),
    ['Atención médica', 'Odontograma interactivo', 'Turnera', 'Modo ambulancia'])
  await command('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'no-preference' }] })
  for (const [width, height, mobile, reduce] of [[1280, 900, false, false], [1280, 900, false, true], [390, 844, true, false], [320, 568, true, false]]) {
    await command('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: reduce ? 'reduce' : 'no-preference' }] })
    await command('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile })
    const before = await evaluate(`(()=>{const c=document.querySelector('.dental-promo-flyer');c.scrollIntoView({block:'center'});const r=c.getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2,width:r.width,height:r.height}})()`)
    if (mobile) {
      await command('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: before.x, y: before.y }] })
      await command('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
    } else {
      await command('Input.dispatchMouseEvent', { type: 'mouseMoved', x: before.x, y: before.y })
    }
    await wait(`!!document.querySelector('.dental-promo-demo')`)
    const after = await evaluate(`(()=>{const c=document.querySelector('.dental-promo-flyer'),d=c.querySelector('.dental-promo-demo'),r=c.getBoundingClientRect();return{width:r.width,height:r.height,demoHeight:d.getBoundingClientRect().height,description:getComputedStyle(c.querySelector(':scope > small')).visibility}})()`)
    assert.equal(after.width, before.width)
    assert.equal(after.height, before.height)
    assert(Math.abs(after.demoHeight - after.height) <= 2)
    assert.equal(after.description, 'hidden')
    const cursorStart = await evaluate(`getComputedStyle(document.querySelector('.dental-promo-cursor')).transform`)
    await sleep(200)
    assert.notEqual(await evaluate(`getComputedStyle(document.querySelector('.dental-promo-cursor')).transform`), cursorStart, 'Cursor actually moves')
    const frames = await evaluate(`(()=>{const d=document.querySelector('.dental-promo-demo');const frame=t=>{d.getAnimations({subtree:true}).forEach(a=>{a.pause();a.currentTime=t});return{detail:getComputedStyle(d.querySelector('.dental-promo-detail')).opacity,red:getComputedStyle(d.querySelector('.dental-promo-red')).fill,blue:getComputedStyle(d.querySelector('.dental-promo-blue')).fill}};return{start:frame(0),red:frame(6000),blue:frame(8400)}})()`)
    assert.equal(frames.start.detail, '0')
    assert.equal(frames.red.detail, '1')
    assert.equal(frames.red.red, 'rgb(239, 160, 170)')
    assert.equal(frames.blue.blue, 'rgb(145, 181, 243)')
    assert.equal(await evaluate(`document.querySelectorAll('dialog[open],.drhappy-modal-overlay').length`), 0)
    if (mobile) {
      await evaluate(`void(window.__previousDemo=document.querySelector('.dental-promo-demo'))`)
      await command('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: before.x, y: before.y }] })
      await command('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
      await wait(`document.querySelector('.dental-promo-demo')!==window.__previousDemo`)
      await evaluate(`document.querySelector('.dental-promo-flyer').dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}))`)
    } else {
      await command('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 0, y: 0 })
    }
    await wait(`!document.querySelector('.dental-promo-demo')`)
  }
  await evaluate(`document.querySelector('.dental-promo-flyer').focus()`)
  await command('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter' })
  await command('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter' })
  await wait(`!!document.querySelector('.dental-promo-demo')`)
  await command('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] })
  assert.equal(await evaluate(`getComputedStyle(document.querySelector('.dental-promo-cursor')).animationName`), 'dental-promo-cursor')
  const reducedCursor = await evaluate(`getComputedStyle(document.querySelector('.dental-promo-cursor')).transform`)
  await sleep(250)
  assert.notEqual(await evaluate(`getComputedStyle(document.querySelector('.dental-promo-cursor')).transform`), reducedCursor, 'Explicit demo activation plays the full sequence even with system motion reduction')
  await evaluate(`document.querySelector('.dental-promo-flyer').blur()`)
  await wait(`!document.querySelector('.dental-promo-demo')`)
  await command('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'no-preference' }] })
  await command('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true })
  console.log('Dental promo passed: card order, mouse and real touch activation, stable dimensions, moving cursor, expanded surfaces, red/blue timeline, keyboard and full playback with system motion reduction.')
  assert(await evaluate(`document.querySelector('#auth-login-panel').hidden`), 'Public login starts collapsed')
  await click('Iniciar sesión')
  assert(await evaluate(`!document.querySelector('#auth-login-panel').hidden`))
  await checkTouchLayout('expanded login')
  await click('Cerrar acceso')
  assert(await evaluate(`document.querySelector('#auth-login-panel').hidden`))
  await click('Iniciar sesión')
  await click('Crear usuario')
  await checkTouchLayout('registration')
  for (const [width, height] of [[390, 844], [320, 568]]) {
    await command('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: true })
    const layout = await evaluate(`(()=>{const e=document.querySelector('.register-modal-card'),f=e.querySelector('form'),r=e.getBoundingClientRect();return{top:r.top,bottom:r.bottom,viewport:innerHeight,scroll:f.scrollHeight,client:f.clientHeight}})()`)
    assert(layout.top >= 0 && layout.bottom <= layout.viewport, JSON.stringify(layout))
    assert(layout.scroll <= layout.client + 1, 'Registration has no inner scroll')
  }
  await evaluate(`(()=>{for(const [name,value] of Object.entries({firstName:'Ana',lastName:'Fixture',dni:'30111222',licenseNumber:'TEST',email:'new@example.invalid',username:'new@example.invalid',password:'fixture-only'})){
    const n=document.querySelector('.register-form input[name="'+name+'"]');
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(n,value);n.dispatchEvent(new Event('input',{bubbles:true}));
  }const s=document.querySelector('.register-form select');Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,'value').set.call(s,'Médico');s.dispatchEvent(new Event('change',{bubbles:true}));})()`)
  await sleep(100)
  const filledLayout = await evaluate(`(()=>{const e=document.querySelector('.register-modal-card'),f=e.querySelector('form'),r=e.getBoundingClientRect();return{top:r.top,bottom:r.bottom,viewport:innerHeight,scroll:f.scrollHeight,client:f.clientHeight,fields:f.querySelectorAll('input,select').length}})()`)
  assert.equal(filledLayout.fields, 8)
  assert(filledLayout.top >= 0 && filledLayout.bottom <= filledLayout.viewport, JSON.stringify(filledLayout))
  assert(filledLayout.scroll <= filledLayout.client + 1)
  await click('Guardar usuario')
  await wait(`document.body.innerText.includes('Confirmá tu email')&&!document.querySelector('.register-modal-card')`)
  assert(await evaluate(`!document.querySelector('#auth-login-panel').hidden`), 'Verification remains visible after registration')
  await click('Volver a iniciar sesión')
  assert(await evaluate(`!document.querySelector('#auth-login-panel').hidden`))
  await click('¿Olvidaste tu contraseña?')
  await wait(`document.body.innerText.includes('Recuperar contraseña')`)
  await checkTouchLayout('password recovery')
  await click('Volver a iniciar sesión')
  assert(await evaluate(`!document.querySelector('#auth-login-panel').hidden`))
  await command('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true })
  await evaluate(`localStorage.removeItem('drhappy-pending-email-verification')`)
  console.log('Collapsed login and full registration passed: two screen sizes, all fields, mocked registration to email-code confirmation.')
  const reloadPublic = async () => {
    const instance = await evaluate('window.__instance')
    await command('Page.reload')
    await wait(`window.__instance!==${JSON.stringify(instance)}&&!!document.querySelector('input[name="username"]')`)
    await sleep(500)
  }
  await command('Emulation.setUserAgentOverride', { userAgent: 'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 Chrome/130.0 Mobile Safari/537.36' })
  await reloadPublic()
  await wait(`!!document.querySelector('.public-install-banner')`)
  await evaluate(`document.querySelector('.public-install-banner button').click()`)
  await wait(`!!document.querySelector('.install-manual-guide')`)
  assert(await evaluate(`document.querySelector('.install-manual-guide').textContent.includes('Chrome o Edge')`))
  await click('Continuar en el navegador')
  assert(await evaluate(`!!document.querySelector('.public-install-banner')`), 'Snoozing does not hide the public install button')
  const simulateInstall = (outcome, fail = false) => evaluate(`(()=>{
    window.__installPrompts=0;
    const event=new Event('beforeinstallprompt',{cancelable:true});
    event.fixture=true;
    event.prompt=async()=>{window.__installPrompts++;${fail ? "throw new Error('Fixture install failure')" : ''}};
    event.userChoice=Promise.resolve({outcome:${JSON.stringify(outcome)}});
    window.dispatchEvent(event);
    return event.defaultPrevented;
  })()`)
  assert(await simulateInstall('dismissed'))
  await evaluate(`document.querySelector('.public-install-banner button').click()`)
  await wait(`window.__installPrompts===1&&!document.querySelector('[aria-labelledby="install-modal-title"]')`)
  assert(await evaluate(`!!document.querySelector('.public-install-banner')`), 'Dismissed native prompt keeps manual installation available')
  await simulateInstall('accepted', true)
  await evaluate(`document.querySelector('.public-install-banner button').click()`)
  await wait(`!!document.querySelector('.install-manual-guide')`)
  assert(await evaluate(`document.body.textContent.includes('Fixture install failure')`), 'Install failures are surfaced')
  await click('Continuar en el navegador')
  await simulateInstall('accepted')
  await evaluate(`document.querySelector('.public-install-banner button').click()`)
  await wait(`!document.querySelector('.public-install-banner')`)
  await command('Emulation.setUserAgentOverride', { userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile/15E148 Safari/604.1' })
  await reloadPublic()
  await wait(`!!document.querySelector('.public-install-banner')`)
  await evaluate(`document.querySelector('.public-install-banner button').click()`)
  await wait(`!!document.querySelector('.install-manual-guide')`)
  assert(await evaluate(`document.querySelector('.install-manual-guide').textContent.includes('Safari')&&document.querySelector('.install-manual-guide').textContent.includes('Compartir')`))
  await click('Continuar en el navegador')
  await command('Page.addScriptToEvaluateOnNewDocument', { source: `Object.defineProperty(navigator,'standalone',{get:()=>true})` })
  await reloadPublic()
  await wait(`!!document.querySelector('input[name="username"]')`)
  assert(await evaluate(`!document.querySelector('.public-install-banner')`), 'Standalone app does not offer installation')
  console.log('Public installation passed: Android fallback, native accepted/dismissed/error, persistent button, iPhone guide and standalone suppression.')
  }
  }

  if (process.env.TEST_VIDEO_ACCESS !== '1') {
  await evaluate(`(()=>{
    localStorage.setItem('fixture-medical','true');
    localStorage.setItem('drhappy-active-user','account-a');
    localStorage.setItem('drhappy-professional-session','token-account-a');
    localStorage.removeItem('drhappy-session-v2');
    const canvas=document.createElement('canvas');canvas.width=700;canvas.height=1000;
    const context=canvas.getContext('2d');context.fillStyle='white';context.fillRect(0,0,700,1000);
    context.fillStyle='black';context.font='32px sans-serif';context.fillText('Historia manuscrita de prueba',40,80);
    const image=canvas.toDataURL('image/jpeg');
    const stored=(id,type,dataUrl,category)=>({id,name:id+(type==='application/pdf'?'.pdf':'.jpg'),type,dataUrl,category,size:1000,uploadedAt:'2026-10-05T12:00:00Z'});
    const documents=[
      {...stored('paper-image','image/jpeg',image,'paper-record'),transcription:'Texto revisado <sin inventar> & original'},
      stored('paper-pdf','application/pdf','data:application/octet-stream;base64,${paperPdfFixture()}','paper-record'),
      stored('study-image','image/jpeg',image),
      stored('study-pdf','application/pdf','data:application/pdf;base64,${paperPdfFixture()}')
    ];
    const patient={id:'patient-account-a',ownerUserId:'account-a',nombre:'Paciente',apellido:'account-a',dni:'11111111',patologiasConocidas:'HTA histórica',patologiasCronicas:'Diabetes histórica',documents,consultations:[],createdAt:new Date().toISOString(),updatedAt:new Date().toISOString()};
    localStorage.setItem('fixture-document-patients',JSON.stringify([patient,{...patient,id:'patient-second',apellido:'Segundo',dni:'33333333',documents:[documents[2]]}]));
  })()`)
  await command('Page.reload')
  await ready('Profesional A')
  await click('Mis pacientes')
  await wait(`document.querySelector('.patient-directory-grid')?.textContent.includes('account-a')`)
  await click('Abrir ficha')
  await wait(`!!document.querySelector('.patient-documents-folder')`)
  if (process.env.TEST_CLINICAL_FOLLOW_UP !== '1') {
  assert(await evaluate(`!document.querySelector('.patient-documents-folder').open`), 'Documents start collapsed')
  assert.equal(await evaluate(`document.querySelectorAll('.paper-record-list img').length`), 0, 'No accumulated image thumbnails')
  await evaluate(`document.querySelector('.patient-documents-folder').open=true`)
  assert(await evaluate(`document.querySelector('.paper-record-list').textContent.includes('Imagen de HC en papel agregada')`))
  assert.equal(await evaluate(`document.querySelectorAll('.paper-record-item').length`), 4, 'Existing paper and general documents are retained')
  await checkTouchLayout('patient documents folder')
  await evaluate(`(()=>{
    const open=window.open.bind(window);window.__printCount=0;
    window.open=(...args)=>{const popup=open(...args);if(popup){window.__printWindow=popup;popup.print=()=>{window.__printCount++};popup.focus=()=>{}}return popup};
  })()`)
  const printSummary = async expectedPages => {
    const count = await evaluate('window.__printCount')
    await click('Imprimir resumen (PDF)')
    await wait(`window.__printCount===${count + 1}`)
    assert.equal(await evaluate(`window.__printWindow.document.querySelectorAll('.clinical-attachment-page').length`), expectedPages)
    assert(await evaluate(`Array.from(window.__printWindow.document.images).every(image=>image.complete&&image.naturalWidth>0)`), 'Every original and rendered PDF page loads before print')
    assert(await evaluate(`window.__printWindow.document.body.textContent.includes('Texto revisado <sin inventar> & original')`), 'Reviewed text remains escaped and accompanies the original')
    assert(await evaluate(`window.__printWindow.document.querySelector('.clinical-attachment-page').previousElementSibling.textContent.includes('Atención clínica')`), 'Original documents are annexed after the clinical summary')
  }
  await printSummary(3)
  assert.equal(await evaluate(`window.__printWindow.document.querySelectorAll('.clinical-attachment-page')[2].textContent.includes('Página 2 de 2')`), true, 'Both PDF pages are included, not just the file name')
  const colors = await evaluate(`(async()=>{
    const images=Array.from(window.__printWindow.document.querySelectorAll('.clinical-attachment-page img')).slice(1);
    return images.map(image=>{const canvas=document.createElement('canvas');canvas.width=image.naturalWidth;canvas.height=image.naturalHeight;const c=canvas.getContext('2d');c.drawImage(image,0,0);return Array.from(c.getImageData(Math.floor(canvas.width/2),Math.floor(canvas.height/2),1,1).data)});
  })()`)
  assert(colors[0][2] > 200 && colors[0][0] < 40, 'First PDF page is rendered in blue')
  assert(colors[1][0] > 200 && colors[1][2] < 40, 'Second PDF page is rendered in red')
  await evaluate(`window.__printWindow.close();document.querySelectorAll('.patient-document-print-choice input').forEach(input=>input.click())`)
  await printSummary(6)
  const popupId = (await command('Target.getTargets')).targetInfos.find(target => target.type === 'page' && target.url === 'about:blank').targetId
  const popupSession = (await command('Target.attachToTarget', { targetId: popupId, flatten: true })).sessionId
  const rendered = await command('Page.printToPDF', { preferCSSPageSize: true, printBackground: true }, popupSession)
  const { getDocument } = await import('pdfjs-dist/legacy/build/pdf.mjs')
  const task = getDocument({ data: new Uint8Array(Buffer.from(rendered.data, 'base64')) })
  try {
    const pdf = await task.promise
    assert.equal(pdf.numPages, 8, 'Export has clinical summary, six original pages and reviewed transcription with no missing/blank pages')
  } finally {
    await task.destroy()
  }
  await evaluate(`window.__printWindow.close()`)
  await click('Mis pacientes')
  await evaluate(`Array.from(document.querySelectorAll('.patient-directory-card')).find(card=>card.textContent.includes('Segundo')).querySelector('button').click()`)
  await wait(`!!document.querySelector('.patient-documents-folder')`)
  await evaluate(`document.querySelector('.patient-documents-folder').open=true`)
  assert(await evaluate(`!document.querySelector('.patient-document-print-choice input').checked`), 'Print selections do not leak to a different patient')
  await click('Mis pacientes')
  await click('Abrir ficha')
  await wait(`!!document.querySelector('#patient-document-upload')`)
  await evaluate(`(()=>{
    const input=document.querySelector('#patient-document-upload');const transfer=new DataTransfer();
    transfer.items.add(new File([Uint8Array.from(atob('${paperPdfFixture()}'),c=>c.charCodeAt(0))],'Estudio agregado.pdf',{type:'application/pdf'}));
    input.files=transfer.files;input.dispatchEvent(new Event('change',{bubbles:true}));
  })()`)
  await wait(`document.querySelector('.paper-record-list')?.textContent.includes('Estudio agregado.pdf')`)
  assert(await evaluate(`JSON.parse(localStorage.getItem('fixture-document-patients'))[0].documents.some(doc=>doc.name==='Estudio agregado.pdf'&&!doc.category)`), 'General uploads are saved without automatically classifying them as paper history')
  await evaluate(`(()=>{
    const input=document.querySelector('#paper-record-upload');const transfer=new DataTransfer();
    transfer.items.add(new File(['not a PDF'],'Roto.pdf',{type:'application/pdf'}));
    input.files=transfer.files;input.dispatchEvent(new Event('change',{bubbles:true}));
  })()`)
  await wait(`document.querySelectorAll('.paper-record-item').length===6`)
  const printedBeforeError = await evaluate('window.__printCount')
  await click('Imprimir resumen (PDF)')
  await wait(`document.querySelector('.app-error-toast p')?.textContent.includes('no se pudo preparar el PDF')`)
  assert.equal(await evaluate('window.__printCount'), printedBeforeError, 'Unreadable attachments abort instead of silently printing an incomplete history')
  await evaluate(`(()=>{
    const read=FileReader.prototype.readAsDataURL;
    FileReader.prototype.readAsDataURL=function(file){window.__finishDocumentRead=()=>{FileReader.prototype.readAsDataURL=read;read.call(this,file)}};
    const input=document.querySelector('#patient-document-upload');const transfer=new DataTransfer();
    transfer.items.add(new File([Uint8Array.from(atob('${paperPdfFixture()}'),c=>c.charCodeAt(0))],'No cruzar pacientes.pdf',{type:'application/pdf'}));
    input.files=transfer.files;input.dispatchEvent(new Event('change',{bubbles:true}));
  })()`)
  await wait(`typeof window.__finishDocumentRead==='function'`)
  await click('Mis pacientes')
  await evaluate(`Array.from(document.querySelectorAll('.patient-directory-card')).find(card=>card.textContent.includes('Segundo')).querySelector('button').click()`)
  await wait(`document.querySelectorAll('.paper-record-item').length===1`)
  await evaluate('window.__finishDocumentRead()')
  await wait(`Array.from(document.querySelectorAll('.app-error-toast p')).some(p=>p.textContent.includes('Cambiaste de paciente'))`)
  assert(await evaluate(`JSON.parse(localStorage.getItem('fixture-document-patients')).every(patient=>patient.documents.every(doc=>doc.name!=='No cruzar pacientes.pdf'))`), 'An upload interrupted by a patient switch is not attached to either record')
  console.log('Patient documents passed: collapsed text list, original preservation, multi-page PDF/color rendering, optional annex selection, eight-page PDF output, isolated patient choices, upload persistence and explicit unreadable-file failure.')
  } else {
    await click('Mis pacientes')
    await wait(`document.querySelector('.patient-directory-grid')?.textContent.includes('Segundo')`)
    await evaluate(`Array.from(document.querySelectorAll('.patient-directory-card')).find(card=>card.textContent.includes('Segundo')).querySelector('button').click()`)
    await wait(`!!document.querySelector('input[name=tallaCm]')`)
  }
  const setClinicalField = async (selector, value) => {
    await evaluate(`(()=>{
      const input=document.querySelector(${JSON.stringify(selector)});
      if(!input)throw new Error('Missing clinical field: '+${JSON.stringify(selector)});
      Object.getOwnPropertyDescriptor(input.tagName==='TEXTAREA'?HTMLTextAreaElement.prototype:HTMLInputElement.prototype,'value').set.call(input,${JSON.stringify(value)});
      input.dispatchEvent(new Event('input',{bubbles:true}));
    })()`)
    await sleep(50)
  }
  const storedClinicalPatient = `JSON.parse(localStorage.getItem('fixture-document-patients')).find(p=>p.id==='patient-second')`
  assert.equal(await evaluate(`document.querySelector('.clinical-identity-details').open`), false, 'Existing identity starts collapsed')
  await click('Modificar datos del paciente')
  await evaluate(`document.querySelector('.clinical-identity-details summary').click()`)
  assert.equal(await evaluate(`document.querySelector('.clinical-identity-details').open`), true, 'Identity and insurance expand together')
  await setClinicalField('input[name=numeroAfiliado]', '12345678901234567890')
  assert.equal(await evaluate(`document.querySelector('[name=patologiasCronicas]').value`),'HTA histórica\nDiabetes histórica','Known and chronic antecedents remain visible together')
  await setClinicalField('input[name=pesoInicial]', '72,5')
  await setClinicalField('input[name=tallaCm]', '170')
  await setClinicalField('input[name=tensionArterial]', '120/80')
  await setClinicalField('.patient-record-panel .clinical-medication-field textarea', 'Metformina 500 mg cada 12 h')
  await setClinicalField('textarea[name=patologiasCronicas]', 'Hipertensión arterial\nDiabetes')
  assert.equal(await evaluate(`document.querySelectorAll('textarea[name=patologiasConocidas]').length`), 0, 'Only one pathology field')
  await setClinicalField('input[name=diagnosticoPrincipal]', 'hipertens')
  await evaluate(`document.querySelector('input[name=diagnosticoPrincipal]').focus()`)
  await wait(`!!document.querySelector('.clinical-diagnosis-field .clinical-suggestions button')`)
  assert(await evaluate(`document.querySelector('.clinical-diagnosis-field .clinical-suggestions').textContent.toLowerCase().includes('hipertens')`), 'CIE10 is active in initial record')
  await setClinicalField('input[name=diagnosticoPrincipal]', 'Diagnóstico propio de prueba compacta')
  await evaluate(`document.querySelector('input[name=diagnosticoPrincipal]').dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}))`)
  assert(await evaluate(`document.body.innerText.includes('25.09 kg/m²')`), 'Initial IMC updates from comma decimals')
  await checkTouchLayout('clinical baseline and habitual medication')
  await command('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false })
  await sleep(300)
  const baselineLayout = await evaluate(`(()=>{
    const fields=['pesoInicial','tallaCm','tensionArterial'].map(name=>document.querySelector('input[name='+name+']').getBoundingClientRect());
    return {height:document.querySelector('.screen-stage.clinical-compact').getBoundingClientRect().height,
      tops:fields.map(r=>r.top),widths:fields.map(r=>r.width),saveWidth:document.querySelector('.clinical-save-row button').getBoundingClientRect().width};
  })()`)
  assert(baselineLayout.height < 1700, 'Initial record must be substantially shorter than previous 2637px capture: '+JSON.stringify(baselineLayout))
  assert(Math.max(...baselineLayout.tops)-Math.min(...baselineLayout.tops)<2, 'Measurements share one desktop row')
  assert(baselineLayout.widths.every(width=>width<200), 'Measurements use small fields')
  assert(baselineLayout.saveWidth<240, 'Save is not full-width')
  const identityWidths=await evaluate(`Object.fromEntries(['nombre','apellido','obraSocial','numeroAfiliado','plan'].map(name=>[name,document.querySelector('input[name='+name+']').getBoundingClientRect().width]))`)
  for(const [name,width] of Object.entries(identityWidths)) assert(width>=140&&width<=250,'Real bounded input width for '+name+': '+width)
  assert.equal(await evaluate(`document.querySelector('[name=numeroAfiliado]').maxLength`), -1, 'Visual width does not truncate affiliate numbers')
  await setClinicalField('.patient-record-panel .clinical-medication-field input', 'losartan 50')
  await wait(`!!document.querySelector('.patient-record-panel .clinical-medication-field .search-suggestions button')`)
  await evaluate(`document.querySelector('.patient-record-panel .clinical-medication-field .search-suggestions button').click()`)
  await wait(`!!document.querySelector('.clinical-medication-choice')`)
  const historyGap=await evaluate(`(()=>{const first=document.querySelector('[name=patologiasCronicas]').getBoundingClientRect();const next=document.querySelector('[name=ultimaInternacion]').closest('label').getBoundingClientRect();return next.top-first.bottom})()`)
  assert(historyGap<=12,'Medication selector must not create a blank row below pathologies: '+historyGap)
  await click('Cancelar')
  await evaluate(`document.querySelector('.clinical-identity-details summary').click()`)
  console.log('Compact initial layout: '+JSON.stringify(baselineLayout))
  await captureClinicalScreen('Ficha-inicial')
  await click('Guardar ficha')
  await wait(`${storedClinicalPatient}.pesoInicial==='72,5'`)
  assert.equal(await evaluate(`${storedClinicalPatient}.numeroAfiliado`),'12345678901234567890','Bounded visual field preserves all characters')
  await click('+ Evolucionar paciente')
  await wait(`!!document.querySelector('.evolution-form')`)
  await setClinicalField('.evolution-form input[name=pesoActual]', '70')
  assert(await evaluate(`document.querySelector('.evolution-form').textContent.includes('24.22 kg/m²')`))
  assert.equal(await evaluate(`document.querySelector('.evolution-form input').name`), 'pesoActual', 'Weight precedes reason')
  await setClinicalField('.evolution-form input[name=tensionArterial]', '130/85')
  assert(await evaluate(`document.querySelector('.evolution-form [name=tensionArterial]').getBoundingClientRect().top<document.querySelector('.evolution-form [name=motivoConsulta]').getBoundingClientRect().top`), 'Current blood pressure precedes reason')
  assert.equal(await evaluate(`document.querySelectorAll('.clinical-dictation-toggle').length`),1,'Only one dictation toggle')
  assert(!await evaluate(`document.querySelector('.evolution-form').textContent.includes('Pulir con Sofía')`),'No redundant AI polish button')
  await setClinicalField('.evolution-form textarea[name=enfermedadActual]', 'Texto previo.')
  for(const android of [false,true]){
    await evaluate(`Object.defineProperty(navigator,'userAgent',{configurable:true,value:${JSON.stringify(android ? 'Android Chrome' : 'Desktop Edge')}})`)
    await click('🎙 Dictar')
    assert(await evaluate(`window.__speechSessions.at(-1).interimResults===true&&document.querySelector('.clinical-dictation-toggle').getAttribute('aria-pressed')==='true'`),'Interim transcription enabled on '+(android?'Android':'desktop'))
    await evaluate(`window.__speechSessions.at(-1).emit([['paciente con',false]])`)
    await wait(`document.querySelector('[name=enfermedadActual]').value.includes('Paciente con')`)
    await evaluate(`window.__speechSessions.at(-1).emit([['paciente con fiebre',false]])`)
    await wait(`document.querySelector('[name=enfermedadActual]').value.includes('Paciente con fiebre')`)
    await evaluate(`window.__speechSessions.at(-1).emit([['paciente con fiebre',true],['desde ayer',false]])`)
    await wait(`document.querySelector('[name=enfermedadActual]').value.toLowerCase().includes('desde ayer')`)
    const visibleDictation=await evaluate(`document.querySelector('[name=enfermedadActual]').value`)
    assert.equal((visibleDictation.match(/Paciente con fiebre/g)||[]).length,1,'Interim revisions do not duplicate words')
    await click('⏹ Detener dictado')
    assert(await evaluate(`window.__speechSessions.at(-1).stopped&&document.querySelector('.clinical-dictation-toggle').getAttribute('aria-pressed')==='false'`),'Same button stops recognizer')
    await evaluate(`window.__speechSessions.at(-1).emit([['respuesta tardía no guardar',true]])`)
    assert.equal(await evaluate(`document.querySelector('[name=enfermedadActual]').value`),visibleDictation,'Stopping freezes visible interim text')
    await click('🎙 Dictar')
    await evaluate(`window.__speechSessions.at(-2).onend()`)
    assert(await evaluate(`document.querySelector('.clinical-dictation-toggle').getAttribute('aria-pressed')==='true'`),'Old onend cannot stop new session')
    await setClinicalField('[name=enfermedadActual]','Corrección manual.')
    await evaluate(`window.__speechSessions.at(-1).emit([['no sobrescribir',true]])`)
    assert.equal(await evaluate(`document.querySelector('[name=enfermedadActual]').value`),'Corrección manual.','Manual edits stop dictation and survive late events')
    await setClinicalField('[name=enfermedadActual]','Texto previo.')
  }
  await click('🎙 Dictar')
  await evaluate(`window.__speechSessions.at(-1).onerror({error:'not-allowed'})`)
  await wait(`document.querySelector('.clinical-dictation-toggle').getAttribute('aria-pressed')==='false'`)
  await wait(`Array.from(document.querySelectorAll('.app-error-toast p')).some(p=>p.textContent.includes('Permiso de micrófono denegado'))`)
  await evaluate(`document.querySelectorAll('.app-error-toast button').forEach(button=>button.click())`)
  assert.equal(await evaluate(`document.querySelectorAll('.evolution-form [name=examenFisico],.evolution-form [name=pensamientoMedico],.evolution-form [name=detalleAtencion]').length`), 0, 'Removed fields are absent')
  assert.equal(await evaluate(`document.querySelectorAll('.evolution-form input[type=checkbox]').length`), 0, 'No habitual medication checkbox')
  await setClinicalField('.evolution-form textarea[name=enfermedadActual]', 'Buen estado general. Control de peso y adherencia al tratamiento.')
  await setClinicalField('.evolution-form input[name=impresionDiagnostica]', 'Diagnóstico propio de prueba compacta')
  await evaluate(`document.querySelector('.evolution-form input[name=impresionDiagnostica]').focus()`)
  await wait(`document.querySelector('.evolution-form .clinical-suggestions')?.textContent.includes('Diagnóstico propio de prueba compacta')`)
  await evaluate(`document.querySelector('.evolution-form input[name=impresionDiagnostica]').dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}))`)
  await setClinicalField('.evolution-form textarea[name=planManejo]', 'Control clínico y seguimiento.')
  const drugField = '.evolution-form .clinical-medication-field'
  await setClinicalField(`${drugField} input`, 'enalapril')
  await wait(`!!document.querySelector(${JSON.stringify(drugField + ' .search-suggestions button')})`)
  await evaluate(`document.querySelector(${JSON.stringify(drugField + ' .search-suggestions button')}).click()`)
  assert(await evaluate(`document.querySelector('.clinical-medication-choice').textContent.includes('Posología de referencia')`), 'Catalogue dosing is available')
  assert(await evaluate(`document.querySelector('.clinical-medication-choice strong').textContent.includes('mg')`), 'Selected medicine includes strength and presentation')
  await setClinicalField('.clinical-medication-choice input', '1 comprimido cada 24 h')
  await click('Agregar medicamento')
  assert(await evaluate(`document.querySelector(${JSON.stringify(drugField + ' textarea')}).value.toLowerCase().includes('enalapril')`), 'Generic is selected from the real vademecum')
  await setClinicalField(`${drugField} textarea`, 'Enalapril 5 mg por día')
  await setClinicalField('.evolution-form textarea[name=estudiosComplementarios]', 'Hemograma\nRevisar resultados en el próximo control')
  await setClinicalField('.evolution-form input[name=motivoConsulta]', 'Control de peso')
  await checkTouchLayout('clinical evolution')
  await command('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false })
  await sleep(300)
  const evolutionHeight=await evaluate(`document.querySelector('.screen-stage.clinical-compact').getBoundingClientRect().height`)
  assert(await evaluate(`document.querySelector('[name=motivoConsulta]').getBoundingClientRect().width<=530`),'Reason has bounded width, not the whole screen')
  assert(await evaluate(`document.querySelector('.evolution-form [name=tensionArterial]').getBoundingClientRect().width<=150`),'Blood pressure is a small field')
  assert(evolutionHeight<1900, 'Evolution must be substantially shorter than previous 3198px capture: '+evolutionHeight)
  console.log('Compact evolution height: '+evolutionHeight)
  await captureClinicalScreen('Evolucion')
  const originalIllness=await evaluate(`document.querySelector('[name=enfermedadActual]').value`)
  await click('Valorar evolución con Sofía')
  await wait(`!!document.querySelector('[name=resumenSofia]')`)
  assert.equal(await evaluate(`document.querySelector('[name=enfermedadActual]').value`),originalIllness,'AI does not overwrite fields')
  assert(await evaluate(`window.__clinicalAiBody.mode==='clinical-evolution-review'&&window.__clinicalAiBody.messages[0].content.includes('Enalapril 5 mg')&&window.__clinicalAiBody.messages[0].content.includes('Hemograma')&&window.__clinicalAiBody.messages[0].content.includes('Control clínico')`), 'AI reads all fields using no-tools review mode')
  await click('Guardar evolución')
  await wait(`${storedClinicalPatient}.consultations.length===1`)
  assert.equal(await evaluate(`${storedClinicalPatient}.medicacionHabitual`), 'Metformina 500 mg cada 12 h', 'Drug additions stay only in dated evolution')
  assert.equal(await evaluate(`${storedClinicalPatient}.consultations[0].resumenSofia`), '', 'Unapproved AI review is not saved')
  assert.equal(await evaluate(`${storedClinicalPatient}.consultations[0].tallaCmEnConsulta`), '170')
  assert.equal(await evaluate(`${storedClinicalPatient}.consultations[0].tensionArterial`), '130/85')
  assert.equal(await evaluate(`${storedClinicalPatient}.tensionArterial`), '120/80', 'Current blood pressure never overwrites baseline')
  assert(await evaluate(`document.querySelector('.consultation-list').textContent.includes('Revisar resultados')`))
  await setClinicalField('.evolution-form input[name=pesoActual]', '0')
  await setClinicalField('.evolution-form input[name=motivoConsulta]', 'Segundo control')
  await click('Guardar evolución')
  await wait(`Array.from(document.querySelectorAll('.app-error-toast p')).some(p=>p.textContent.includes('Peso actual'))`)
  assert.equal(await evaluate(`${storedClinicalPatient}.consultations.length`), 1, 'Invalid weight cannot be saved')
  await setClinicalField('.evolution-form input[name=pesoActual]', '69,5')
  await setClinicalField('.evolution-form input[name=tensionArterial]', '120')
  await click('Guardar evolución')
  await wait(`Array.from(document.querySelectorAll('.app-error-toast p')).some(p=>p.textContent.includes('Tensión arterial'))`)
  assert.equal(await evaluate(`${storedClinicalPatient}.consultations.length`),1,'Malformed current blood pressure cannot be saved')
  await setClinicalField('.evolution-form input[name=tensionArterial]', '125/80')
  await setClinicalField(`${drugField} textarea`, 'Losartán 50 mg por día')
  await setClinicalField('.evolution-form textarea[name=enfermedadActual]', 'Segundo control sin eventos nuevos.')
  await evaluate(`(()=>{
    const input=document.querySelector('#sofia-clinical-document');const transfer=new DataTransfer();
    transfer.items.add(new File(['Glucemia: 110 mg/dL'],'Laboratorio-ficticio.txt',{type:'text/plain'}));
    input.files=transfer.files;input.dispatchEvent(new Event('change',{bubbles:true}));
  })()`)
  await wait(`document.querySelector('.evolution-sofia-panel').textContent.includes('Laboratorio-ficticio.txt')`)
  await evaluate(`window.__failClinicalAi=true`)
  await click('Valorar evolución con Sofía')
  await wait(`Array.from(document.querySelectorAll('.app-error-toast p')).some(p=>p.textContent.includes('Revisión simulada fallida'))`)
  assert.equal(await evaluate(`document.querySelector('[name=enfermedadActual]').value`),'Segundo control sin eventos nuevos.','AI failure never loses original fields')
  await evaluate(`window.__failClinicalAi=false;window.__delayClinicalAi=true`)
  await click('Valorar evolución con Sofía')
  await wait(`typeof window.__finishClinicalAi==='function'`)
  await setClinicalField('.evolution-form textarea[name=planManejo]', 'Plan actualizado mientras Sofía responde')
  await evaluate(`window.__delayClinicalAi=false;window.__finishClinicalAi()`)
  await wait(`Array.from(document.querySelectorAll('.app-error-toast p')).some(p=>p.textContent.includes('La evolución cambió'))`)
  assert.equal(await evaluate(`document.querySelectorAll('[name=resumenSofia]').length`),0,'Stale review is rejected')
  await click('Valorar evolución con Sofía')
  await wait(`!!document.querySelector('[name=resumenSofia]')`)
  assert(await evaluate(`window.__clinicalAiBody.messages[0].content.includes('Glucemia: 110 mg/dL')`),'AI reads the attached lab with all current fields')
  await setClinicalField('[name=resumenSofia]', 'Resumen revisado y editado por el profesional.')
  await click('Adjuntar resumen al guardar')
  await click('Guardar evolución')
  await wait(`${storedClinicalPatient}.consultations.length===2`)
  assert.equal(await evaluate(`${storedClinicalPatient}.medicacionHabitual`), 'Metformina 500 mg cada 12 h')
  assert.equal(await evaluate(`${storedClinicalPatient}.consultations[0].resumenSofia`), 'Resumen revisado y editado por el profesional.')
  assert.equal(await evaluate(`${storedClinicalPatient}.consultations[0].tensionArterial`), '125/80')
  assert(await evaluate(`${storedClinicalPatient}.documents.some(file=>file.name==='Laboratorio-ficticio.txt'&&file.dataUrl.startsWith('data:text/plain'))`),'Original lab is stored on save')
  assert(await evaluate(`(async()=>{
    const {verifySignatureSeal}=await import('/src/signatureSeal.ts');
    const patient=${storedClinicalPatient};const entry=patient.consultations[0];
    const content={patientId:patient.id,patientDni:patient.dni,motivoConsulta:entry.motivoConsulta,
      detalleAtencion:entry.detalleAtencion,pensamientoMedico:entry.pensamientoMedico,
      enfermedadActual:entry.enfermedadActual,impresionDiagnostica:entry.impresionDiagnostica,planManejo:entry.planManejo,
      pesoActual:entry.pesoActual,tensionArterial:entry.tensionArterial,tallaCmEnConsulta:entry.tallaCmEnConsulta,
      farmacosAgregados:entry.farmacosAgregados,estudiosComplementarios:entry.estudiosComplementarios,
      resumenSofia:entry.resumenSofia,
      signatureImageDataUrl:entry.professionalSignature.signatureImageDataUrl||''};
    return await verifySignatureSeal({contentToVerify:content,seal:entry.signatureSeal})&&
      !await verifySignatureSeal({contentToVerify:{...content,pesoActual:'99'},seal:entry.signatureSeal})&&
      !await verifySignatureSeal({contentToVerify:{...content,tensionArterial:'150/90'},seal:entry.signatureSeal});
  })()`), 'Signed measurements verify and detect tampering')
  await command('Page.reload')
  await ready('Profesional A')
  await click('Mis pacientes')
  await wait(`document.querySelector('.patient-directory-grid')?.textContent.includes('Segundo')`)
  await evaluate(`Array.from(document.querySelectorAll('.patient-directory-card')).find(card=>card.textContent.includes('Segundo')).querySelector('button').click()`)
  await wait(`!!document.querySelector('input[name=tallaCm]')`)
  assert.equal(await evaluate(`document.querySelector('input[name=tallaCm]').value`), '170', 'Baseline survives cloud reload normalization')
  await click('Modificar datos del paciente')
  await setClinicalField('input[name=tallaCm]', '180')
  await click('Guardar ficha')
  await wait(`${storedClinicalPatient}.tallaCm==='180'`)
  await click('+ Evolucionar paciente')
  await wait(`!!document.querySelector('.consultation-list')`)
  assert(await evaluate(`document.querySelector('.consultation-list').textContent.includes('24.22 kg/m²')`), 'Editing baseline height does not rewrite old IMC')
  await evaluate(`document.querySelector('.clinical-baseline-strip details').open=true`)
  assert(await evaluate(`document.body.innerText.includes('-3.00 kg')`), 'Current weight is compared with initial weight')
  await evaluate(`(()=>{
    const open=window.open.bind(window);window.__clinicalPrintCount=0;
    window.open=(...args)=>{const popup=open(...args);if(popup){window.__clinicalPrintWindow=popup;popup.print=()=>{window.__clinicalPrintCount++};popup.focus=()=>{}}return popup};
    document.querySelector('.consultation-list button').click();
  })()`)
  await wait(`window.__clinicalPrintCount===1`)
  assert(await evaluate(`window.__clinicalPrintWindow.document.body.textContent.includes('Losartán 50 mg por día')`), 'Evolution PDF includes added medication')
  assert(await evaluate(`window.__clinicalPrintWindow.document.body.textContent.includes('125/80')`), 'Current blood pressure survives reload and evolution printing')
  await evaluate(`window.__clinicalPrintWindow.close()`)
  await click('Volver a la ficha')
  assert.equal(await evaluate(`document.querySelector('.patient-record-panel .clinical-medication-field textarea').value`), 'Metformina 500 mg cada 12 h', 'Habitual medication survives cloud reload unchanged')
  await click('Imprimir resumen (PDF)')
  await wait(`window.__clinicalPrintCount===2`)
  const summaryText = await evaluate(`window.__clinicalPrintWindow.document.body.textContent`)
  for (const text of ['Peso inicial:', '72,5', '120/80', '130/85', '125/80', 'Metformina 500 mg', 'Enalapril 5 mg por día', 'Revisar resultados en el próximo control']) {
    assert(summaryText.includes(text), 'History PDF retains baseline and every dated instruction: ' + text)
  }
  await evaluate(`window.__clinicalPrintWindow.close()`)
  await click('+ Evolucionar paciente')
  await wait(`!!document.querySelector('.evolution-form')`)
  await setClinicalField('.evolution-form input[name=motivoConsulta]', 'Control sin antropometría')
  await click('Guardar evolución')
  await wait(`${storedClinicalPatient}.consultations.length===3`)
  assert.equal(await evaluate(`${storedClinicalPatient}.consultations[0].pesoActual`), '', 'Measurement remains optional')
  assert.equal(await evaluate(`${storedClinicalPatient}.consultations[2].tallaCmEnConsulta`), '170', 'Subsequent controls never overwrite previous snapshots')
  await setClinicalField('.evolution-form input[name=motivoConsulta]', 'Borrador que no debe cruzar pacientes')
  await evaluate(`window.__delayClinicalAi=true;window.__finishClinicalAi=null`)
  await click('Valorar evolución con Sofía')
  await wait(`typeof window.__finishClinicalAi==='function'`)
  await click('🎙 Dictar')
  await click('Mis pacientes')
  await wait(`!!document.querySelector('.patient-directory-grid')`)
  await evaluate(`Array.from(document.querySelectorAll('.patient-directory-card')).find(card=>card.textContent.includes('account-a')).querySelector('button').click()`)
  await wait(`!!document.querySelector('input[name=tallaCm]')`)
  assert(await evaluate(`window.__speechSessions.at(-1).stopped`),'Leaving a patient stops the microphone')
  await evaluate(`window.__speechSessions.at(-1).emit([['dictado del paciente anterior',true]])`)
  await evaluate(`window.__delayClinicalAi=false;window.__finishClinicalAi()`)
  await wait(`Array.from(document.querySelectorAll('.app-error-toast p')).some(p=>p.textContent.includes('La evolución cambió'))`)
  await click('+ Evolucionar paciente')
  await wait(`!!document.querySelector('.evolution-form')`)
  assert.equal(await evaluate(`document.querySelector('[name=motivoConsulta]').value`),'','Switching patients clears the unrelated clinical draft')
  assert.equal(await evaluate(`document.querySelectorAll('[name=resumenSofia]').length`),0,'AI response cannot cross patients')
  await setClinicalField('[name=impresionDiagnostica]', 'Diagnóstico propio de prueba compacta')
  await wait(`document.querySelector('.evolution-form .clinical-suggestions')?.textContent.includes('Diagnóstico propio de prueba compacta')`)
  console.log('Compact clinical screens passed: collapsed identity, bounded input widths without length limits, independent history columns, small weight/current BP above reason, interim desktop/Android dictation and same-button stop, late-event/manual-edit/patient-switch protection, visible mic errors, mobile layout, CIE10, medication, optional AI review, BP validation/signature/reload/PDF and unchanged baseline.')
  }
} finally {
  if (socket?.readyState === WebSocket.OPEN) socket.close()
  browser.kill()
  await sleep(1500)
  await rm(profile, { recursive: true, force: true, maxRetries: 3, retryDelay: 500 })
}
