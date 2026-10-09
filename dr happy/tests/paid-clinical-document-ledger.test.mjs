import test from 'node:test'
import assert from 'node:assert/strict'
import { paidDocumentLedgerEntries } from '../src/paidClinicalDocumentLedger.ts'
import { summarizeLedger, groupLedgerByPatient } from '../src/ledgerModel.ts'

const request = {
  id: 'request-one', patient_first_name: 'Ana', patient_last_name: 'Prueba',
  patient_dni: '12.345.678', patient_email: 'ana@example.test', patient_phone: '11111111',
  patient_birth_date: null, reason: 'Evaluación', amount: 30000, status: 'pending_review',
  payment_status: 'approved', paid_at: '2026-10-09T01:00:00Z', completed_at: null,
  created_at: '2026-10-08T20:00:00Z',
}

test('approved payment is collected immediately even without issuing or creating a patient chart', () => {
  const entries = paidDocumentLedgerEntries([request], [])
  assert.equal(entries.length, 1)
  assert.equal(entries[0].paidAmount, 30000)
  assert.equal(entries[0].date, '2026-10-08')
  assert.equal(entries[0].paidClinicalDocumentRequestId, request.id)
  const totals = summarizeLedger(entries)
  assert.equal(totals.collected, 30000)
  assert.equal(totals.pending, 0)
  assert.equal(totals.debtors.size, 0)
})

test('unpaid, rejected and cancelled requests never affect totals; completed payments still count', () => {
  const entries = paidDocumentLedgerEntries([
    { ...request, id: 'unpaid', payment_status: 'pending', status: 'pending_payment' },
    { ...request, id: 'rejected', payment_status: 'rejected' },
    { ...request, id: 'cancelled', status: 'cancelled' },
    { ...request, id: 'completed', status: 'completed' },
  ], [])
  assert.deepEqual(entries.map((entry) => entry.id), ['paid-document-completed'])
})

test('duplicate refreshes do not duplicate a payment and DNI groups existing or not-yet-created patients', () => {
  assert.equal(paidDocumentLedgerEntries([request, request], []).length, 1)
  const patients = [{ id: 'patient-one', dni: '12345678', nombre: 'Ana', apellido: 'Prueba' }]
  const matched = paidDocumentLedgerEntries([request], patients)
  assert.equal(matched[0].patientId, 'patient-one')
  const grouped = groupLedgerByPatient(paidDocumentLedgerEntries([request, { ...request, id: 'second' }], []))
  assert.equal(grouped.length, 1)
  assert.equal(grouped[0].collected, 60000)
})

test('invalid confirmed amounts and dates are reported, not silently added as zero', () => {
  for (const amount of [0, -1, NaN, Infinity]) assert.throws(() => paidDocumentLedgerEntries([{ ...request, amount }], []))
  assert.throws(() => paidDocumentLedgerEntries([{ ...request, paid_at: 'invalid' }], []))
})
