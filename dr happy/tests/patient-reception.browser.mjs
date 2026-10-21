import assert from 'node:assert/strict'

const origin = process.env.TEST_PATIENT_ORIGIN || 'http://127.0.0.1:5194'
const cdp = process.env.TEST_PATIENT_CDP || 'http://127.0.0.1:9379'
const target = await (await fetch(`${cdp}/json/new?about:blank`, { method: 'PUT' })).json()
const socket = new WebSocket(target.webSocketDebuggerUrl)
await new Promise(resolve => socket.addEventListener('open', resolve))
let sequence = 0
const pending = new Map()
socket.addEventListener('message', message => {
  const event = JSON.parse(message.data), callback = pending.get(event.id)
  if (!callback) return
  pending.delete(event.id)
  if (event.error) callback.reject(new Error(JSON.stringify(event.error)))
  else callback.resolve(event.result)
})
const send = (method, params = {}) => new Promise((resolve, reject) => {
  const id = ++sequence; pending.set(id, { resolve, reject }); socket.send(JSON.stringify({ id, method, params }))
})
const evaluate = async expression => {
  const result = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })
  if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails))
  return result.result.value
}
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))
async function wait(expression) {
  for (let i = 0; i < 150; i++) { if (await evaluate(`!!(${expression})`)) return; await sleep(100) }
  throw new Error(`Timed out: ${expression}`)
}
async function navigate(query = '') {
  await send('Page.navigate', { url: `${origin}/tests/patient-reception.ui.html${query}` })
  await wait(`document.querySelector('#root')?.children.length > 0`)
}
try {
  await send('Page.enable')
  await navigate()
  await wait(`document.querySelectorAll('.reception-choice').length===5`)
  assert.deepEqual(await evaluate(`[...document.querySelectorAll('.reception-choice strong')].map(e=>e.textContent)`),
    ['Certificados y recetas', 'Evaluación de estudios', 'Turno presencial', 'Videoconsulta', 'Registrarse como paciente'])
  assert.equal(await evaluate(`document.querySelector('.reception-video').getAttribute('href')`), '/turnos/?p=fixture&m=private&consultation=video')
  assert.equal(await evaluate(`document.querySelector('.reception-registration').getAttribute('href')`), '/registro/fixture')
  assert.equal(await evaluate(`document.querySelector('.reception-brand image').getAttribute('href').includes('favicon.svg')`), true)
  for (const [width, height] of [[320, 568], [360, 640], [390, 844], [1280, 720], [844, 390]]) {
    await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: width < 600 })
    await sleep(100)
    const metrics = await evaluate(`({width:innerWidth,height:innerHeight,scrollWidth:document.documentElement.scrollWidth,scrollHeight:document.documentElement.scrollHeight,sections:[...document.querySelectorAll('.reception-page,.reception-shell,.reception-brand,.reception-card,.reception-card header,.reception-choice,footer')].map(e=>[e.className,e.getBoundingClientRect().height])})`)
    assert.ok(metrics.scrollWidth <= width && metrics.scrollHeight <= height, `Reception must fit ${width}x${height}: ${JSON.stringify(metrics)}`)
  }
  await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true })
  await navigate('?settings')
  await wait(`document.querySelector('.reception-settings input[type=checkbox]')`)
  await evaluate(`document.querySelectorAll('.reception-settings input[type=checkbox]')[4].click();document.querySelector('form').requestSubmit()`)
  await wait(`window.fixtureCalls.some(c=>c.action==='save-settings')`)
  assert.equal(await evaluate(`window.fixtureCalls.find(c=>c.action==='save-settings').settings.video`), false)
  assert.equal(await evaluate(`document.documentElement.scrollWidth>innerWidth`), false)
  const bookingCalls = []
  socket.addEventListener('message', async message => {
    const event = JSON.parse(message.data)
    if (event.method !== 'Fetch.requestPaused') return
    try {
      const body = event.params.request.method === 'OPTIONS' ? {} : JSON.parse(event.params.request.postData)
      if (body.action) bookingCalls.push(body)
      const response = body.action === 'get-public-agenda'
        ? { success: true, profile: { professionalName: 'Fixture', horizonDays: 60, location: 'Consultorio' },
          days: [{ date: new Date().toISOString().slice(0, 10), slots: [{ time: '15:00', blockId: 'fixture', modality: 'private', available: true, label: 'Consulta', location: 'Consultorio' }] }] }
        : { success: false, message: 'Fixture: sin reserva real ni pago.' }
      await send('Fetch.fulfillRequest', { requestId: event.params.requestId, responseCode: 200,
        responseHeaders: [{ name: 'Content-Type', value: 'application/json' }, { name: 'Access-Control-Allow-Origin', value: '*' }, { name: 'Access-Control-Allow-Headers', value: 'content-type,apikey,authorization' }],
        body: Buffer.from(JSON.stringify(response)).toString('base64') })
    } catch (error) { console.error(error); await send('Fetch.failRequest', { requestId: event.params.requestId, errorReason: 'Aborted' }) }
  })
  await send('Fetch.enable', { patterns: [{ urlPattern: '*supabase.co/functions/v1/public-booking*', requestStage: 'Request' }] })
  await send('Page.navigate', { url: `${origin}/turnos/index.html?p=fixture&m=private&consultation=video` })
  await wait(`document.querySelector('.first-available:not(:disabled)')`)
  assert.match(await evaluate(`document.querySelector('#title').textContent`), /Videoconsulta/)
  await evaluate(`document.querySelector('.first-available').click()`)
  assert.match(await evaluate(`document.querySelector('#selectedBox').textContent`), /Videoconsulta/)
  await evaluate(`document.querySelector('#patientLastName').value='Prueba';document.querySelector('#patientFirstName').value='Fixture';document.querySelector('#patientDni').value='12345678';document.querySelector('#patientEmail').value='fixture@example.invalid';document.querySelector('#confirmBtn').click()`)
  await wait(`document.querySelector('#message').textContent.includes('Fixture:')`)
  assert.equal(bookingCalls[0].modality, 'private')
  const request = bookingCalls.find(call => call.action === 'book-public-slot')
  assert.equal(request.consultationMode, 'video'); assert.equal(request.modality, 'private')
  await send('Fetch.disable')
  console.log('PASS: five correct destinations, Dr Happy logo, no page scroll 320x568/360x640/390x844/1280x720/844x390, professional toggle/save, paid booking UI forwards video origin without real booking.')
} finally {
  await send('Emulation.clearDeviceMetricsOverride').catch(() => {})
  const closed = new Promise(resolve => socket.addEventListener('close', resolve, { once: true }))
  socket.close(); await closed
  await (await fetch(`${cdp}/json/close/${target.id}`)).text()
  await sleep(100)
}
