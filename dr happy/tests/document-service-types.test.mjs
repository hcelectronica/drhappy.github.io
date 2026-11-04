import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import vm from 'node:vm'
import ts from 'typescript'
import { documentServiceOptions, documentServiceLabel } from '../supabase/functions/_shared/clinicalDocumentServices.ts'

test('existing settings retain certificate amount and new services default disabled', () => {
  assert.deepEqual(documentServiceOptions({ certificate_enabled: true, certificate_price: 20000 }), {
    certificate: { enabled: true, price: 20000 }, fitness: { enabled: false, price: 0 }, prescription: { enabled: false, price: 0 },
  })
  assert.equal(documentServiceOptions({ study_order_enabled: true, study_order_price: 15000 }).certificate.price, 15000)
  assert.equal(documentServiceLabel('prescription'), 'Receta')
  assert.equal(documentServiceLabel('fitness'), 'Apto físico')
  assert.equal(documentServiceLabel('study-order'), 'Orden de estudios')
})

test('fitness documents have distinct signed identity and PDF filename without changing old certificate signatures', async () => {
  const source = await readFile(new URL('../src/medicalCertificate.ts', import.meta.url), 'utf8')
  const exports = {}
  vm.runInNewContext(ts.transpile(source, { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }), { exports, require: () => ({}) })
  const base = { certificateDate: '2026-11-04', letterhead: 'Consultorio', diagnostico: 'Evaluación', body: 'Texto revisado por profesional', patient: { fullName: 'Paciente Prueba', dni: '12345678' } }
  const old = exports.certificateSignedContent(base)
  assert.equal(old.type, 'certificado-medico')
  const fitness = { ...base, documentType: 'fitness' }
  assert.equal(exports.certificateSignedContent(fitness).type, 'apto-fisico')
  assert.match(exports.certificateFileName(fitness), /^apto-fisico-/)
  assert.equal(exports.certificateDocumentLabel(fitness), 'Apto físico')
  assert.equal(exports.certificateSignedContent({ ...base, documentType: 'study-order', studies: [] }).type, 'orden-estudios')
})
