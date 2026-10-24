import assert from 'node:assert/strict'
import { randomUUID, createHash } from 'node:crypto'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { readFile, writeFile, unlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

if (process.env.TEST_PAID_DOCUMENT_LIVE !== '1' || !process.env.TEST_PATIENT_DB_DIR) throw new Error('Explicit TEST_PAID_DOCUMENT_LIVE=1 and TEST_PATIENT_DB_DIR are required.')
const dbDir = process.env.TEST_PATIENT_DB_DIR
const env = await readFile(path.join(dbDir, '.env.local'), 'utf8')
const setting = name => env.split(/\r?\n/).map(line => line.trim()).find(line => line.startsWith(`${name}=`))?.slice(name.length + 1).replace(/^["']|["']$/g, '').trim()
const origin = new URL(setting('VITE_SUPABASE_URL')).origin, key = setting('VITE_SUPABASE_ANON_KEY')
const ref = (await readFile(path.join(dbDir, 'supabase', '.temp', 'project-ref'), 'utf8')).trim()
assert.equal(new URL(origin).hostname, `${ref}.supabase.co`)
const run = promisify(execFile)
const owner = `paid-chart-fixture-${randomUUID()}`, other = `paid-chart-other-${randomUUID()}`
const token = randomUUID(), otherToken = randomUUID(), requests = [randomUUID(), randomUUID()]
const hash = value => createHash('sha256').update(value).digest('hex')
async function sql(statement) {
  const file = path.join(tmpdir(), `paid-chart-${randomUUID()}.sql`)
  await writeFile(file, statement)
  try {
    await run('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command',
      `& npx.cmd supabase db query --linked -f '${file.replaceAll("'", "''")}'; exit $LASTEXITCODE`], { cwd: dbDir })
  } finally { await unlink(file) }
}
async function call(endpoint, body, session = token) {
  const response = await fetch(`${origin}/functions/v1/${endpoint}`, {
    method: 'POST', headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json',
      ...(session ? { 'x-drhappy-session': session } : {}) }, body: JSON.stringify(body),
  })
  return { status: response.status, body: await response.json() }
}
const success = result => {
  assert.equal(result.status, 200, result.body.message)
  assert.equal(result.body.success, true, result.body.message)
  return result.body
}
try {
  await sql(`BEGIN;
    INSERT INTO professionals(id,username,full_name,specialty,license_number,email,active,is_admin,subscription_status,subscription_expires_at)
      SELECT id,id,'Ficticio pruebas','Medicina general','TEST',id || '@example.invalid',true,false,'active',now()+interval '1 day'
      FROM unnest(ARRAY['${owner}','${other}']) id;
    INSERT INTO professional_sessions(professional_id,token_hash,expires_at) VALUES
      ('${owner}','${hash(token)}',now()+interval '20 minutes'),('${other}','${hash(otherToken)}',now()+interval '20 minutes');
    INSERT INTO user_workspaces(user_id,profile_json,patients_json,appointments_json,treatment_ledger_json,treatment_ledger_initialized)
      VALUES('${owner}','{}','[]','[]','[]',true);
    INSERT INTO paid_clinical_document_requests(id,professional_id,tracking_token,service_type,requested_purpose,
      patient_first_name,patient_last_name,patient_dni,patient_email,patient_phone,patient_health_insurance,patient_insurance_member_number,reason,amount)
      SELECT id::uuid,'${owner}',encode(gen_random_bytes(32),'hex'),'certificate','Evaluacion','Ficticio','Prueba','00001234',
        'patient@example.invalid','11111111','Cobertura ficticia','000123/45-A','Solicitud de prueba',30000
      FROM unnest(ARRAY['${requests[0]}','${requests[1]}']) id;
    COMMIT;`)
  assert.equal((await call('paid-clinical-documents', { action: 'get-patient', id: requests[0] }, null)).status, 401)
  assert.equal((await call('paid-clinical-documents', { action: 'get-patient', id: requests[0] })).status, 404)
  await Promise.all(requests.map(id => sql(`BEGIN;
    UPDATE paid_clinical_document_requests SET status='pending_review',payment_status='approved',payment_id='fixture-${id}',paid_at=now()
      WHERE id='${id}' AND professional_id='${owner}';
    SELECT pg_sleep(0.5); COMMIT;`)))
  assert.equal((await call('paid-clinical-documents', { action: 'get-patient', id: requests[0], professionalId: owner }, otherToken)).status, 404)
  const first = success(await call('paid-clinical-documents', { action: 'get-patient', id: requests[0] })).patient
  const second = success(await call('paid-clinical-documents', { action: 'get-patient', id: requests[1] })).patient
  assert.equal(first.id, second.id, 'Concurrent approved payments with the same DNI must use one chart')
  assert.equal(first.numeroAfiliado, '000123/45-A')
  assert.equal(first.obraSocial, 'Cobertura ficticia')
  assert.deepEqual(first.consultations, [])
  const ledgerRequests = success(await call('paid-clinical-documents', { action: 'list-ledger-requests' })).requests
  assert.equal(ledgerRequests.length, 2)
  assert.ok(ledgerRequests.every(row => row.patient_id === first.id))
  success(await call('workspace-data', { action: 'save', profile: {}, patients: [], appointments: [], knownPatientIds: [] }))
  let workspace = success(await call('workspace-data', { action: 'load' })).workspace
  assert.equal(workspace.patients_json.length, 1, 'A stale save must retain the chart')
  assert.deepEqual(workspace.treatment_ledger_json, [], 'Derived payments must not be inserted again')
  const chart = { ...first, certificates: [{ id: 'fixture-certificate' }], consultations: [{ id: 'fixture-consultation' }] }
  success(await call('workspace-data', { action: 'save', profile: {}, patients: [chart], appointments: [], knownPatientIds: [chart.id] }))
  const reloaded = success(await call('paid-clinical-documents', { action: 'get-patient', id: requests[0] })).patient
  assert.equal(reloaded.certificates[0].id, 'fixture-certificate')
  assert.equal(reloaded.consultations[0].id, 'fixture-consultation')
  success(await call('workspace-data', { action: 'save', profile: {}, patients: [], appointments: [], knownPatientIds: [chart.id] }))
  workspace = success(await call('workspace-data', { action: 'load' })).workspace
  assert.equal(workspace.patients_json.length, 0, 'Explicit deletion of a known chart must remain possible')
  console.log('PASS: concurrent approval, DNI deduplication, owner isolation, coverage, stale saves, persisted chart history and unchanged ledger; no real payments or emails.')
} finally {
  await sql(`BEGIN;
    DELETE FROM paid_clinical_document_requests WHERE professional_id IN ('${owner}','${other}');
    DELETE FROM professional_sessions WHERE professional_id IN ('${owner}','${other}');
    DELETE FROM user_workspaces WHERE user_id IN ('${owner}','${other}');
    DELETE FROM professionals WHERE id IN ('${owner}','${other}');
    COMMIT;`)
}
