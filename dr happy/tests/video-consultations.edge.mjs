import assert from 'node:assert/strict'
import { createHash, randomBytes, randomUUID } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { resolve } from 'node:path'
import { createServer } from 'node:net'
import { io } from '../../video-service/node_modules/socket.io-client/build/esm/index.js'
import { createVideoServer } from '../../video-service/videoServer.mjs'

if (process.env.LIVE_VIDEO_CONSULTATIONS_TEST !== '1') throw new Error('Set LIVE_VIDEO_CONSULTATIONS_TEST=1 for disposable live fixtures.')
const project = 'stzsobirxdivbgqxwkhc'
const id = randomUUID()
const token = randomBytes(32).toString('hex')
const tokenHash = createHash('sha256').update(token).digest('hex')
const cli = resolve('node_modules', 'supabase', 'dist', 'supabase.js')
function query(sql) {
  execFileSync(process.execPath, [cli, 'db', 'query', '--linked', '--project-ref', project, sql], { stdio: ['ignore', 'pipe', 'pipe'], timeout: 30000 })
}
const reservation = createServer()
await new Promise(resolve => reservation.listen(0, '127.0.0.1', resolve))
const port = reservation.address().port
await new Promise(resolve => reservation.close(resolve))
const origin = `http://127.0.0.1:${port}`
const app = createVideoServer({ origin, iceServers: [] })
const clients = []
const edge = async (body, session) => {
  const response = await fetch(`https://${project}.supabase.co/functions/v1/video-consultations`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', ...(session ? { 'x-drhappy-session': session } : {}) },
    body: JSON.stringify(body), signal: AbortSignal.timeout(15000),
  })
  return { status: response.status, data: await response.json() }
}
try {
  query(`INSERT INTO public.professionals(id,username,full_name,specialty,license_number,email,active,is_admin)
    VALUES('${id}','video-metadata-${id}','Disposable metadata test','Test','TEST','${id}@example.invalid',true,true);
    INSERT INTO public.professional_sessions(professional_id,token_hash,expires_at)
    VALUES('${id}','${tokenHash}',clock_timestamp()+interval '10 minutes');
    INSERT INTO public.user_workspaces(user_id,patients_json,appointments_json)
    VALUES('${id}','[{"id":"patient-live","ownerUserId":"${id}","nombre":"Fixture","apellido":"Paciente"},{"id":"foreign","ownerUserId":"foreign","nombre":"Ajeno"}]'::jsonb,
      '[{"id":"appointment-live","patientId":"patient-live","scheduledDate":"2026-10-06","scheduledTime":"12:00"}]'::jsonb);`)
  assert.equal((await edge({ action: 'list' })).status, 401)
  const list = await edge({ action: 'list' }, token)
  assert.equal(list.status, 200)
  assert.deepEqual(list.data.patients, [{ id: 'patient-live', name: 'Paciente, Fixture' }])
  assert.equal((await edge({ action: 'create', patientId: 'foreign', durationMinutes: 40 }, token)).status, 403)
  assert.equal((await edge({ action: 'create', patientId: 'patient-live', appointmentId: 'wrong', durationMinutes: 40 }, token)).status, 403)
  const passResponse = await fetch(`https://${project}.supabase.co/functions/v1/video-handoff`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'x-drhappy-session': token }, body: JSON.stringify({ action: 'create' }),
  })
  assert.equal(passResponse.status, 200)
  const pass = await passResponse.json()
  await new Promise(resolve => app.server.listen(port, '127.0.0.1', resolve))
  const handoff = await fetch(`${origin}/api/handoff`, {
    method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json' }, body: JSON.stringify({ token: pass.token }),
  })
  assert.equal(handoff.status, 200)
  const cookie = handoff.headers.get('set-cookie').split(';')[0]
  const response = await fetch(`${origin}/api/rooms`, {
    method: 'POST', headers: { Origin: origin, Cookie: cookie, 'Content-Type': 'application/json' },
    body: JSON.stringify({ patientId: 'patient-live', appointmentId: 'appointment-live', durationMinutes: 40 }),
  })
  assert.equal(response.status, 201)
  const room = await response.json()
  assert.equal(room.patientName, 'Paciente, Fixture')
  assert(!('lifecycleToken' in room))
  assert(!room.patientLink.includes('patient-live'))
  const connect = (access, ownerCookie) => new Promise((resolve, reject) => {
    const client = io(origin, { transports: ['websocket'], reconnection: false, auth: { token: access },
      extraHeaders: { Origin: origin, ...(ownerCookie ? { Cookie: ownerCookie } : {}) } })
    clients.push(client)
    client.once('connect', () => resolve(client))
    client.once('connect_error', reject)
  })
  const professional = await connect(room.token, cookie)
  await connect(room.patientLink.split('#p=')[1])
  const action = event => new Promise((resolve, reject) => professional.timeout(15000).emit(event, (error, result) => error ? reject(error) : resolve(result)))
  assert.equal((await action('admit')).ok, true)
  assert.equal((await action('end')).ok, true)
  query(`DO $$ BEGIN
    ASSERT EXISTS(SELECT 1 FROM public.video_consultations WHERE id='${room.consultationId}'::uuid
      AND professional_id='${id}' AND patient_id='patient-live' AND appointment_id='appointment-live'
      AND started_at IS NOT NULL AND ended_at IS NOT NULL AND status='completed');
  END $$;`)
  console.log('PASS: deployed Edge, owned patient/appointment validation, real handoff/Node/admission/finalization and durable consultation metadata; no lifecycle secret in participant response.')
} finally {
  for (const client of clients) client.disconnect()
  await app.close()
  query(`DELETE FROM public.video_consultations WHERE professional_id='${id}';
    DELETE FROM public.user_workspaces WHERE user_id='${id}';
    DELETE FROM public.video_handoffs WHERE professional_id='${id}';
    DELETE FROM public.professional_sessions WHERE professional_id='${id}';
    DELETE FROM public.professionals WHERE id='${id}';`)
}
