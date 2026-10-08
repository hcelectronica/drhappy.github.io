import test from 'node:test'
import assert from 'node:assert/strict'
import { consultationCorrectionError, correctionReplacementError, correctionSignedContent, consultationRevisionText, CORRECTION_WINDOW_MS } from '../src/consultationCorrection.ts'
import { buildSignatureSeal, verifySignatureSeal } from '../src/signatureSeal.ts'

const start = Date.parse('2026-10-07T12:00:00.000Z')
const entry = {
  id: 'clinical-fixture', date: new Date(start).toISOString(), motivoConsulta: 'Control', detalleAtencion: 'Original',
  enfermedadActual: 'Original', pensamientoMedico: '', diagnostico: 'Control', planManejo: 'Pauta original',
  tallaCmEnConsulta: '170', pesoActual: '70',
  professionalSignature: { fullName: 'Autor', licenseNumber: 'TEST', signatureText: 'Firma original' },
  signatureSeal: { hashSha256: 'a'.repeat(64), signedAt: new Date(start).toISOString(), signedByUserId: 'author', signedByFullName: 'Autor', signedByLicense: 'TEST', algorithm: 'SHA-256', method: 'firma-electronica-simple' },
}
const replacement = {
  ...entry, motivoConsulta: 'Control corregido',
  correction: { reason: 'Error de transcripción', previousHash: entry.signatureSeal.hashSha256, originalDate: entry.date },
  signatureSeal: { ...entry.signatureSeal, hashSha256: 'b'.repeat(64) },
}

test('24 hours is an exclusive deadline from original timestamp, never restarted by a new signature', () => {
  assert.equal(consultationCorrectionError(entry, 'author', start), null)
  assert.equal(consultationCorrectionError(entry, 'author', start + CORRECTION_WINDOW_MS - 1), null)
  assert.match(consultationCorrectionError(entry, 'author', start + CORRECTION_WINDOW_MS), /Venció/)
  const corrected = { ...replacement, signatureSeal: { ...replacement.signatureSeal, signedAt: new Date(start + 23 * 3600_000).toISOString() }, correctionHistory: [{ previous: entry, reason: 'Error', correctedAt: '2026-10-08T11:00:00Z', correctedByUserId: 'author', newHash: replacement.signatureSeal.hashSha256 }] }
  assert.match(consultationCorrectionError(corrected, 'author', start + CORRECTION_WINDOW_MS), /Venció/)
})

test('only proven author can correct; unknown author, document entries, invalid/future dates fail closed', () => {
  assert.match(consultationCorrectionError(entry, 'other', start + 1000), /profesional/)
  assert.match(consultationCorrectionError({ ...entry, signatureSeal: undefined }, 'author', start + 1000), /profesional/)
  for (const value of [{ ...entry, certificateId: 'cert' }, { ...entry, id: 'video-123' }, { ...entry, id: 'virtual-123' }]) assert.match(consultationCorrectionError(value, 'author', start + 1000), /otro documento/)
  for (const date of ['bad', '2026-10-07', '2026-10-09T00:00:00Z']) assert.match(consultationCorrectionError({ ...entry, date, signatureSeal: { ...entry.signatureSeal, signedAt: date } }, 'author', start), /fecha/i)
})

test('corrected fields require reason, unchanged identifiers/date/height and a new signature', () => {
  assert.equal(correctionReplacementError(entry, replacement, entry.signatureSeal.hashSha256), null)
  for (const value of [
    { ...replacement, date: '2026-10-08T00:00:00Z' }, { ...replacement, id: 'other' },
    { ...replacement, correction: { ...replacement.correction, reason: ' ' } },
    { ...replacement, correction: { ...replacement.correction, previousHash: 'wrong' } },
    { ...replacement, certificateId: 'new-link' }, { ...replacement, tallaCmEnConsulta: '180' },
    { ...replacement, signatureSeal: entry.signatureSeal }, { ...replacement, pesoActual: 80 },
  ]) assert(correctionReplacementError(entry, value, entry.signatureSeal.hashSha256))
})

test('new signature covers corrected clinical content, reason, previous hash, original date and professional signature', async () => {
  const content = correctionSignedContent('patient', '11111111', replacement)
  const seal = await buildSignatureSeal({ contentToSign: content, signerUserId: 'author', signerFullName: 'Autor', signerLicense: 'TEST' })
  assert(await verifySignatureSeal({ contentToVerify: content, seal }))
  const reordered = {
    ...replacement,
    correction: Object.fromEntries(Object.entries(replacement.correction).reverse()),
    professionalSignature: Object.fromEntries(Object.entries(replacement.professionalSignature).reverse()),
  }
  assert(await verifySignatureSeal({ contentToVerify: correctionSignedContent('patient', '11111111', reordered), seal }), 'Database JSONB key order does not invalidate correction signature')
  for (const modified of [
    { ...content, motivoConsulta: 'Alterado' }, { ...content, originalDate: 'otro' },
    { ...content, correction: { ...replacement.correction, reason: 'otro' } },
    { ...content, professionalSignature: { ...replacement.professionalSignature, signatureText: 'Alterada' } },
  ]) assert.equal(await verifySignatureSeal({ contentToVerify: modified, seal }), false)
})

test('audit text retains original instructions, original hash and correction reason without mutating original', () => {
  const originalJson = JSON.stringify(entry)
  const history = [{ previous: entry, correctedAt: '2026-10-07T13:00:00Z', correctedByUserId: 'author', reason: 'Error de pauta', newHash: replacement.signatureSeal.hashSha256 }]
  const text = consultationRevisionText({ ...replacement, correctionHistory: history })
  for (const value of ['Pauta original', 'Error de pauta', entry.signatureSeal.hashSha256, replacement.signatureSeal.hashSha256, 'Firma original']) assert(text.includes(value))
  assert.equal(JSON.stringify(entry), originalJson)
})
