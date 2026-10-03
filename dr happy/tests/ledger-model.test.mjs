import test from 'node:test'
import assert from 'node:assert/strict'
import { filterLedgerPatients, groupLedgerByPatient, summarizeLedger } from '../src/ledgerModel.ts'

const entry = (id, changes = {}) => ({
  id, patientId: 'p1', patientName: 'López, José', date: '2026-10-03',
  intervention: 'Conducto', totalAmount: 150000, paidAmount: 150000,
  internalCost: 100000, dentalRecordPatientId: 'p1', ...changes,
})

test('screenshot interventions become one patient card without changing financial totals', () => {
  const entries = [
    entry('t1'),
    entry('t2', { intervention: 'Restauración oclusal', totalAmount: 234424, paidAmount: 234424, internalCost: 56466 }),
    entry('t3', { intervention: 'Extracción', internalCost: 45000 }),
    entry('t4', { totalAmount: 100000, paidAmount: 100000, internalCost: 50000 }),
  ]
  const groups = groupLedgerByPatient(entries)
  assert.equal(groups.length, 1)
  assert.equal(groups[0].entries.length, 4)
  assert.equal(groups[0].total, 634424)
  assert.equal(groups[0].collected, 634424)
  assert.equal(groups[0].pending, 0)
  assert.equal(groups[0].internalCost, 251466)
  assert.equal(groups[0].debtors.size, 0)
  assert.equal(filterLedgerPatients(groups, 'settled', '').length, 1)
  assert.equal(filterLedgerPatients(groups, 'debt', '').length, 0)
})

test('mixed paid/unpaid patient belongs only to debt filter and keeps full account', () => {
  const entries = [entry('paid'), entry('debt', { paidAmount: 45000, intervention: 'Extracción' })]
  const groups = groupLedgerByPatient(entries)
  const visible = filterLedgerPatients(groups, 'debt', 'extraccion')
  assert.equal(visible.length, 1)
  assert.equal(visible[0].entries.length, 2)
  assert.equal(visible[0].total, 300000)
  assert.equal(visible[0].collected, 195000)
  assert.equal(visible[0].pending, 105000)
  assert.equal(filterLedgerPatients(groups, 'settled', '').length, 0)
  assert.equal(filterLedgerPatients(groups, 'all', 'LOPEZ').length, 1)
  assert.equal(filterLedgerPatients(groups, 'all', 'missing').length, 0)
})

test('same names never merge patients or undercount debtors', () => {
  const entries = [entry('a', { paidAmount: 0 }), entry('b', { patientId: 'p2', dentalRecordPatientId: 'p2', paidAmount: 0 })]
  assert.equal(groupLedgerByPatient(entries).length, 2)
  assert.equal(summarizeLedger(entries).debtors.size, 2)
})

test('cent amounts sum exactly and internal costs never increase debt', () => {
  const summary = summarizeLedger([
    entry('a', { totalAmount: 0.1, paidAmount: 0.05, internalCost: 0.1 }),
    entry('b', { totalAmount: 0.2, paidAmount: 0.1, internalCost: 0.2 }),
  ])
  assert.equal(summary.total, 0.3)
  assert.equal(summary.collected, 0.15)
  assert.equal(summary.pending, 0.15)
  assert.equal(summary.internalCost, 0.3)
})

test('missing costs are distinguished from an explicit zero; legacy entries remain intact', () => {
  const entries = [
    entry('legacy', { internalCost: undefined, dentalRecordPatientId: undefined }),
    entry('zero', { internalCost: 0 }),
  ]
  const copy = structuredClone(entries)
  const group = groupLedgerByPatient(entries)[0]
  assert.equal(group.costedEntries, 1)
  assert.equal(group.internalCost, 0)
  assert.equal(group.entries.length, 2)
  assert.deepEqual(entries, copy)
})

test('newest record controls patient display without modifying stored order', () => {
  const entries = [entry('old', { date: '2026-09-01', patientName: 'Old name' }), entry('new', { date: '2026-10-03' })]
  const group = groupLedgerByPatient(entries)[0]
  assert.equal(group.patientName, 'López, José')
  assert.equal(group.date, '2026-10-03')
  assert.equal(group.entries[0].id, 'new')
  assert.equal(entries[0].id, 'old')
})

test('empty balance and filters have no phantom patients or costs', () => {
  const summary = summarizeLedger([])
  assert.equal(summary.total, 0)
  assert.equal(summary.collected, 0)
  assert.equal(summary.pending, 0)
  assert.equal(summary.costedEntries, 0)
  assert.deepEqual(filterLedgerPatients(groupLedgerByPatient([]), 'all', ''), [])
})
