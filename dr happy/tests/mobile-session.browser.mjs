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
  const wait = async (expression) => {
    for (let attempt = 0; attempt < 250; attempt++) {
      if (await evaluate(expression)) return
      await sleep(100)
    }
    throw new Error('UI timeout: ' + expression + '\n' + await evaluate('document.body.innerText.slice(-2000)'))
  }
  await command('Page.enable')
  await command('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true })
  await command('Page.addScriptToEvaluateOnNewDocument', { source: `
    if(location.origin===${JSON.stringify(origin)}){
      window.__instance=crypto.randomUUID();
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
  await evaluate(`window.__finishWorkspace()`)
  await sleep(500)
  assert(await evaluate(`document.body.innerText.includes('Profesional B')&&!document.body.innerText.includes('Profesional A')`))
  await click('Mis pacientes')
  await wait(`document.querySelector('.patient-directory-grid')?.textContent.includes('account-b')`)
  assert(await evaluate(`!document.querySelector('.patient-directory-grid').textContent.includes('account-a')`), 'Old account patients cannot reappear')
  await click('Cerrar sesión')
  await wait(`!!document.querySelector('input[name="username"]')`)
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
} finally {
  if (socket?.readyState === WebSocket.OPEN) socket.close()
  browser.kill()
  await sleep(1500)
  await rm(profile, { recursive: true, force: true, maxRetries: 3, retryDelay: 500 })
}
