import http from 'node:http'
import { randomBytes, createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { Server } from 'socket.io'

const opaque = () => randomBytes(32).toString('hex')
const hash = value => createHash('sha256').update(value).digest('hex')
const fail = (status, message) => Object.assign(new Error(message), { status })
const validToken = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value)
const patientToken = () => randomBytes(16).toString('base64url')
const validAccessToken = value => validToken(value) || (typeof value === 'string' && /^[A-Za-z0-9_-]{21}[AQgw]$/.test(value))
const validId = value => typeof value === 'string' && /^[a-zA-Z0-9_-]{1,160}$/.test(value)

export function createVideoServer({
  origin = process.env.PUBLIC_ORIGIN || 'https://video.drhappy.com.ar',
  supabaseUrl = process.env.SUPABASE_URL || 'https://stzsobirxdivbgqxwkhc.supabase.co',
  iceServers = JSON.parse(process.env.ICE_SERVERS_JSON || '[{"urls":"stun:stun.l.google.com:19302"}]'),
  login,
  exchangeHandoff,
  verifyAdmin,
  listPatients,
  createConsultation,
  recordConsultationEvent,
  waitingDurationMs = 30 * 60_000,
  now = Date.now,
  checkIntervalMs = 30_000,
} = {}) {
  const parsedOrigin = new URL(origin)
  const local = parsedOrigin.protocol === 'http:' && ['127.0.0.1', 'localhost'].includes(parsedOrigin.hostname)
  if ((!local && parsedOrigin.protocol !== 'https:') || parsedOrigin.origin !== origin) throw new Error('PUBLIC_ORIGIN debe ser un origen HTTPS sin ruta ni barra final.')
  if (!Array.isArray(iceServers) || iceServers.some(item => {
    const urls = typeof item?.urls === 'string' ? [item.urls] : item?.urls
    return !Array.isArray(urls) || !urls.length || urls.some(url => typeof url !== 'string' || !/^(stun|stuns|turn|turns):/.test(url))
      || (urls.some(url => /^turns?:/.test(url))
        && (typeof item.username !== 'string' || !item.username || typeof item.credential !== 'string' || !item.credential))
  })) throw new Error('ICE_SERVERS_JSON no es una lista STUN/TURN valida.')
  if (new URL(supabaseUrl).protocol !== 'https:') throw new Error('SUPABASE_URL debe usar HTTPS.')
  const cookieName = local ? 'drhappy-video' : '__Host-drhappy-video'
  const sessions = new Map()
  const rooms = new Map()
  const tokens = new Map()
  const buckets = new Map()
  const pendingRecords = new Set()
  const pendingCreations = new Map()
  let closing = false
  const hasTurn = iceServers.some(item => (Array.isArray(item.urls) ? item.urls : [item.urls]).some(url => /^turns?:/.test(url)))
  function rate(key, limit, windowMs) {
    const current = now()
    let bucket = buckets.get(key)
    if (!bucket || current >= bucket.until) {
      bucket = { count: 0, until: current + windowMs }
      buckets.set(key, bucket)
    }
    if (++bucket.count > limit) throw fail(429, 'Demasiados intentos. Espera un momento y reintenta.')
  }
  async function remote(path, body, sessionToken) {
    let response
    try {
      response = await fetch(`${supabaseUrl}/functions/v1/${path}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(sessionToken ? { 'x-drhappy-session': sessionToken } : {}) },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(10_000),
      })
    } catch {
      throw fail(503, 'No se pudo contactar al servicio de autorizacion.')
    }
    let data
    try { data = await response.json() }
    catch { throw fail(503, 'El servicio de autorizacion devolvio una respuesta invalida.') }
    if (!response.ok) throw fail([400, 401, 403, 429].includes(response.status) ? response.status : 503,
      response.status >= 500 ? 'No se pudo validar la cuenta. Reintenta.' : data.error || data.message || 'Acceso denegado.')
    return data
  }
  async function remoteLogin(username, password) {
    const data = await remote('auth-professional', { action: 'login', username, password })
    if (!data.success || typeof data.sessionToken !== 'string') throw fail(503, 'No se recibio una sesion valida.')
    if (data.professional?.is_admin !== true || data.professional.active === false) throw fail(403, 'La videoconsulta esta habilitada solo para administradores.')
    return data.sessionToken
  }
  async function remoteVerify(sessionToken) {
    const data = await remote('video-access', {}, sessionToken)
    if (typeof data.id !== 'string' || !data.id) throw fail(503, 'No se recibio una identidad administrativa valida.')
    return data.id
  }
  login ??= remoteLogin
  verifyAdmin ??= remoteVerify
  listPatients ??= sessionToken => remote('video-consultations', { action: 'list' }, sessionToken)
  createConsultation ??= (sessionToken, data) => remote('video-consultations', { action: 'create', ...data }, sessionToken)
  recordConsultationEvent ??= async (lifecycleToken, event) => {
    const data = await remote('video-consultations', { action: 'event', lifecycleToken, event })
    if (data?.ok !== true) throw fail(503, 'No se pudo confirmar el registro de videoconsulta.')
    return data
  }
  exchangeHandoff ??= async token => {
    const data = await remote('video-handoff', { action: 'exchange', token })
    if (typeof data.sessionToken !== 'string' || !data.sessionToken) throw fail(503, 'No se recibio una sesion de videoconsulta valida.')
    return data.sessionToken
  }
  const json = (response, status, body) => {
    response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' })
    response.end(JSON.stringify(body))
  }
  function getSession(request) {
    const cookie = (request.headers.cookie || '').split(';').map(part => part.trim()).find(part => part.startsWith(`${cookieName}=`))?.slice(cookieName.length + 1)
    const session = validToken(cookie) ? sessions.get(hash(cookie)) : null
    if (!session || session.expiresAt <= now()) throw fail(401, 'Inicia sesion como administrador para continuar.')
    return session
  }
  async function authorize(session) {
    if (sessions.get(session.key) !== session || session.expiresAt <= now()) throw fail(401, 'La sesion administrativa vencio.')
    const id = await verifyAdmin(session.upstream)
    if (id !== session.id) throw fail(403, 'La cuenta administrativa cambio.')
    if (sessions.get(session.key) !== session) throw fail(401, 'La sesion se cerro.')
    return session
  }
  function revoke(session) {
    sessions.delete(session.key)
    for (const room of rooms.values()) if (room.owner === session.key) endRoom(room, 'La sesion administrativa se cerro o ya no tiene permiso.')
  }
  async function establishSession(request, response, upstream, reuseExisting = false) {
    const id = await verifyAdmin(upstream)
    if (typeof id !== 'string' || !id) throw fail(503, 'Identidad administrativa invalida.')
    let previous
    try { previous = getSession(request) }
    catch (error) { if (error.status !== 401) throw error }
    if (previous) {
      if (reuseExisting) {
        try {
          await authorize(previous)
          if (previous.id === id) return json(response, 200, { ok: true })
        } catch (error) { if (![401, 403].includes(error.status)) throw error }
      }
      revoke(previous)
    }
    if (sessions.size >= 100) throw fail(429, 'Hay demasiadas sesiones abiertas.')
    const raw = opaque()
    const key = hash(raw)
    sessions.set(key, { key, upstream, id, expiresAt: now() + 3 * 60 * 60_000 })
    response.setHeader('Set-Cookie', `${cookieName}=${raw}; Path=/; HttpOnly; SameSite=Strict; Max-Age=10800${local ? '' : '; Secure'}`)
    return json(response, 200, { ok: true })
  }
  function identity(rawToken) {
    const result = validAccessToken(rawToken) ? tokens.get(hash(rawToken)) : null
    if (!result || !rooms.has(result.room.id) || result.room.expiresAt <= now()) throw fail(401, 'El acceso no es valido o vencio.')
    return result
  }
  async function participant(request, rawToken) {
    const result = identity(rawToken)
    const owner = sessions.get(result.room.owner)
    if (!owner) throw fail(401, 'La sala ya no esta disponible.')
    if (result.role === 'professional' && getSession(request) !== owner) throw fail(403, 'La sala pertenece a otra sesion administrativa.')
    await authorize(owner)
    identity(rawToken)
    return result
  }
  async function body(request) {
    let text = ''
    for await (const chunk of request) {
      text += chunk.toString()
      if (Buffer.byteLength(text) > 4096) throw fail(413, 'Solicitud demasiado grande.')
    }
    try { return JSON.parse(text) }
    catch { throw fail(400, 'Solicitud JSON invalida.') }
  }
  const server = http.createServer(async (request, response) => {
    response.setHeader('Cache-Control', 'no-store')
    response.setHeader('Referrer-Policy', 'no-referrer')
    response.setHeader('X-Content-Type-Options', 'nosniff')
    response.setHeader('X-Frame-Options', 'DENY')
    response.setHeader('Permissions-Policy', 'camera=(self), microphone=(self)')
    response.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'self'; media-src 'self' blob:; img-src 'self' data:; frame-ancestors 'none'; base-uri 'none'; form-action 'self'")
    try {
      if (request.headers.host !== parsedOrigin.host) throw fail(403, 'Host no autorizado.')
      const path = new URL(request.url, origin).pathname
      if (request.method === 'POST' && request.headers.origin !== origin) throw fail(403, 'Origen no autorizado.')
      if (path === '/health' && request.method === 'GET') return json(response, 200, { ok: true, turnConfigured: hasTurn })
      if (path === '/api/login' && request.method === 'POST') {
        rate('login-global', 20, 60_000)
        if (sessions.size >= 100) throw fail(429, 'Hay demasiadas sesiones abiertas.')
        const data = await body(request)
        if (!data || typeof data.username !== 'string' || !/^[a-zA-Z0-9_.@+-]{1,160}$/.test(data.username.trim())
          || typeof data.password !== 'string' || !data.password || data.password.length > 256) throw fail(400, 'Ingresa usuario/email y contrasena validos.')
        const upstream = await login(data.username.trim(), data.password)
        return await establishSession(request, response, upstream)
      }
      if (path === '/api/handoff' && request.method === 'POST') {
        rate('handoff-global', 30, 60_000)
        const data = await body(request)
        if (!validToken(data?.token)) throw fail(400, 'Pase temporal invalido.')
        const upstream = await exchangeHandoff(data.token)
        return await establishSession(request, response, upstream, true)
      }
      if (path === '/api/logout' && request.method === 'POST') {
        revoke(getSession(request))
        response.setHeader('Set-Cookie', `${cookieName}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0${local ? '' : '; Secure'}`)
        return json(response, 200, { ok: true })
      }
      if (path === '/api/session' && request.method === 'GET') {
        const session = getSession(request)
        rate(`session:${session.key}`, 30, 60_000)
        await authorize(session)
        return json(response, 200, { admin: true })
      }
      if (path === '/api/patients' && request.method === 'GET') {
        const session = getSession(request)
        rate(`patients:${session.key}`, 30, 60_000)
        await authorize(session)
        const data = await listPatients(session.upstream)
        await authorize(session)
        if (!Array.isArray(data?.patients) || !Array.isArray(data?.appointments)
          || data.patients.some(patient => !validId(patient?.id) || typeof patient.name !== 'string')
          || data.appointments.some(appointment => !validId(appointment?.id) || !validId(appointment.patientId) || typeof appointment.label !== 'string')) {
          throw fail(503, 'Lista de pacientes invalida.')
        }
        return json(response, 200, {
          patients: data.patients.map(({ id, name }) => ({ id, name })),
          appointments: data.appointments.map(({ id, patientId, label }) => ({ id, patientId, label })),
        })
      }
      if (path === '/api/rooms' && request.method === 'POST') {
        const session = getSession(request)
        rate(`create:${session.key}`, 5, 60_000)
        await authorize(session)
        const data = await body(request)
        if (!Number.isInteger(data?.durationMinutes) || data.durationMinutes < 1 || data.durationMinutes > 120) {
          throw fail(400, 'La duracion debe ser un numero entero entre 1 y 120 minutos.')
        }
        if (!validId(data.patientId) || (data.appointmentId !== undefined && !validId(data.appointmentId))) {
          throw fail(400, 'Selecciona un paciente guardado y un turno valido, si corresponde.')
        }
        if (session.expiresAt < now() + waitingDurationMs + data.durationMinutes * 60_000) {
          throw fail(409, 'Tu sesion administrativa no alcanza para esta duracion y la espera. Cierra sesion y volve a ingresar antes de crear la sala.')
        }
        const pending = pendingCreations.get(session.key) || 0
        const totalPending = [...pendingCreations.values()].reduce((total, count) => total + count, 0)
        if (rooms.size + totalPending >= 30 || [...rooms.values()].filter(room => room.owner === session.key).length + pending >= 3) throw fail(429, 'Finaliza las salas anteriores antes de crear otra.')
        pendingCreations.set(session.key, pending + 1)
        try {
          const id = opaque()
          const professional = opaque()
          const patient = patientToken()
          const consultation = await createConsultation(session.upstream, {
            patientId: data.patientId, ...(data.appointmentId ? { appointmentId: data.appointmentId } : {}), durationMinutes: data.durationMinutes,
          })
          if (!validId(consultation?.consultationId) || typeof consultation.patientName !== 'string' || !validToken(consultation.lifecycleToken)) {
            throw fail(503, 'No se recibio un registro de videoconsulta valido.')
          }
          try { await authorize(session) }
          catch (error) {
            await recordConsultationEvent(consultation.lifecycleToken, 'interrupted')
            throw error
          }
          const room = { id, owner: session.key, professional: hash(professional), patient: hash(patient),
            consultationId: consultation.consultationId, patientName: consultation.patientName, lifecycleToken: consultation.lifecycleToken,
            durationMinutes: data.durationMinutes, startedAt: null, expiresAt: now() + waitingDurationMs, admitted: false, sockets: {} }
          rooms.set(id, room)
          tokens.set(room.professional, { room, role: 'professional' })
          tokens.set(room.patient, { room, role: 'patient' })
          return json(response, 201, { token: professional, patientLink: `${origin}/#p=${patient}`,
            consultationId: room.consultationId, patientName: room.patientName, ...timing(room) })
        } finally {
          const remaining = (pendingCreations.get(session.key) || 1) - 1
          if (remaining) pendingCreations.set(session.key, remaining)
          else pendingCreations.delete(session.key)
        }
      }
      if (path === '/api/ice' && request.method === 'GET') {
        rate('ice-global', 120, 60_000)
        await participant(request, request.headers['x-video-token'])
        return json(response, 200, { iceServers, hasTurn })
      }
      if (request.method !== 'GET') throw fail(405, 'Metodo no permitido.')
      const file = path === '/' ? 'index.html' : path === '/client.js' ? 'client.js' : path === '/transcription.js' ? 'transcription.js' : path === '/brand-mark.svg' ? 'brand-mark.svg' : null
      if (!file) throw fail(404, 'Recurso no encontrado.')
      const contents = await readFile(new URL(file, import.meta.url))
      response.writeHead(200, { 'Content-Type': file.endsWith('.html') ? 'text/html; charset=utf-8' : file.endsWith('.svg') ? 'image/svg+xml' : 'text/javascript; charset=utf-8' })
      response.end(contents)
    } catch (error) {
      if (!error.status || error.status >= 500) console.error('video HTTP:', error.message)
      if (!response.headersSent) json(response, error.status || 500, { error: error.status ? error.message : 'No se pudo procesar la solicitud.' })
      else response.end()
    }
  })
  const io = new Server(server, {
    maxHttpBufferSize: 64 * 1024, connectTimeout: 10_000,
    cors: { origin },
    allowRequest: (request, callback) => {
      try {
        rate('connect-global', 120, 60_000)
        callback(null, request.headers.host === parsedOrigin.host
          && (request.headers.origin === origin || (!request.headers.origin && request.headers['sec-fetch-site'] === 'same-origin')))
      } catch { callback('Demasiadas conexiones.', false) }
    },
  })
  io.use(async (socket, next) => {
    try {
      const result = await participant(socket.request, socket.handshake.auth.token)
      if (socket.conn.readyState !== 'open') throw fail(401, 'La conexion se cerro durante la autorizacion.')
      if (result.room.sockets[result.role]) throw fail(409, 'Ese participante ya esta conectado en otra pestana.')
      result.room.sockets[result.role] = socket
      socket.data.identity = result
      next()
    } catch (error) {
      if (!error.status || error.status >= 500) console.error('video socket: fallo de autorizacion')
      next(new Error(error.status ? error.message : 'No se pudo validar el acceso.'))
    }
  })
  function snapshot(room) {
    const state = { professionalPresent: Boolean(room.sockets.professional), patientPresent: Boolean(room.sockets.patient), admitted: room.admitted, ...timing(room) }
    for (const socket of Object.values(room.sockets)) socket.emit('state', state)
  }
  function timing(room) {
    return { durationMinutes: room.durationMinutes, startedAt: room.startedAt, expiresAt: room.expiresAt, serverNow: now() }
  }
  function endRoom(room, reason) {
    if (!rooms.has(room.id)) return
    tokens.delete(room.professional)
    tokens.delete(room.patient)
    rooms.delete(room.id)
    for (const socket of Object.values(room.sockets)) {
      socket.emit('ended', reason)
      socket.disconnect(true)
    }
    const event = reason.includes('duracion') || reason.includes('vencio') ? 'expired'
      : reason.includes('finalizo') ? 'completed' : reason.includes('rechazo') ? 'rejected' : 'interrupted'
    const record = (async () => {
      for (let attempt = 0; attempt < 3; attempt++) {
        try { await recordConsultationEvent(room.lifecycleToken, event); return }
        catch (error) {
          console.error('video: no se pudo guardar el cierre de la consulta', room.consultationId, error.message)
          if (attempt < 2) await new Promise(resolve => setTimeout(resolve, 300))
        }
      }
    })()
    pendingRecords.add(record)
    void record.finally(() => pendingRecords.delete(record))
  }
  io.on('connection', socket => {
    const { room, role } = socket.data.identity
    socket.emit('identity', { role })
    if (rooms.has(room.id)) snapshot(room)
    const active = () => {
      if (!rooms.has(room.id) || room.expiresAt <= now() || room.sockets[role] !== socket) throw fail(401, 'La sala vencio o se cerro.')
    }
    const privileged = async () => {
      active()
      if (role !== 'professional') throw fail(403, 'Solo el administrador puede realizar esta accion.')
      const session = sessions.get(room.owner)
      if (!session) throw fail(401, 'La sesion administrativa se cerro.')
      await authorize(session)
      active()
    }
    const action = handler => async ack => {
      if (typeof ack !== 'function') return
      try {
        rate(`action:${socket.id}`, 20, 10_000)
        await privileged()
        await handler(ack)
      } catch (error) {
        if (!error.status || error.status >= 500) console.error('video: no se pudo autorizar una accion')
        ack({ error: error.status ? error.message : 'No se pudo confirmar la accion.' })
        if ([401, 403].includes(error.status) && role === 'professional') endRoom(room, 'La cuenta administrativa ya no esta autorizada.')
      }
    }
    socket.on('admit', action(async ack => {
      if (!room.sockets.patient) return ack({ error: 'El paciente todavia no entro.' })
      if (!room.admitted) {
        if (room.startedAt === null) {
          room.startPromise ??= recordConsultationEvent(room.lifecycleToken, 'start')
          try { await room.startPromise }
          catch (error) { room.startPromise = null; throw error }
          active()
          if (!room.sockets.patient) return ack({ error: 'El paciente se desconecto antes de la admision.' })
          if (room.startedAt === null) {
            room.startedAt = now()
            room.expiresAt = room.startedAt + room.durationMinutes * 60_000
          }
        }
        room.admitted = true
        snapshot(room)
      }
      ack({ ok: true })
    }))
    socket.on('end', action(async ack => {
      await recordConsultationEvent(room.lifecycleToken, 'completed')
      active()
      ack({ ok: true })
      endRoom(room, 'El profesional finalizo la videoconsulta.')
    }))
    socket.on('reject', action(ack => {
      if (room.admitted || !room.sockets.patient) return ack({ error: 'No se puede rechazar esta entrada.' })
      tokens.delete(room.patient)
      ack({ ok: true })
      room.sockets.patient.emit('ended', 'El administrador rechazo esta invitacion. Solicita una nueva sala.')
      room.sockets.patient.disconnect(true)
    }))
    socket.on('signal', (payload, ack) => {
      if (typeof ack !== 'function') return
      try {
        active()
        rate(`signal:${socket.id}`, 200, 10_000)
        const other = room.sockets[role === 'professional' ? 'patient' : 'professional']
        if (!room.admitted || !other) throw fail(403, 'El participante no esta admitido o se desconecto.')
        const description = payload?.description
        const candidate = payload?.candidate
        if (description && candidate) throw fail(400, 'Envia una sola senal por mensaje.')
        if (description?.type === (role === 'professional' ? 'offer' : 'answer') && typeof description.sdp === 'string' && description.sdp.length <= 50_000) {
          other.emit('signal', { description: { type: description.type, sdp: description.sdp } })
        } else if (!description && typeof candidate?.candidate === 'string' && candidate.candidate.length <= 4000
          && (candidate.sdpMid == null || typeof candidate.sdpMid === 'string' && candidate.sdpMid.length <= 100)
          && (candidate.sdpMLineIndex == null || Number.isInteger(candidate.sdpMLineIndex) && candidate.sdpMLineIndex >= 0 && candidate.sdpMLineIndex <= 100)) {
          other.emit('signal', { candidate: { candidate: candidate.candidate, sdpMid: candidate.sdpMid ?? null, sdpMLineIndex: candidate.sdpMLineIndex ?? null } })
        } else throw fail(400, 'Senal WebRTC invalida.')
        ack({ ok: true })
      } catch (error) { ack({ error: error.message }) }
    })
    socket.on('disconnect', () => {
      if (room.sockets[role] === socket) {
        delete room.sockets[role]
        room.admitted = false
        if (rooms.has(room.id)) snapshot(room)
      }
      buckets.delete(`action:${socket.id}`)
      buckets.delete(`signal:${socket.id}`)
    })
  })
  const expiry = setInterval(() => {
    const current = now()
    for (const room of rooms.values()) if (room.expiresAt <= current) endRoom(room,
      room.startedAt === null ? 'La invitacion vencio sin iniciar la consulta.' : 'La consulta finalizo: se cumplio la duracion elegida.')
    for (const session of sessions.values()) if (session.expiresAt <= current) revoke(session)
    for (const [key, bucket] of buckets) if (current >= bucket.until) buckets.delete(key)
  }, 1000)
  let checking = false
  const check = setInterval(async () => {
    if (checking || closing) return
    checking = true
    try {
      const owners = new Set([...rooms.values()].map(room => room.owner))
      await Promise.all([...owners].map(async key => {
        const session = sessions.get(key)
        if (!session) return
        try { await authorize(session) }
        catch {
          console.error('video: la sala se cerro porque no se pudo revalidar el permiso administrativo')
          revoke(session)
        }
      }))
    } finally { checking = false }
  }, checkIntervalMs)
  expiry.unref()
  check.unref()
  return {
    server,
    close: () => new Promise(resolve => {
      closing = true
      clearInterval(expiry)
      clearInterval(check)
      for (const room of rooms.values()) endRoom(room, 'El servidor se reinicio. Solicita una nueva sala.')
      sessions.clear()
      io.close(() => { void Promise.allSettled([...pendingRecords]).then(resolve) })
    }),
  }
}
