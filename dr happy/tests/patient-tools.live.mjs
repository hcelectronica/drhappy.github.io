import assert from 'node:assert/strict'
import { randomUUID, createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { readFile, writeFile, unlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

if (process.env.TEST_PATIENT_LIVE !== '1' || !process.env.TEST_PATIENT_DB_DIR) throw new Error('Explicit TEST_PATIENT_LIVE=1 and TEST_PATIENT_DB_DIR (linked project) are required.')
const env = await readFile(path.join(process.env.TEST_PATIENT_DB_DIR, '.env.local'), 'utf8')
const setting = name => env.split(/\r?\n/).map(line => line.trim()).find(line => line.startsWith(`${name}=`))?.slice(name.length + 1).replace(/^["']|["']$/g, '').trim()
const rawOrigin = setting('VITE_SUPABASE_URL'), key = setting('VITE_SUPABASE_ANON_KEY')
assert.ok(rawOrigin && key)
const origin = new URL(rawOrigin).origin
const ref = (await readFile(path.join(process.env.TEST_PATIENT_DB_DIR, 'supabase', '.temp', 'project-ref'), 'utf8')).trim()
assert.equal(new URL(origin).hostname, `${ref}.supabase.co`, 'Client URL and linked project must match')
const patient = randomUUID(), other = randomUUID(), doctor = `tools-fixture-${randomUUID()}`
const doctorShare = randomUUID(), token = randomUUID(), otherToken = randomUUID(), doctorToken = randomUUID()
const email = `tools-${patient}@example.invalid`, otherEmail = `tools-${other}@example.invalid`
const dni = `000${Math.floor(Math.random() * 100000).toString().padStart(5, '0')}`
const hash = value => createHash('sha256').update(value).digest('hex')
async function sql(statement) {
  const file = path.join(tmpdir(), `patient-tools-${randomUUID()}.sql`)
  await writeFile(file, statement)
  try {
    const args = ['supabase', 'db', 'query', '--linked', '-f', file]
    if (process.platform === 'win32') execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', `& npx.cmd supabase db query --linked -f '${file.replaceAll("'", "''")}'; exit $LASTEXITCODE`], { cwd: process.env.TEST_PATIENT_DB_DIR, stdio: 'pipe' })
    else execFileSync('npx', args, { cwd: process.env.TEST_PATIENT_DB_DIR, stdio: 'pipe' })
  } catch (error) {
    throw new Error(`Database fixture operation failed: ${error.stdout?.toString() || ''}\n${error.stderr?.toString() || error.message}`)
  } finally { await unlink(file) }
}
async function call(body, session = token, professional = false, endpoint = 'patient-folder') {
  const response = await fetch(`${origin}/functions/v1/${endpoint}`, { method: 'POST',
    headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json',
      ...(session ? { [professional ? 'x-drhappy-session' : 'x-drhappy-patient-session']: session } : {}) }, body: JSON.stringify(body) })
  return { status: response.status, body: await response.json() }
}
const success = result => { assert.equal(result.status, 200, result.body.message); assert.equal(result.body.success, true, result.body.message); return result.body }
try {
  await sql(`BEGIN;
    INSERT INTO professionals(id,username,full_name,specialty,license_number,email,active,is_admin)
      VALUES('${doctor}','${doctor}','Ficticio pruebas','Medicina general','TEST','${doctor}@example.invalid',true,false);
    INSERT INTO professional_sessions(professional_id,token_hash,expires_at) VALUES('${doctor}','${hash(doctorToken)}',now()+interval '20 minutes');
    INSERT INTO patient_accounts(id,email,password_hash,full_name,dni,email_verified_at,consent_accepted_at) VALUES
      ('${patient}','${email}','unusable-fixture-password','Ficticio Uno','${dni}',now(),now()),
      ('${other}','${otherEmail}','unusable-fixture-password','Ficticio Dos','${dni}1',now(),now());
    INSERT INTO patient_sessions(patient_id,token_hash,expires_at) VALUES
      ('${patient}','${hash(token)}',now()+interval '20 minutes'),('${other}','${hash(otherToken)}',now()+interval '20 minutes');
    INSERT INTO patient_shares(id,patient_id,kind,professional_id,include_pressure) VALUES('${doctorShare}','${patient}','doctor','${doctor}',false);
    COMMIT;`)
  const unauthenticated = await call({ action: 'glucose-list' }, null)
  assert.equal(unauthenticated.status, 401, JSON.stringify(unauthenticated.body))
  assert.equal((await call({ action: 'search-doctors', query: 'Fic' }, null)).status, 401)
  const foundDoctors = success(await call({ action: 'search-doctors', query: 'pru fict' })).doctors
  assert.ok(foundDoctors.some(row => row.id === doctor))
  assert.ok(foundDoctors.every(row => !('email' in row)))
  const profile = success(await call({ action: 'update-profile', firstName: 'Ficticio', lastName: 'Uno',
    healthInsurance: 'Cobertura ficticia', insuranceMemberNumber: '000123/45-A' })).patient
  assert.equal(profile.healthInsurance, 'Cobertura ficticia')
  assert.equal(profile.insuranceMemberNumber, '000123/45-A')
  assert.equal(success(await call({ action: 'me' })).patient.insuranceMemberNumber, '000123/45-A')
  assert.equal(success(await call({ action: 'me' }, otherToken)).patient.healthInsurance, null)
  assert.equal(success(await call({ action: 'update-profile', firstName: 'Ficticio', lastName: 'Uno' })).patient.healthInsurance, 'Cobertura ficticia')
  assert.equal((await call({ action: 'update-profile', firstName: 'Ficticio', lastName: 'Uno', healthInsurance: 'x'.repeat(121) })).status, 400)
  const measuredAt = new Date(Date.now() - 3600000).toISOString()
  assert.equal((await call({ action: 'glucose-add', measuredAt, value: 0, context: 'fasting', method: 'capillary' })).status, 400)
  const record = success(await call({ action: 'glucose-add', measuredAt, value: 119, context: 'fasting', method: 'capillary', note: 'Fixture' })).glucose
  assert.equal(record.readings.length, 1)
  assert.equal(record.totalReadings, 1)
  assert.equal(new Date(record.readings[0].measuredAt).getTime(), new Date(measuredAt).getTime())
  assert.equal(success(await call({ action: 'glucose-list' }, otherToken)).glucose.readings.length, 0)
  assert.equal((await call({ action: 'glucose-delete', readingId: record.readings[0].id }, otherToken)).status, 404)
  const treatment = { diabetesType: 'type2', diagnosedYear: null, usesInsulin: true,
    insulins: [{ name: 'Insulina ficticia', units: 16.5, schedule: '22 h' }], medications: [{ name: 'Fármaco ficticio', dose: '500 mg', schedule: 'Cena' }], notes: 'Solo prueba técnica' }
  success(await call({ action: 'diabetes-save', treatment }))
  assert.deepEqual(success(await call({ action: 'glucose-list' })).glucose.treatment, treatment)
  assert.equal(success(await call({ action: 'doctor-folder', dni }, doctorToken, true)).folders[0].glucose, null)
  success(await call({ action: 'share-with-doctor', professionalId: doctor, allDocuments: false, documentIds: [], includePressure: false, includeGlucose: true }))
  assert.equal(success(await call({ action: 'doctor-folder', dni }, doctorToken, true)).folders[0].glucose.readings[0].value, 119)
  const link = success(await call({ action: 'create-link-share', allDocuments: false, documentIds: [], includePressure: false, includeGlucose: true, days: 1 }))
  const shareToken = new URL(link.url).pathname.split('/').at(-1)
  assert.equal(success(await call({ action: 'open-share', token: shareToken, code: link.code }, null)).glucose.treatment.insulins[0].units, 16.5)
  const shares = success(await call({ action: 'list-shares' })).shares
  const sharedLink = shares.find(row => row.kind === 'link')
  assert.equal(sharedLink.includeGlucose, true)
  success(await call({ action: 'revoke-share', shareId: sharedLink.id }))
  assert.equal((await call({ action: 'open-share', token: shareToken, code: link.code }, null)).status, 404)
  success(await call({ action: 'revoke-share', shareId: doctorShare }))
  assert.equal(success(await call({ action: 'doctor-folder', dni }, doctorToken, true)).folders.length, 0)
  assert.equal(success(await call({ action: 'news-preference' })).newsEnabled, false)
  assert.equal(success(await call({ action: 'news-preference-save', enabled: true })).newsEnabled, true)
  assert.equal(success(await call({ action: 'news-preference-save', enabled: false })).newsEnabled, false)
  assert.equal((await call({ action: 'contacts', audience: 'folder' }, doctorToken, true, 'patient-communications')).status, 403)
  assert.equal((await call({ action: 'contacts', audience: 'folder' }, null, false, 'patient-communications')).status, 401)
  success(await call({ action: 'glucose-delete', readingId: record.readings[0].id }))
  assert.equal(success(await call({ action: 'glucose-list' })).glucose.totalReadings, 0)
  assert.equal((await call({ action: 'status', patientId: patient }, null, false, 'patient-account-admin')).status, 401)
  assert.equal((await call({ action: 'status', patientId: patient }, doctorToken, true, 'patient-account-admin')).status, 403)
  await sql(`BEGIN;
    UPDATE professionals SET is_admin=true WHERE id='${doctor}' AND email='${doctor}@example.invalid';
    INSERT INTO patient_documents(patient_id,title,category,mime_type,size_bytes,file_path,status)
      VALUES('${patient}','Synthetic unavailable file','otros','application/pdf',100,'${patient}/missing-fixture.pdf','ready');
    COMMIT;`)
  const deletion = (action, overrides = {}) => call({ action, patientId: patient, confirmEmail: email, confirmPermanent: true, ...overrides }, doctorToken, true, 'patient-account-admin')
  assert.equal(success(await deletion('prepare')).backup.total, 1)
  assert.equal((await call({ action: 'glucose-list' })).status, 401, 'Preparing deletion revokes the patient session')
  const missing = await deletion('send-next')
  assert.equal(missing.status, 409)
  assert.equal(missing.body.backup.counts.failed, 1)
  assert.equal((await deletion('delete', { receiptConfirmed: true })).status, 409, 'Missing attachment must retain the account')
  const empty = (action, overrides = {}) => deletion(action, { patientId: other, confirmEmail: otherEmail, ...overrides })
  assert.equal(success(await empty('prepare')).backup.total, 0)
  assert.equal((await empty('delete')).status, 409)
  assert.equal(success(await empty('delete', { receiptConfirmed: true })).deleted, true)
  assert.equal((await empty('status')).status, 404)
  console.log('PASS deployed deletion: admin-only, frozen sessions, missing backup retains account, empty-account deletion requires final confirmation. No SMTP calls.')
  console.log('PASS deployed functions: patient isolation, glucose/treatment persistence, independent doctor/link consent, revocation, email preference and admin authorization. No SMTP calls.')
} finally {
  await sql(`BEGIN;
    DELETE FROM patient_accounts WHERE id IN ('${patient}','${other}') AND email IN ('${email}','${otherEmail}');
    DELETE FROM patient_email_preferences WHERE email IN ('${email}','${otherEmail}');
    DELETE FROM professionals WHERE id='${doctor}' AND email='${doctor}@example.invalid';
    COMMIT;`)
  console.log('Synthetic live fixtures removed.')
}
