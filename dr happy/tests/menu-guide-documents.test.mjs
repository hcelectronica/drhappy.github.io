import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import ts from 'typescript'

const source = readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8')
const ast = ts.createSourceFile('App.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
function find(predicate, node = ast) {
  if (predicate(node)) return node
  return ts.forEachChild(node, child => find(predicate, child))
}
const declaration = name => {
  const node = find(n => (ts.isFunctionDeclaration(n) || ts.isVariableDeclaration(n)) && n.name?.getText(ast) === name)
  assert(node, name + ' must exist')
  return node
}
const helpers = ['normalizeSearchText', 'levenshteinDistance', 'scorePatientSearch'].map(name => declaration(name).getText(ast)).join('\n')
const options = declaration('certificatePatientOptions').initializer.getText(ast)
const patients = [
  { id: 'own', ownerUserId: 'owner', nombre: 'María', apellido: 'Perez', dni: '12345678' },
  { id: 'shared', ownerUserId: 'other', nombre: 'Maria', apellido: 'Otro', dni: '87654321' },
  { id: 'archived', ownerUserId: 'owner', nombre: 'Maria', apellido: 'Archivada', dni: '99999999' },
]

test('document patient search reuses name/DNI matching and excludes shared and archived records', () => {
  for (const [query, expected] of [['', ['own']], ['maria', ['own']], ['12345678', ['own']], ['87654321', []], ['99999999', []], ['no-coincide', []]]) {
    const code = ts.transpile(`${helpers}\nresult = ${options}`, { target: ts.ScriptTarget.ES2022 })
    const context = { result: null, sortedPatients: patients, activeUserId: 'owner', archivedPatients: [{ patient_id: 'archived' }], certificatePatientQuery: query, useMemo: fn => fn() }
    vm.runInNewContext(code, context)
    assert.deepEqual(Array.from(context.result, patient => patient.id), expected, query)
  }
})

test('menu guide and mobile entry reuse existing issuer without replacing paid requests or patient actions', () => {
  assert.match(source, /key: 'issue-document'[\s\S]*?onClick: handleOpenCertificatePatientPicker/)
  assert.match(source, /title="Emitir documento médico: certificados y órdenes"[\s\S]*?onClick=\{handleOpenCertificatePatientPicker\}/)
  assert.match(source, /key: 'paid-documents'[\s\S]*?setPaidDocumentsPanelOpen\(true\)/)
  assert.match(source, /onClick=\{\(\) => handleOpenCertificateModal\(patient\)\}/)
  assert.match(source, /onClick=\{\(\) => handleOpenCertificateModal\(selectedPatient\)\}/)
  const writes = []
  const context = {
    canUseMedicalTools: true, setAppError: message => writes.push(['error', message]),
    setCertificatePatientQuery: value => writes.push(['query', value]),
    setCertificatePatientPickerOpen: value => writes.push(['open', value]),
    setSidebarOpen: value => writes.push(['sidebar', value]),
  }
  vm.runInNewContext(ts.transpile(declaration('handleOpenCertificatePatientPicker').getText(ast)), context)
  context.handleOpenCertificatePatientPicker()
  assert.deepEqual(writes, [['query', ''], ['open', true], ['sidebar', false]])
  writes.length = 0
  context.canUseMedicalTools = false
  context.handleOpenCertificatePatientPicker()
  assert.equal(writes.length, 1)
  assert.equal(writes[0][0], 'error')
  const issuer = declaration('handleOpenCertificateModal').getText(ast)
  assert.match(issuer, /setCertificatePatientPickerOpen\(false\)/)
  assert.match(issuer, /setCertificatePatientId\(patient.id\)/)
  assert.match(issuer, /setCertificateEmail\(patient.email \|\| ''\)/)
  assert.match(issuer, /setPaidClinicalDocumentRequestId\(null\)/)
})

test('only administrators with medical access can open or save prescriptions, including paid requests', async () => {
  const permission = declaration('canIssuePrescriptions').initializer.getText(ast)
  for (const [isAdminSession, canUseMedicalTools, expected] of [[false, true, false], [true, true, true], [true, false, false], [false, false, false]]) {
    const context = { isAdminSession, canUseMedicalTools, result: null }
    vm.runInNewContext(`result = ${permission}`, context)
    assert.equal(context.result, expected)
  }
  for (const name of ['handleOpenPrescriptionModal', 'handleSavePrescription']) {
    const errors = []
    const context = { canIssuePrescriptions: false, setAppError: message => errors.push(message) }
    vm.runInNewContext(ts.transpile(declaration(name).getText(ast)), context)
    await context[name]()
    assert.equal(errors.length, 1)
    assert.match(errors[0], /solo para administradores/)
  }
  const context = { canIssuePrescriptions: false, Error }
  vm.runInNewContext(ts.transpile(declaration('handleStartPaidClinicalDocumentIssue').getText(ast)), context)
  await assert.rejects(context.handleStartPaidClinicalDocumentIssue({ service_type: 'prescription' }), /solo para administradores/)
  assert.match(source, /\{canIssuePrescriptions \? \([\s\S]*?onClick=\{handleOpenPrescriptionModal\}/)
  assert.match(source, /\{canIssuePrescriptions \? <button[\s\S]*?>Receta<\/button> : null\}/)
  assert.match(source, /prescriptionModalOpen && selectedPatient && canIssuePrescriptions/)
  assert.match(source, /<PaidClinicalDocumentsPanel\s+canIssuePrescriptions=\{canIssuePrescriptions\}/)
})
