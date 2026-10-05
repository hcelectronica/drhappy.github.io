import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdtemp, rm } from 'node:fs/promises'
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
    for (const [width, height] of [[320, 568], [375, 667], [390, 844], [430, 932], [844, 390]]) {
      await command('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: true })
      await evaluate(`new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))`)
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
  await command('Page.enable')
  await command('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 })
  await command('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true })
  await command('Page.addScriptToEvaluateOnNewDocument', { source: `
    if(location.origin===${JSON.stringify(origin)}){
      window.__instance=crypto.randomUUID();
      window.addEventListener('beforeinstallprompt',event=>{
        if(!event.fixture){event.preventDefault();event.stopImmediatePropagation()}
      });
      const account=id=>({id,username:id,full_name:id==='account-a'?'Profesional A':'Profesional B',
        specialty:'Odontologia',license_number:'TEST',email:id+'@example.invalid',active:true,is_admin:id==='account-b',
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
              createdAt:new Date().toISOString(),updatedAt:new Date().toISOString()}],appointments_json:[],
            treatment_ledger_json:[],treatment_ledger_initialized:true}};
        }
        if(url.endsWith('/patient-invite'))data={success:true,submissions:[]};
        return new Response(JSON.stringify(data),{status:200,headers:{'Content-Type':'application/json'}});
      };
    }
  ` })
  await command('Page.navigate', { url: origin + '/' })
  const ready = (name) => wait(`document.body?.innerText.includes(${JSON.stringify(name)})&&Array.from(document.querySelectorAll('button')).some(b=>b.textContent.includes('Cerrar sesión'))`)
  await ready('Profesional A')
  assert.equal(await evaluate(`document.querySelectorAll('button.video-pilot-link').length`), 0, 'Non-admin does not see video pilot links')
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
  const videoLinkSelector = 'button.video-pilot-link'
  assert.equal(await evaluate(`document.querySelectorAll(${JSON.stringify(videoLinkSelector)}).length`), 2, 'Admin sees header and navigation video links')
  for (const [width, height, mobile] of [[1280, 900, false], [390, 844, true]]) {
    await command('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile })
    assert.deepEqual(await evaluate(`Array.from(document.querySelectorAll(${JSON.stringify(videoLinkSelector)})).map(a=>({type:a.type,text:a.textContent.includes('Videoconsulta')}))`),
      Array.from({ length: 2 }, () => ({ type: 'button', text: true })))
    assert(await evaluate(`document.querySelector('button.video-pilot-link.ghost').getBoundingClientRect().height>=44`), 'Header video link has a usable touch target')
    await evaluate(`document.querySelector('.sidebar-handle').click()`)
    await wait(`document.querySelector('.app-sidebar').classList.contains('open')`)
    assert(await evaluate(`(()=>{const a=document.querySelector('.sidebar-nav button.video-pilot-link');a.focus();const r=a.getBoundingClientRect();return document.activeElement===a&&r.width>=42&&r.height>=44&&getComputedStyle(a).display!=='none'})()`), 'Navigation video link is keyboard focusable with a usable touch target')
    await command('Page.bringToFront')
    await command('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter', text: '\r', unmodifiedText: '\r', windowsVirtualKeyCode: 13 })
    await command('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 })
    let videoTab
    for (let attempt = 0; attempt < 100; attempt++) {
      videoTab = (await command('Target.getTargets')).targetInfos.find(tab => tab.type === 'page' && tab.url.startsWith('https://video.drhappy.com.ar/'))
      if (videoTab) break
      await sleep(100)
    }
    assert(videoTab, 'Video link opens the public pilot in a separate tab: ' + await evaluate(`JSON.stringify({body:document.body.innerText.slice(-1800),calls:window.__calls.filter(call=>call.slug==='video-handoff')})`))
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
  await evaluate(`window.__savedOpen=window.open;window.open=()=>null;document.querySelector('button.video-pilot-link.ghost').click()`)
  await wait(`document.body.innerText.includes('El navegador bloqueó la pestaña')`)
  await evaluate(`window.open=window.__savedOpen;window.__failVideo=true;document.querySelector('button.video-pilot-link.ghost').click()`)
  await wait(`document.body.innerText.includes('Pase de prueba rechazado.')&&!document.querySelector('button.video-pilot-link.ghost').disabled`)
  await evaluate(`window.__failVideo=false;window.__delayVideo=true;document.querySelector('button.video-pilot-link.ghost').click()`)
  await wait(`!!window.__finishVideo&&document.querySelector('button.video-pilot-link.ghost').disabled`)
  await evaluate(`localStorage.setItem('drhappy-session-v2',JSON.stringify({userId:'account-a',token:'token-account-a'}));window.__finishVideo()`)
  await wait(`!document.querySelector('button.video-pilot-link.ghost').disabled`)
  assert.equal((await command('Target.getTargets')).targetInfos.filter(tab=>tab.url==='about:blank').length, 0, 'Failed/account-changed requests close their blank tabs')
  await evaluate(`window.__delayVideo=false;localStorage.setItem('drhappy-session-v2',JSON.stringify({userId:'account-b',token:'token-account-b'}))`)
  console.log('Video pilot access passed: permissions, keyboard/mobile entry, one-use fragment, no opener, blocked popup, rejected pass and account-change cleanup.')
  await evaluate(`window.__finishWorkspace()`)
  await sleep(500)
  assert(await evaluate(`document.body.innerText.includes('Profesional B')&&!document.body.innerText.includes('Profesional A')`))
  await click('Mis pacientes')
  await wait(`document.querySelector('.patient-directory-grid')?.textContent.includes('account-b')`)
  assert(await evaluate(`!document.querySelector('.patient-directory-grid').textContent.includes('account-a')`), 'Old account patients cannot reappear')
  await click('Cerrar sesión')
  await wait(`!!document.querySelector('input[name="username"]')`)
  assert.equal(await evaluate(`document.querySelectorAll('button.video-pilot-link').length`), 0, 'Logout removes admin video access')
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
} finally {
  if (socket?.readyState === WebSocket.OPEN) socket.close()
  browser.kill()
  await sleep(1500)
  await rm(profile, { recursive: true, force: true, maxRetries: 3, retryDelay: 500 })
}
