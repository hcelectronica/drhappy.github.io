import assert from 'node:assert/strict'
import { randomUUID, createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { readFile, writeFile, unlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

if (process.env.TEST_PATIENT_LIVE !== '1' || !process.env.TEST_PATIENT_DB_DIR) throw Error('Explicit live test opt-in and linked DB directory required.')
const dir = process.env.TEST_PATIENT_DB_DIR
const env = await readFile(path.join(dir, '.env.local'), 'utf8')
const value = key => env.split(/\r?\n/).find(line => line.startsWith(`${key}=`))?.slice(key.length + 1).trim().replace(/^["']|["']$/g, '')
const origin = new URL(value('VITE_SUPABASE_URL')).origin, key = value('VITE_SUPABASE_ANON_KEY')
const project = (await readFile(path.join(dir, 'supabase', '.temp', 'project-ref'), 'utf8')).trim()
assert.equal(new URL(origin).hostname, `${project}.supabase.co`)
const id = randomUUID(), patient = randomUUID(), other = randomUUID(), token = randomUUID(), otherToken = randomUUID(), doctorToken = randomUUID()
const a = `ref-a-${id}`, b = `ref-b-${id}`
const hash = value => createHash('sha256').update(value).digest('hex')
async function sql(statement) {
  const file = path.join(tmpdir(), `referral-${randomUUID()}.sql`)
  await writeFile(file, statement)
  try {
    execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command',
      `& npx.cmd supabase db query --linked -f '${file.replaceAll("'", "''")}'; exit $LASTEXITCODE`],
    { cwd: dir, stdio: 'pipe' })
  } finally { await unlink(file) }
}
async function call(body, session = token, endpoint = 'patient-folder') {
  const response = await fetch(`${origin}/functions/v1/${endpoint}`, {
    method: 'POST', headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json',
      ...(session ? { [endpoint === 'patient-folder' ? 'x-drhappy-patient-session' : 'x-drhappy-session']: session } : {}) },
    body: JSON.stringify(body),
  })
  return { status: response.status, body: await response.json() }
}
const ok = result => { assert.equal(result.status, 200, result.body.message); assert.equal(result.body.success, true); return result.body }
try {
  await sql(`BEGIN;
    INSERT INTO professionals(id,username,full_name,specialty,license_number,email,active,is_admin) VALUES
      ('${a}','${a}','Ficticio A','Medicina general','TEST','${a}@example.invalid',true,true),
      ('${b}','${b}','Ficticio B','Medicina general','TEST','${b}@example.invalid',true,true);
    INSERT INTO virtual_consult_settings(professional_id,slug,enabled) VALUES ('${a}','${a}',true),('${b}','${b}',true);
    INSERT INTO professional_payment_accounts(professional_id,provider,provider_user_id,access_token_encrypted,refresh_token_encrypted,token_expires_at,status) VALUES
      ('${a}','mercadopago','${a}','unusable-fixture','unusable-fixture',now()+interval '1 hour','connected'),
      ('${b}','mercadopago','${b}','unusable-fixture','unusable-fixture',now()+interval '1 hour','connected');
    INSERT INTO professional_sessions(professional_id,token_hash,expires_at) VALUES ('${a}','${hash(doctorToken)}',now()+interval '20 minutes');
    INSERT INTO patient_accounts(id,email,password_hash,full_name,dni,email_verified_at,consent_accepted_at) VALUES
      ('${patient}','${patient}@example.invalid','unusable-fixture','Ficticio Uno','00000001',now(),now()),
      ('${other}','${other}@example.invalid','unusable-fixture','Ficticio Dos','00000002',now(),now());
    INSERT INTO patient_sessions(patient_id,token_hash,expires_at) VALUES
      ('${patient}','${hash(token)}',now()+interval '20 minutes'),('${other}','${hash(otherToken)}',now()+interval '20 minutes');
    COMMIT;`)
  const unauthenticated = await call({ action: 'orientation', professionalId: a }, null)
  assert.equal(unauthenticated.status, 401, JSON.stringify(unauthenticated.body))
  assert.equal(ok(await call({ action: 'orientation' })).orientation, null)
  for (const professionalId of [a, b]) {
    const response = ok(await call({ action: 'orientation', professionalId }))
    assert.equal(response.orientation.url, `https://www.drhappy.com.ar/consulta/${professionalId}`)
    assert.equal(response.orientation.shareUrl, `https://www.drhappy.com.ar/paciente?prof=${professionalId}`)
  }
  assert.equal(ok(await call({ action: 'orientation' })).orientation.professionalId, b)
  assert.equal(ok(await call({ action: 'orientation' }, otherToken)).orientation, null)
  assert.equal((await call({ action: 'orientation', professionalId: '../bad' })).status, 400)
  const settings = ok(await call({ action: 'get-settings' }, doctorToken, 'virtual-consultations')).settings
  assert.equal(settings.patientFolderUrl, `https://www.drhappy.com.ar/paciente?prof=${a}`)
  await sql(`UPDATE virtual_consult_settings SET enabled=false WHERE professional_id='${b}';`)
  assert.equal(ok(await call({ action: 'orientation' })).orientation.url, null)
  console.log('PASS: live A/B destinations, persistent patient-only attribution, professional sharing link, paused service, no payments/emails/AI calls.')
} finally {
  await sql(`BEGIN; DELETE FROM patient_accounts WHERE id IN ('${patient}','${other}'); DELETE FROM professionals WHERE id IN ('${a}','${b}'); COMMIT;`)
}
