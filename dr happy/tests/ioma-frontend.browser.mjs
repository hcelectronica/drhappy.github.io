import assert from 'node:assert/strict'

const origin = process.env.TEST_IOMA_ORIGIN || 'http://127.0.0.1:5196'
const cdp = process.env.TEST_IOMA_CDP || 'http://127.0.0.1:9381'
const target = await (await fetch(`${cdp}/json/new?about:blank`, { method: 'PUT' })).json()
const socket = new WebSocket(target.webSocketDebuggerUrl)
await new Promise(resolve => socket.addEventListener('open', resolve))
let sequence = 0
const pending = new Map()
socket.addEventListener('message', event => {
  const message = JSON.parse(event.data), callback = pending.get(message.id)
  if (!callback) return
  pending.delete(message.id)
  if (message.error) callback.reject(new Error(message.error.message))
  else callback.resolve(message.result)
})
const send = (method, params = {}) => new Promise((resolve, reject) => {
  const id = ++sequence; pending.set(id, { resolve, reject }); socket.send(JSON.stringify({ id, method, params }))
})
const evaluate = async expression => {
  const value = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })
  if (value.exceptionDetails) throw new Error(value.exceptionDetails.text)
  return value.result.value
}
async function wait(expression) {
  for (let i = 0; i < 150; i++) {
    if (await evaluate(`!!(${expression})`)) return
    await new Promise(resolve => setTimeout(resolve, 100))
  }
  throw new Error(`Timed out: ${expression}`)
}
try {
  await send('Page.enable')
  await send('Page.navigate', { url: `${origin}/tests/ioma-frontend.ui.html` })
  await wait(`document.querySelector('[name=medication]')`)
  await evaluate(`(() => {
    const form = document.querySelector('form')
    for (const [name, value] of Object.entries({ patientFirstName:'Prueba', patientLastName:'Ficticia',
      patientDni:'12345678', patientEmail:'fixture@example.invalid', patientPhone:'12345678',
      birthDate:'2000-01-01', insuranceMemberNumber:'fixture', medication:'Prueba' })) form.elements[name].value = value
    form.elements.consent.checked = true
    form.requestSubmit()
  })()`)
  await wait(`window.fixtureCalls.some(item => item.action === 'submit')`)
  await wait(`document.body.textContent.includes('No se confirmó el envío de la notificación')`)
  const submission = await evaluate(`window.fixtureCalls.find(item => item.action === 'submit')`)
  assert.equal('image' in submission, false)
  assert.equal('token' in submission, false)
  assert.equal(submission.consent, true)
  assert.equal(submission.medication, 'Prueba')

  await send('Page.navigate', { url: `${origin}/tests/ioma-frontend.ui.html?settings` })
  await wait(`document.querySelectorAll('.ioma-request').length === 100`)
  await evaluate(`document.querySelector('.ioma-settings input[type=checkbox]').click(); [...document.querySelectorAll('button')].find(x => x.textContent.includes('Guardar configuración')).click()`)
  await wait(`window.fixtureCalls.some(item => item.action === 'save-settings' && item.enabled)`)
  await evaluate(`[...document.querySelectorAll('button')].find(x => x.textContent === 'Cargar más solicitudes').click()`)
  await wait(`document.querySelectorAll('.ioma-request').length === 101`)
  assert.equal(await evaluate(`window.fixtureCalls.find(item => item.action === 'list' && item.offset === 100).offset`), 100)
  await evaluate(`[...document.querySelector('.ioma-request').querySelectorAll('button')].find(x => x.textContent === 'Marcar atendida').click()`)
  await wait(`document.querySelector('.ioma-request').textContent.includes('Atendida')`)
  assert.equal(await evaluate(`window.fixtureCalls.find(item => item.action === 'complete').id`), '0')
  console.log('IOMA browser flow OK')
} finally {
  socket.close()
  await fetch(`${cdp}/json/close/${target.id}`).catch(() => {})
}
