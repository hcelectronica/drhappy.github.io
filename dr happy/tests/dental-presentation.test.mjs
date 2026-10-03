import test from 'node:test'
import assert from 'node:assert/strict'
import { createDentalDesignRecord, dentalAccount } from '../src/dental/dentalModel.ts'
import { dentalLedgerRows, dentalMoney, dentalDate } from '../src/dental/dentalPresentation.ts'

test('screen and print share exact chronological charges, payments and running balances', () => {
  const record = createDentalDesignRecord()
  record.treatments = [
    { id: 'a', date: '2026-10-01', acceptedDate: '2026-10-02', tooth: 36, surface: 'central', work: 'Conducto', budgetCents: 15000000, internalCostCents: 10000000, status: 'accepted' },
    { id: 'b', date: '2026-10-01', tooth: 11, surface: 'central', work: 'Propuesta', budgetCents: 900000, internalCostCents: 100, status: 'proposed' },
    { id: 'c', date: '2026-10-01', tooth: 26, surface: 'whole', work: 'Anulado', budgetCents: 300, internalCostCents: 50, status: 'cancelled' },
  ]
  record.payments = [{ id: 'payment', treatmentId: 'a', date: '2026-10-02', amountCents: 4500000, method: 'Efectivo' }]
  const before = structuredClone(record)
  const rows = dentalLedgerRows(record)
  assert.deepEqual(rows.map(row => row.id), ['a', 'payment'])
  assert.equal(rows[0].date, '2026-10-02')
  assert.equal(rows[0].face, 'Oclusal')
  assert.equal(rows[1].detail, 'Efectivo')
  assert.equal(rows.at(-1).balance, 10500000)
  assert.equal(rows.at(-1).balance, dentalAccount(record).balance)
  assert.equal(rows.reduce((sum, row) => sum + row.debit, 0), dentalAccount(record).charged)
  assert.deepEqual(record, before)
})

test('presentation preserves cents, dates and empty account', () => {
  assert.match(dentalMoney(10000001), /100\.000,01/)
  assert.equal(dentalDate('2026-10-03'), '03/10/2026')
  assert.deepEqual(dentalLedgerRows(createDentalDesignRecord()), [])
})
