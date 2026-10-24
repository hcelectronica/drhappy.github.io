import assert from 'node:assert/strict'
import { randomUUID, createHash } from 'node:crypto'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { readFile, writeFile, unlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

if (process.env.TEST_SOFIA_SHARED_LIVE !== '1' || !process.env.TEST_PATIENT_DB_DIR) throw new Error('Explicit TEST_SOFIA_SHARED_LIVE=1 and TEST_PATIENT_DB_DIR are required.')
const dbDir = process.env.TEST_PATIENT_DB_DIR
const env = await readFile(path.join(dbDir, '.env.local'), 'utf8')
const setting = name => env.split(/\r?\n/).map(line => line.trim()).find(line => line.startsWith(`${name}=`))?.slice(name.length + 1).replace(/^["']|["']$/g, '').trim()
const origin = new URL(setting('VITE_SUPABASE_URL')).origin, key = setting('VITE_SUPABASE_ANON_KEY')
const ref = (await readFile(path.join(dbDir, 'supabase', '.temp', 'project-ref'), 'utf8')).trim()
assert.equal(new URL(origin).hostname, `${ref}.supabase.co`)
const run = promisify(execFile)
const owner = `sofia-study-fixture-${randomUUID()}`, other = `sofia-study-other-${randomUUID()}`
const token = randomUUID(), otherToken = randomUUID(), patient = randomUUID(), chart = randomUUID(), share = randomUUID(), document = randomUUID()
const hash = value => createHash('sha256').update(value).digest('hex')
async function sql(statement) {
  const file = path.join(tmpdir(), `sofia-study-${randomUUID()}.sql`)
  await writeFile(file, statement)
  try {
    await run('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command',
      `& npx.cmd supabase db query --linked -f '${file.replaceAll("'", "''")}'; exit $LASTEXITCODE`], { cwd: dbDir })
  } finally { await unlink(file) }
}
async function check(fields = {}, session = token) {
  const response = await fetch(`${origin}/functions/v1/ai-assistant`, {
    method: 'POST', headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json',
      ...(session ? { 'x-drhappy-session': session } : {}) },
    body: JSON.stringify({ action: 'chat', mode: 'shared-study-review', checkOnly: true,
      sharedStudy: { patientId: chart, shareId: share, documentId: document }, ...fields }),
  })
  return { status: response.status, body: await response.json() }
}
try {
  await sql(`BEGIN;
    INSERT INTO professionals(id,username,full_name,specialty,license_number,email,active,is_admin,subscription_status,subscription_expires_at)
      SELECT id,id,'Ficticio pruebas','Medicina general','TEST',id || '@example.invalid',true,false,'active',now()+interval '1 day'
      FROM unnest(ARRAY['${owner}','${other}']) id;
    INSERT INTO professional_sessions(professional_id,token_hash,expires_at) VALUES
      ('${owner}','${hash(token)}',now()+interval '20 minutes'),('${other}','${hash(otherToken)}',now()+interval '20 minutes');
    INSERT INTO user_workspaces(user_id,profile_json,patients_json,appointments_json)
      VALUES('${owner}','{}',jsonb_build_array(jsonb_build_object('id','${chart}','ownerUserId','${owner}','nombre','Prueba','apellido','Ficticio','dni','00001234','consultations','[]'::jsonb)),'[]'),
        ('${other}','{}','[]','[]');
    INSERT INTO patient_accounts(id,email,password_hash,full_name,dni,email_verified_at,consent_accepted_at)
      VALUES('${patient}','${patient}@example.invalid','unusable-fixture-password','Paciente ficticio','00001234',now(),now());
    INSERT INTO patient_documents(id,patient_id,title,category,study_date,file_path,mime_type,size_bytes,status)
      VALUES('${document}','${patient}','Estudio ficticio','laboratorio','2026-10-01','${patient}/synthetic-not-uploaded.pdf','application/pdf',100,'ready');
    INSERT INTO patient_shares
      SELECT (jsonb_populate_record(null::patient_shares,jsonb_build_object(
        'id','${share}','patient_id','${patient}','professional_id','${owner}','kind','doctor','all_documents',false,
        'document_ids',jsonb_build_array('${document}'),'access_count',0,'failed_attempts',0,
        'include_pressure',false,'include_glucose',false,'created_at',now()))).*;
    COMMIT;`)
  assert.equal((await check({}, null)).status, 401)
  let result = await check()
  assert.equal(result.status, 200, result.body.message)
  assert.equal(result.body.success, true)
  assert.equal(result.body.reply, undefined, 'Permission check must never invoke the model')
  assert.equal((await check({ professionalId: owner }, otherToken)).status, 403)
  assert.equal((await check({ sharedStudy: { patientId: randomUUID(), shareId: share, documentId: document } })).status, 403)
  await sql(`UPDATE patient_shares SET revoked_at=now() WHERE id='${share}';`)
  assert.equal((await check()).status, 403)
  await sql(`UPDATE patient_shares SET revoked_at=null,all_documents=false,
    document_ids=(SELECT document_ids FROM jsonb_populate_record(null::patient_shares,'{"document_ids":[]}'))
    WHERE id='${share}';`)
  assert.equal((await check()).status, 403)
  await sql(`UPDATE patient_shares SET all_documents=true WHERE id='${share}';
    UPDATE patient_documents SET deleted_at=now() WHERE id='${document}';`)
  assert.equal((await check()).status, 404)
  await sql(`DO $$ BEGIN
    IF EXISTS(SELECT 1 FROM ai_usage_events WHERE professional_id='${owner}')
      OR (SELECT patients_json->0->'consultations' FROM user_workspaces WHERE user_id='${owner}') <> '[]'::jsonb THEN
      RAISE EXCEPTION 'Permission checks must not consume consultations or update clinical records';
    END IF;
    END $$;`)
  console.log('PASS: production permission checks, session/owner isolation, selective scope, revocation/deletion, no model calls, no AI usage and no clinical mutations.')
} finally {
  await sql(`BEGIN;
    DELETE FROM patient_shares WHERE id='${share}';
    DELETE FROM patient_documents WHERE id='${document}';
    DELETE FROM patient_accounts WHERE id='${patient}';
    DELETE FROM professional_sessions WHERE professional_id IN ('${owner}','${other}');
    DELETE FROM user_workspaces WHERE user_id IN ('${owner}','${other}');
    DELETE FROM professionals WHERE id IN ('${owner}','${other}');
    COMMIT;`)
}
