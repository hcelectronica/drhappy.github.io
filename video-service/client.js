const $ = id => document.getElementById(id)
let accessToken = new URLSearchParams(location.hash.slice(1)).get('invite')
let handoffToken = new URLSearchParams(location.hash.slice(1)).get('handoff')
history.replaceState(null, '', location.pathname)
let role = accessToken ? 'patient' : null
let stream = null
let socket = null
let peer = null
let channel = null
let pendingCandidates = []
let signalQueue = Promise.resolve()
let generation = 0
let admin = false
let authorizing = Boolean(handoffToken)
let joining = false
let mediaGeneration = 0
const deviceBusy = new Set()
let senders = {}
let remoteCameraOn = false
let iceServers = []
let hasTurn = false
let expiryTimer
let countdownTimer
let warningShown = false
let connectionTimer
let disconnectTimer
const pendingMessages = new Map()
const seenMessages = new Set()
const report = error => { $('error').textContent = error instanceof Error ? error.message : String(error) }
const status = text => { $('status').textContent = text }
function update() {
  $('create').hidden = !admin || role === 'patient'
  $('duration-panel').hidden = !admin || role === 'patient'
  $('login-panel').hidden = admin || role === 'patient' || authorizing
  $('logout').hidden = !admin || role === 'patient'
  $('identity').textContent = role ? `Rol de prueba: ${role === 'professional' ? 'profesional' : 'paciente'}.` : 'Sin sala.'
  $('join').disabled = !stream?.getTracks().some(track => track.readyState === 'live' && track.enabled)
    || !accessToken || Boolean(socket) || joining || !$('consent').checked || deviceBusy.size > 0
  for (const [kind, id, name] of [['audio', 'mic', 'micrófono'], ['video', 'camera', 'cámara']]) {
    const track = stream?.getTracks().find(track => track.kind === kind && track.readyState === 'live')
    const enabled = Boolean(track?.enabled)
    const button = $(id)
    button.disabled = deviceBusy.has(kind) || joining || !$('consent').checked || (!admin && role !== 'patient')
    button.setAttribute('aria-pressed', String(enabled))
    const label = `${enabled ? kind === 'audio' ? 'Silenciar' : 'Apagar' : 'Activar'} ${name}`
    button.setAttribute('aria-label', label)
    button.title = label
  }
  const videoEnabled = Boolean(stream?.getVideoTracks().some(track => track.readyState === 'live' && track.enabled))
  $('self-preview').hidden = !videoEnabled
  if (videoEnabled && previewPosition) movePreview(previewPosition.x, previewPosition.y)
  const visibleRemote = Boolean(peer && remoteCameraOn && $('remote').srcObject?.getVideoTracks().some(track => !track.muted && track.readyState === 'live'))
  $('remote').style.visibility = visibleRemote ? 'visible' : 'hidden'
  $('stage-placeholder').hidden = visibleRemote
  $('stage-message').textContent = peer?.connectionState === 'connected' ? 'Participante con cámara apagada'
    : peer ? 'Conectando con tu invitado...' : socket ? 'Esperando la admisión' : 'Tu sala de videoconsulta'
  $('leave').disabled = !stream && !socket
  $('text').disabled = $('send').disabled = channel?.readyState !== 'open'
}
function closePeer() {
  generation++
  clearTimeout(connectionTimer)
  clearTimeout(disconnectTimer)
  pendingCandidates = []
  senders = {}
  remoteCameraOn = false
  if (channel) { channel.onclose = null; channel.close(); channel = null }
  if (peer) { peer.onconnectionstatechange = null; peer.close(); peer = null }
  $('remote').srcObject = null
  $('play-audio').hidden = true
  for (const { item, timer } of pendingMessages.values()) {
    clearTimeout(timer)
    item.textContent = 'No confirmado: se cortó la conexión.'
  }
  pendingMessages.clear()
  update()
}
function release() {
  mediaGeneration++
  closePeer()
  joining = false
  clearTimeout(expiryTimer)
  clearInterval(countdownTimer)
  $('countdown').hidden = true
  $('time-warning').textContent = ''
  warningShown = false
  if (socket) { socket.disconnect(); socket = null }
  stream?.getTracks().forEach(track => track.stop())
  stream = null
  $('local').srcObject = null
  $('end').hidden = $('admit').hidden = $('reject').hidden = true
  update()
}
function showTiming(data) {
  clearTimeout(expiryTimer)
  clearInterval(countdownTimer)
  const remainingMs = Math.max(0, data.expiresAt - data.serverNow)
  const deadline = performance.now() + remainingMs
  const render = () => {
    const remaining = Math.max(0, Math.ceil((deadline - performance.now()) / 1000))
    const formatted = `${Math.floor(remaining / 60)}:${String(remaining % 60).padStart(2, '0')}`
    $('countdown').hidden = false
    $('countdown').textContent = data.startedAt === null
      ? `Consulta de ${data.durationMinutes} minutos. Sin iniciar. Invitación: ${formatted} para admitir al invitado.`
      : `Consulta de ${data.durationMinutes} minutos · Tiempo restante: ${formatted}`
    if (data.startedAt !== null && remaining <= 300 && !warningShown) {
      warningShown = true
      $('time-warning').textContent = 'Quedan 5 minutos o menos. Al llegar a cero, la sala se cerrará y se apagarán los dispositivos.'
    }
  }
  render()
  countdownTimer = setInterval(render, 1000)
  expiryTimer = setTimeout(() => {
    release()
    accessToken = null
    status(data.startedAt === null ? 'La invitación venció sin iniciar la consulta.' : 'La consulta finalizó: se cumplió la duración elegida.')
    update()
  }, remainingMs)
}
function request(event, data) {
  return new Promise((resolve, reject) => {
    if (!socket?.connected) return reject(new Error('La señalización no está conectada.'))
    const done = (error, result) => {
      if (error) reject(new Error('El servidor no confirmó la acción.'))
      else if (result?.error) reject(new Error(result.error))
      else resolve(result)
    }
    if (data === undefined) socket.timeout(5000).emit(event, done)
    else socket.timeout(5000).emit(event, data, done)
  })
}
function message(text, sender, suffix = '') {
  const box = document.createElement('div')
  box.className = 'message'
  const label = document.createElement('strong')
  label.textContent = `${sender}: `
  const body = document.createElement('span')
  body.textContent = text
  const state = document.createElement('small')
  state.textContent = suffix
  box.append(label, body, document.createElement('br'), state)
  $('messages').append(box)
  if ($('messages').children.length > 200) $('messages').firstElementChild.remove()
  $('messages').scrollTop = $('messages').scrollHeight
  return state
}
function setChannel(next) {
  channel = next
  next.onopen = () => { sendMediaState(); update() }
  next.onclose = update
  next.onerror = () => report(new Error('Falló el canal del chat. No se garantiza la entrega de los mensajes pendientes.'))
  next.onmessage = event => {
    try {
      if (typeof event.data !== 'string' || event.data.length > 5000) throw new Error('Mensaje de chat inválido.')
      const data = JSON.parse(event.data)
      if (data.type === 'media-state' && typeof data.camera === 'boolean') {
        remoteCameraOn = data.camera
        update()
        return
      }
      if (typeof data.id !== 'string' || data.id.length > 100) throw new Error('Identificador de mensaje inválido.')
      if (data.type === 'ack') {
        const pending = pendingMessages.get(data.id)
        if (pending) { clearTimeout(pending.timer); pending.item.textContent = 'Recibido por el otro navegador'; pendingMessages.delete(data.id) }
      } else if (data.type === 'message' && typeof data.text === 'string' && data.text.length <= 1000) {
        if (!seenMessages.has(data.id)) {
          if (seenMessages.size >= 1000) seenMessages.delete(seenMessages.values().next().value)
          seenMessages.add(data.id)
          message(data.text, role === 'professional' ? 'Paciente' : 'Profesional')
        }
        next.send(JSON.stringify({ type: 'ack', id: data.id }))
      } else throw new Error('Formato de chat no reconocido.')
    } catch (error) { report(error) }
  }
}
function sendMediaState() {
  if (channel?.readyState !== 'open') return
  try { channel.send(JSON.stringify({ type: 'media-state', camera: Boolean(stream?.getVideoTracks().some(track => track.enabled && track.readyState === 'live')) })) }
  catch (error) { report(error) }
}
function makePeer() {
  const next = new RTCPeerConnection({ iceServers })
  peer = next
  const current = generation
  const networkFailure = () => {
    if (peer !== next || current !== generation) return
    release()
    status('No se pudo mantener la conexión de audio/video. Dispositivos apagados.')
    report(new Error(hasTurn
      ? 'La conexión falló aun con TURN configurado. Revisá su disponibilidad y probá volver a entrar.'
      : 'Esta red no logró conectar directamente. Probá otra red o configurá TURN en el servidor. Volvé a entrar y solicitá nueva admisión.'))
  }
  connectionTimer = setTimeout(networkFailure, 45000)
  if (role === 'professional') {
    for (const kind of ['audio', 'video']) {
      const track = stream.getTracks().find(track => track.kind === kind && track.readyState === 'live')
      senders[kind] = next.addTransceiver(track || kind, { direction: 'sendrecv', streams: [stream] }).sender
    }
  }
  next.onicecandidate = event => {
    if (event.candidate && peer === next) request('signal', { candidate: event.candidate.toJSON() }).catch(report)
  }
  next.ontrack = event => {
    if (peer !== next) return
    const remote = $('remote').srcObject ?? new MediaStream()
    if (!remote.getTracks().some(track => track.id === event.track.id)) remote.addTrack(event.track)
    $('remote').srcObject = remote
    event.track.onmute = update
    event.track.onunmute = update
    event.track.onended = update
    update()
    $('remote').play().catch(() => {
      if (peer !== next || current !== generation) return
      $('play-audio').hidden = false
      status('Pulsá Activar audio recibido para reproducir el medio remoto.')
    })
  }
  next.onconnectionstatechange = () => {
    if (current !== generation) return
    if (next.connectionState === 'connected') {
      clearTimeout(connectionTimer)
      clearTimeout(disconnectTimer)
      status('Medios conectados por WebRTC. Prueba técnica; la cámara puede estar desactivada.')
      update()
    } else if (next.connectionState === 'failed') networkFailure()
    else if (next.connectionState === 'disconnected') {
      status('Audio/video interrumpido. Intentando recuperar la conexión...')
      clearTimeout(disconnectTimer)
      disconnectTimer = setTimeout(networkFailure, 8000)
    }
  }
  if (role === 'professional') setChannel(next.createDataChannel('consultation-chat', { ordered: true }))
  else next.ondatachannel = event => { if (peer === next) setChannel(event.channel) }
  return next
}
async function handleSignal(data) {
  const next = peer
  if (!next) throw new Error('Se recibió señalización fuera de una admisión activa.')
  const current = generation
  if (data.description) {
    await next.setRemoteDescription(data.description)
    if (current !== generation) return
    for (const candidate of pendingCandidates) await next.addIceCandidate(candidate)
    pendingCandidates = []
    if (data.description.type === 'offer') {
      for (const transceiver of next.getTransceivers()) {
        const kind = transceiver.receiver.track.kind
        if (!['audio', 'video'].includes(kind)) continue
        transceiver.direction = 'sendrecv'
        transceiver.sender.setStreams(stream)
        await transceiver.sender.replaceTrack(stream.getTracks().find(track => track.kind === kind && track.readyState === 'live') || null)
        if (current !== generation) return
        senders[kind] = transceiver.sender
      }
      await next.setLocalDescription(await next.createAnswer())
      if (current === generation) await request('signal', { description: next.localDescription.toJSON() })
    }
  } else if (data.candidate) {
    if (next.remoteDescription) await next.addIceCandidate(data.candidate)
    else pendingCandidates.push(data.candidate)
  }
}
$('create').onclick = async () => {
  $('create').disabled = true
  try {
    if (socket) throw new Error('Salí de la sala actual antes de crear otra.')
    const durationMinutes = Number($('duration').value)
    if (!$('duration').value || !Number.isInteger(durationMinutes) || durationMinutes < 1 || durationMinutes > 120) {
      throw new Error('Elegí una duración entera entre 1 y 120 minutos.')
    }
    const data = await api('/api/rooms', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ durationMinutes }) })
    accessToken = data.token
    role = 'professional'
    $('link').value = data.patientLink
    $('invite').hidden = false
    warningShown = false
    showTiming(data)
    status(`Sala creada: ${data.durationMinutes} minutos desde la primera admisión. Compartí el enlace privado con tu invitado.`)
    update()
  } catch (error) { report(error) }
  finally { $('create').disabled = false }
}
$('copy').onclick = async () => {
  try { await navigator.clipboard.writeText($('link').value); status('Enlace copiado. Compartilo solo con tu invitado.') }
  catch (error) { report(error); $('link').select() }
}
async function toggleDevice(kind) {
  if (deviceBusy.has(kind)) return
  deviceBusy.add(kind)
  const before = mediaGeneration
  update()
  $('error').textContent = ''
  let acquired
  try {
    if (!$('consent').checked || (!admin && role !== 'patient')) throw new Error('Aceptá la prueba e iniciá sesión o abrí una invitación antes de activar dispositivos.')
    const existing = stream?.getTracks().find(track => track.kind === kind && track.readyState === 'live')
    if (existing && kind === 'audio') {
      existing.enabled = !existing.enabled
      return
    }
    if (existing) {
      if (peer && senders[kind]) await senders[kind].replaceTrack(null)
      if (before !== mediaGeneration) return
      existing.stop()
      stream.removeTrack(existing)
      $('local').srcObject = stream
      return
    }
    acquired = await navigator.mediaDevices.getUserMedia({
      audio: kind === 'audio' ? { echoCancellation: true, noiseSuppression: true } : false,
      video: kind === 'video' ? { width: { ideal: 640, max: 1280 }, height: { ideal: 480, max: 720 }, facingMode: 'user' } : false,
    })
    if (before !== mediaGeneration || !$('consent').checked) { acquired.getTracks().forEach(track => track.stop()); return }
    const track = acquired.getTracks()[0]
    if (!track || track.kind !== kind) throw new Error('No se recibió el dispositivo solicitado.')
    const activePeer = peer
    if (activePeer && senders[kind]) await senders[kind].replaceTrack(track)
    if (before !== mediaGeneration) { acquired.getTracks().forEach(track => track.stop()); return }
    stream ??= new MediaStream()
    stream.addTrack(track)
    $('local').srcObject = stream
    track.onended = () => {
      if (stream?.getTracks().includes(track)) {
        stream.removeTrack(track)
        report(new Error(`${kind === 'audio' ? 'El micrófono' : 'La cámara'} dejó de estar disponible. Podés volver a activarlo con su icono.`))
        sendMediaState()
        update()
      }
    }
    if (kind === 'video') await $('local').play()
    if (before !== mediaGeneration) return
    if (!peer) status('Vista previa preparada. Los medios no se comparten hasta la admisión.')
  } catch (error) {
    if (acquired) {
      for (const track of acquired.getTracks()) { track.stop(); stream?.removeTrack(track) }
    }
    if (before !== mediaGeneration) return
    report(error instanceof DOMException && error.name === 'NotReadableError'
      ? new Error('El dispositivo está ocupado por otro navegador o programa. Cerralo en el otro lado o usá únicamente el otro dispositivo con su icono.')
      : error)
  } finally {
    deviceBusy.delete(kind)
    sendMediaState()
    update()
  }
}
$('mic').onclick = () => toggleDevice('audio')
$('camera').onclick = () => toggleDevice('video')
$('join').onclick = async () => {
  if (!stream || !accessToken) { report(new Error('Prepará tus dispositivos y la invitación.')); return }
  if (!$('consent').checked || joining || socket) return
  $('error').textContent = ''
  joining = true
  update()
  const before = generation
  try {
    const config = await api('/api/ice', { headers: { 'x-video-token': accessToken } })
    if (before !== generation || !stream) return
    iceServers = config.iceServers
    hasTurn = config.hasTurn
    $('network').textContent = hasTurn
      ? 'STUN/TURN configurado. Si hace falta, el audio/video cifrado puede pasar por el servidor TURN configurado.'
      : 'STUN configurado, sin TURN. Algunas redes móviles o corporativas pueden impedir conectar audio/video; la señalización por sí sola no garantiza la llamada.'
  } catch (error) {
    if (before === generation) { release(); report(error); status('No se pudo validar la entrada.') }
    return
  } finally { joining = false; update() }
  if (before !== generation || !stream) return
  socket = io({ auth: { token: accessToken }, reconnection: true })
  signalQueue = Promise.resolve()
  socket.on('identity', data => { role = data.role; update() })
  socket.on('connect', () => { status('Señalización conectada. Esperando admisión.'); update() })
  socket.on('connect_error', error => { report(error); release(); status('No se pudo entrar a la sala.') })
  socket.on('disconnect', () => { closePeer(); status('Se perdió la señalización. Sin compartir medios; requiere nueva admisión.'); $('admit').hidden = $('reject').hidden = true })
  socket.on('ended', reason => { release(); accessToken = null; status(reason); update() })
  socket.on('state', data => {
    showTiming(data)
    $('waiting').textContent = data.patientPresent ? data.admitted ? 'Paciente admitido.' : 'Paciente de prueba esperando admisión.' : 'El paciente todavía no entró.'
    $('admit').hidden = $('reject').hidden = role !== 'professional' || !data.patientPresent || data.admitted
    $('end').hidden = role !== 'professional'
    if (!data.admitted || !data.professionalPresent || !data.patientPresent) {
      closePeer()
      status(role === 'patient' ? 'Sala de espera: esperando admisión del profesional.' : 'Sala abierta: admití al paciente cuando esté listo.')
      return
    }
    if (peer) return
    status('Admitido. Conectando audio y video...')
    const next = makePeer()
    if (role === 'professional') {
      const current = generation
      next.createOffer().then(offer => next.setLocalDescription(offer))
        .then(() => { if (current === generation) return request('signal', { description: next.localDescription.toJSON() }) })
        .catch(report)
    }
  })
  socket.on('signal', data => {
    signalQueue = signalQueue.then(() => handleSignal(data)).catch(report)
  })
  update()
}
$('play-audio').onclick = async () => {
  try { await $('remote').play(); $('play-audio').hidden = true }
  catch (error) { report(error) }
}
$('admit').onclick = () => request('admit').catch(report)
$('reject').onclick = () => request('reject').catch(report)
$('end').onclick = () => request('end').catch(report)
$('leave').onclick = () => { release(); status('Saliste. Cámara y micrófono apagados. Si la consulta ya comenzó, su tiempo sigue corriendo.') }
$('chat').onsubmit = event => {
  event.preventDefault()
  const text = $('text').value.trim()
  if (!text || channel?.readyState !== 'open') { report(new Error('Escribí un mensaje con el chat conectado.')); return }
  const id = crypto.randomUUID()
  const item = message(text, 'Vos', 'Pendiente de confirmación')
  try {
    if (text.length > 1000 || channel.bufferedAmount > 256 * 1024) throw new Error('El mensaje es demasiado largo o hay demasiados mensajes pendientes.')
    channel.send(JSON.stringify({ type: 'message', id, text }))
    const timer = setTimeout(() => { item.textContent = 'Sin confirmación de recepción'; pendingMessages.delete(id) }, 5000)
    pendingMessages.set(id, { item, timer })
    $('text').value = ''
  } catch (error) { item.textContent = 'No enviado'; report(error) }
}
window.addEventListener('pagehide', release)
async function api(path, options = {}) {
  const response = await fetch(path, { ...options, signal: AbortSignal.timeout(15000) })
  const data = await response.json()
  if (!response.ok) {
    if (response.status === 401 && role !== 'patient') { admin = false; update() }
    throw new Error(data.error || 'No se pudo completar la acción.')
  }
  return data
}
$('login').onsubmit = async event => {
  event.preventDefault()
  $('login-submit').disabled = true
  $('error').textContent = ''
  try {
    await api('/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: $('username').value, password: $('password').value }) })
    $('password').value = ''
    admin = true
    status('Acceso administrativo confirmado. Creá una sala de prueba.')
    update()
  } catch (error) { report(error) }
  finally { $('login-submit').disabled = false }
}
$('logout').onclick = async () => {
  try {
    await api('/api/logout', { method: 'POST' })
    release()
    accessToken = null
    role = null
    admin = false
    $('invite').hidden = true
    $('link').value = ''
    status('Sesión cerrada y salas finalizadas.')
    update()
  } catch (error) { report(error) }
}
$('consent').onchange = () => { if (!$('consent').checked) release(); update() }
const preview = $('self-preview')
let previewPosition = null
let drag = null
function movePreview(x, y) {
  const stage = $('stage')
  const toolbar = stage.querySelector('.video-controls')
  const maxX = Math.max(8, stage.clientWidth - preview.offsetWidth - 8)
  const maxY = Math.max(8, toolbar.offsetTop - preview.offsetHeight - 10)
  const left = Math.min(maxX, Math.max(8, x))
  const top = Math.min(maxY, Math.max(8, y))
  preview.style.left = `${left}px`
  preview.style.top = `${top}px`
  preview.style.right = 'auto'
  preview.style.bottom = 'auto'
  previewPosition = { x: left, y: top }
}
preview.addEventListener('pointerdown', event => {
  if (!event.isPrimary || event.button !== 0) return
  event.preventDefault()
  preview.focus({ preventScroll: true })
  drag = { id: event.pointerId, x: event.clientX, y: event.clientY, left: preview.offsetLeft, top: preview.offsetTop }
  preview.setPointerCapture(event.pointerId)
  preview.classList.add('dragging')
})
preview.addEventListener('pointermove', event => {
  if (!drag || drag.id !== event.pointerId) return
  movePreview(drag.left + event.clientX - drag.x, drag.top + event.clientY - drag.y)
})
const endDrag = () => { drag = null; preview.classList.remove('dragging') }
preview.addEventListener('pointerup', endDrag)
preview.addEventListener('pointercancel', endDrag)
preview.addEventListener('lostpointercapture', endDrag)
preview.addEventListener('keydown', event => {
  const delta = { ArrowLeft: [-16, 0], ArrowRight: [16, 0], ArrowUp: [0, -16], ArrowDown: [0, 16] }[event.key]
  if (!delta) return
  event.preventDefault()
  movePreview(preview.offsetLeft + delta[0], preview.offsetTop + delta[1])
})
new ResizeObserver(() => {
  if (previewPosition && !preview.hidden) movePreview(previewPosition.x, previewPosition.y)
}).observe($('stage'))
$('remote').addEventListener('playing', update)
async function restoreSession() {
  if (role === 'patient') return
  try {
    if (handoffToken) {
      status('Validando tu acceso desde Dr Happy...')
      const token = handoffToken
      handoffToken = null
      await api('/api/handoff', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token }) })
      admin = true
      status('Acceso desde Dr Happy confirmado. Creá una sala de prueba.')
      return
    }
    const response = await fetch('/api/session', { signal: AbortSignal.timeout(15000) })
    const data = await response.json()
    if (response.status === 401) return
    if (!response.ok) throw new Error(data.error)
    admin = data.admin === true
    if (admin) status('Sesión administrativa recuperada. Creá una sala.')
  } catch (error) { status('No se pudo recuperar el acceso. Abrí la videoconsulta otra vez desde Dr Happy o iniciá sesión aquí.'); report(error) }
  finally { authorizing = false; update() }
}
update()
restoreSession()
