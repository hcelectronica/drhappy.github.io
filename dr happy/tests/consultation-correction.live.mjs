import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { buildSignatureSeal, sha256Hex, verifySignatureSeal } from '../src/signatureSeal.ts'
import { correctionSignedContent } from '../src/consultationCorrection.ts'

if (process.env.TEST_CORRECTION_LIVE !== '1') throw new Error('Set TEST_CORRECTION_LIVE=1 to create and remove synthetic fixtures in the linked project.')
const folder = await mkdtemp(join(tmpdir(), 'drhappy-correction-live-'))
const actor = `correction-live-fixture-${crypto.randomUUID()}`
const token = `${crypto.randomUUID()}-${crypto.randomUUID()}`
const tokenHash = await sha256Hex(token)
const sqlPath = join(folder, 'fixture.sql')
const config = await readFile(new URL('../supabase/config.toml', import.meta.url), 'utf8')
const projectRef = config.match(/project_id\s*=\s*"([^"]+)"/)[1]
const quote = value => `'${String(value).replaceAll("'", "''")}'`
const query = async sql => {
  await writeFile(sqlPath, sql)
  const result = spawnSync(process.execPath, [resolve('node_modules', 'supabase', 'dist', 'supabase.js'), 'db', 'query', '--linked', '--file', sqlPath], { encoding: 'utf8', timeout: 90_000 })
  if (result.error || result.status !== 0) throw new Error(`Fixture database command failed: ${result.stderr || result.error?.message}`)
  return JSON.parse(result.stdout)
}
let created = false
try {
  const entry = {
    id: 'clinical-live-fixture', date: new Date(Date.now() - 3600_000).toISOString(),
    motivoConsulta: 'Consulta ficticia', detalleAtencion: 'Texto original ficticio', enfermedadActual: 'Texto original ficticio',
    pensamientoMedico: '', diagnostico: '', impresionDiagnostica: '', examenFisico: '', planManejo: 'Pauta original ficticia',
    pesoActual: '70', tallaCmEnConsulta: '170', tensionArterial: '', farmacosAgregados: '', estudiosComplementarios: '', resumenSofia: '',
    professionalSignature: { fullName: 'Profesional ficticio', licenseNumber: 'TEST', signatureText: 'Firma ficticia' },
  }
  entry.signatureSeal = await buildSignatureSeal({ contentToSign: { fixture: entry.detalleAtencion }, signerUserId: actor, signerFullName: 'Profesional ficticio', signerLicense: 'TEST' })
  const patient = { id: 'patient-live-fixture', ownerUserId: actor, dni: '11111111', consultations: [entry] }
  created = true
  await query(`BEGIN;
    INSERT INTO professionals(id,username,full_name,specialty,license_number,email) VALUES (${quote(actor)},${quote(actor)},'Profesional ficticio','Medicina general','TEST',${quote(actor + '@example.invalid')});
    INSERT INTO user_workspaces(user_id,patients_json) VALUES (${quote(actor)},${quote(JSON.stringify([patient]))}::jsonb);
    INSERT INTO professional_sessions(professional_id,token_hash,expires_at) VALUES (${quote(actor)},${quote(tokenHash)},now()+interval '10 minutes');
    COMMIT;`)
  console.log('Synthetic fixture ready; testing authenticated correction API.')
  const replacement = { ...entry, planManejo: 'Pauta corregida ficticia', correction: { reason: 'Error de transcripción ficticio', previousHash: entry.signatureSeal.hashSha256, originalDate: entry.date } }
  replacement.signatureSeal = await buildSignatureSeal({ contentToSign: correctionSignedContent(patient.id, patient.dni, replacement), signerUserId: actor, signerFullName: 'Profesional ficticio', signerLicense: 'TEST' })
  const call = async body => {
    const response = await fetch(`https://${projectRef}.supabase.co/functions/v1/consultation-correction`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'x-drhappy-session': token },
      body: JSON.stringify(body), signal: AbortSignal.timeout(90_000),
    })
    return { status: response.status, data: await response.json() }
  }
  const params = { patientId: patient.id, consultationId: entry.id, expectedHash: entry.signatureSeal.hashSha256, replacement }
  const first = await call(params)
  console.log('First correction API status:', first.status)
  assert.equal(first.status, 200, JSON.stringify(first.data))
  assert.equal(first.data.success, true)
  assert.equal(first.data.consultation.date, entry.date)
  assert.equal(first.data.consultation.correctionHistory.length, 1)
  assert.equal(first.data.consultation.correctionHistory[0].previous.signatureSeal.hashSha256, entry.signatureSeal.hashSha256)
  assert(await verifySignatureSeal({ contentToVerify: correctionSignedContent(patient.id, patient.dni, first.data.consultation), seal: first.data.consultation.signatureSeal }), 'Server JSONB response must retain verifiable signature')
  const stale = await call(params)
  console.log('Stale-version API status:', stale.status)
  assert.equal(stale.status, 409, 'Stale hash must fail')
  const staleWorkspace = await fetch(`https://${projectRef}.supabase.co/functions/v1/workspace-data`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'x-drhappy-session': token },
    body: JSON.stringify({ action: 'save', profile: {}, patients: [patient], appointments: [] }),
    signal: AbortSignal.timeout(15_000),
  })
  assert.equal(staleWorkspace.status, 409, 'Ordinary stale workspace save must fail promptly, not overwrite a correction')
  const stored = await query(`SELECT patients_json->0->'consultations'->0 AS consultation FROM user_workspaces WHERE user_id=${quote(actor)};`)
  const persisted = stored.rows[0].consultation
  assert.equal(persisted.planManejo, replacement.planManejo)
  assert(await verifySignatureSeal({ contentToVerify: correctionSignedContent(patient.id, patient.dni, persisted), seal: persisted.signatureSeal }), 'Persisted JSONB signature verifies after reload')
  const tampered = { ...replacement, planManejo: 'Contenido alterado sin nueva firma',
    correction: { ...replacement.correction, previousHash: replacement.signatureSeal.hashSha256 },
    signatureSeal: { ...replacement.signatureSeal, hashSha256: 'c'.repeat(64) },
  }
  const invalid = await call({ ...params, expectedHash: replacement.signatureSeal.hashSha256, replacement: tampered })
  assert.equal(invalid.status, 400, 'Tampered signature is rejected')
  console.log('Live correction passed: authenticated save, original preservation, new signature, JSONB reload, stale-version rejection and tampered-signature rejection.')
} finally {
  try {
    if (created) await query(`BEGIN;
      DELETE FROM professional_sessions WHERE professional_id=${quote(actor)};
      DELETE FROM user_workspaces WHERE user_id=${quote(actor)};
      DELETE FROM professionals WHERE id=${quote(actor)};
      COMMIT;`)
  } finally { await rm(folder, { recursive: true, force: true }) }
}
