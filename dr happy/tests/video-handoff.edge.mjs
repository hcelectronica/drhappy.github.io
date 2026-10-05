import assert from 'node:assert/strict'
import { createHash, randomBytes, randomUUID } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { resolve } from 'node:path'
import { createVideoServer } from '../../video-service/videoServer.mjs'

if (process.env.LIVE_VIDEO_HANDOFF_TEST !== '1') throw new Error('Set LIVE_VIDEO_HANDOFF_TEST=1 to run disposable live authorization fixtures.')
const project = 'stzsobirxdivbgqxwkhc'
const endpoint = `https://${project}.supabase.co/functions/v1/video-handoff`
const id = randomUUID()
const session = randomBytes(32).toString('hex')
const hash = createHash('sha256').update(session).digest('hex')
const cli = resolve('node_modules', 'supabase', 'dist', 'supabase.js')
function query(sql) {
  execFileSync(process.execPath, [cli, 'db', 'query', '--linked', '--project-ref', project, sql], { stdio: ['ignore', 'pipe', 'pipe'], timeout: 30000 })
}
async function request(body, token) {
  const response = await fetch(endpoint, {
    method: 'POST', headers: { 'Content-Type': 'application/json', ...(token ? { 'x-drhappy-session': token } : {}) },
    body: JSON.stringify(body), signal: AbortSignal.timeout(15000),
  })
  return { status: response.status, data: await response.json() }
}
async function issue() {
  const result = await request({ action: 'create' }, session)
  assert.equal(result.status, 200, 'Live administrator pass creation succeeds')
  assert.match(result.data.token, /^[a-f0-9]{64}$/)
  assert.equal(result.data.expiresInSeconds, 60)
  return result.data.token
}
const app = createVideoServer({ origin: 'http://127.0.0.1:5197', iceServers: [] })
try {
  assert.equal((await request({ action: 'create' })).status, 401)
  assert.equal((await request({ action: 'exchange', token: 'invalid' })).status, 400)
  assert.equal((await request({ action: 'exchange', token: randomBytes(32).toString('hex') })).status, 401)
  query(`INSERT INTO public.professionals(id,username,full_name,specialty,license_number,email,active,is_admin)
    VALUES ('${id}','video-test-${id}','Disposable video authorization test','Test','TEST','${id}@example.invalid',true,true);
    INSERT INTO public.professional_sessions(professional_id,token_hash,expires_at)
    VALUES ('${id}','${hash}',clock_timestamp()+interval '5 minutes');`)
  const concurrent = await issue()
  const exchanges = await Promise.all([request({ action: 'exchange', token: concurrent }), request({ action: 'exchange', token: concurrent })])
  assert.deepEqual(exchanges.map(result => result.status).sort(), [200, 401], 'Exactly one concurrent exchange succeeds')
  assert.equal(typeof exchanges.find(result => result.status === 200).data.sessionToken, 'string')
  const pass = await issue()
  await new Promise(resolve => app.server.listen(5197, '127.0.0.1', resolve))
  const response = await fetch('http://127.0.0.1:5197/api/handoff', {
    method: 'POST', headers: { 'Content-Type': 'application/json', Origin: 'http://127.0.0.1:5197' },
    body: JSON.stringify({ token: pass }),
  })
  assert.equal(response.status, 200, 'Real Node adapter exchanges pass and verifies administrator in Supabase')
  assert.deepEqual(await response.json(), { ok: true }, 'Node response never exposes upstream credentials')
  const cookie = response.headers.get('set-cookie').split(';')[0]
  assert.match(response.headers.get('set-cookie'), /HttpOnly; SameSite=Strict/)
  assert.equal((await fetch('http://127.0.0.1:5197/api/session', { headers: { Cookie: cookie } })).status, 200)
  assert.equal((await request({ action: 'exchange', token: pass })).status, 401)
  const expired = await issue()
  query(`UPDATE public.video_handoffs SET expires_at=clock_timestamp()-interval '1 second' WHERE professional_id='${id}';`)
  assert.equal((await request({ action: 'exchange', token: expired })).status, 401)
  const revoked = await issue()
  query(`UPDATE public.professional_sessions SET revoked_at=clock_timestamp() WHERE token_hash='${hash}';`)
  assert.equal((await request({ action: 'exchange', token: revoked })).status, 401)
  assert.equal((await request({ action: 'create' }, session)).status, 401)
  query(`UPDATE public.professional_sessions SET revoked_at=NULL WHERE token_hash='${hash}';`)
  const lostPrivilege = await issue()
  query(`UPDATE public.professionals SET is_admin=false WHERE id='${id}';`)
  assert.equal((await request({ action: 'exchange', token: lostPrivilege })).status, 401)
  assert.equal((await request({ action: 'create' }, session)).status, 403)
  assert.equal((await fetch('http://127.0.0.1:5197/api/session', { headers: { Cookie: cookie } })).status, 403)
  console.log('PASS: live Edge/Node integration, administrator-only issuance, one winner for concurrent exchanges, expiry/reuse/source revocation/privilege removal, HttpOnly cookie and no upstream credentials in browser response.')
} finally {
  await app.close()
  query(`DELETE FROM public.video_handoffs WHERE professional_id='${id}';
    DELETE FROM public.professional_sessions WHERE professional_id='${id}';
    DELETE FROM public.professionals WHERE id='${id}';`)
}
