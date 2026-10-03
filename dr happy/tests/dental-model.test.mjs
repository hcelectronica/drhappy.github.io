import test from 'node:test'
import assert from 'node:assert/strict'
import {
  PERMANENT_ROWS, TEMPORARY_ROWS, addDentalPayment, changeTreatmentStatus, createDentalDesignRecord,
  dentalAccount, isDentalDesignRecord, markColor, moneyToCents, surfaceLabel, validTooth,
} from '../src/dental/dentalModel.ts'

function withTreatment() {
  const record = createDentalDesignRecord()
  record.treatments.push({
    id: 'work-1', date: '2026-10-02', tooth: 36, surface: 'central',
    work: 'Restauración', budgetCents: 5000000, internalCostCents: 1200000, status: 'proposed',
  })
  return record
}

test('FDI preserves reference orientation, 32 permanent and 20 temporal pieces', () => {
  assert.equal(PERMANENT_ROWS.flat().length, 32)
  assert.equal(TEMPORARY_ROWS.flat().length, 20)
  assert.equal(new Set([...PERMANENT_ROWS.flat(), ...TEMPORARY_ROWS.flat()]).size, 52)
  assert.deepEqual(PERMANENT_ROWS[0].slice(0, 8), [18, 17, 16, 15, 14, 13, 12, 11])
  assert.deepEqual(PERMANENT_ROWS[1].slice(8), [31, 32, 33, 34, 35, 36, 37, 38])
  assert.equal(validTooth(19), false)
  assert.equal(validTooth(85), true)
})

test('face labels distinguish incisal/occlusal and palatal/lingual', () => {
  assert.equal(surfaceLabel('central', 11), 'Incisal')
  assert.equal(surfaceLabel('central', 36), 'Oclusal')
  assert.equal(surfaceLabel('oral', 55), 'Palatina')
  assert.equal(surfaceLabel('oral', 85), 'Lingual')
})

test('reference colors retain missing red and unerupted blue', () => {
  assert.equal(markColor({ condition: 'missing', status: 'existing' }), 'red')
  assert.equal(markColor({ condition: 'unerupted', status: 'needed' }), 'blue')
  assert.equal(markColor({ condition: 'restoration', status: 'existing' }), 'blue')
  assert.equal(markColor({ condition: 'caries', status: 'needed' }), 'red')
})

test('amounts use exact cents and reject ambiguous or invalid formats', () => {
  assert.equal(moneyToCents('1234,56'), 123456)
  assert.equal(moneyToCents('0.10'), 10)
  assert.equal(moneyToCents('100'), 10000)
  for (const value of ['', '-1', '1.000,00', '10.123', 'Infinity', '1e5', '9007199254740992']) {
    assert.throws(() => moneyToCents(value))
  }
})

test('proposed budget generates no debt and cannot receive payments', () => {
  const record = withTreatment()
  assert.deepEqual(dentalAccount(record), { charged: 0, paid: 0, balance: 0, internalCost: 0 })
  assert.throws(() => addDentalPayment(record, { id: 'pay-1', treatmentId: 'work-1', date: '2026-10-02', amountCents: 100, method: 'Efectivo' }))
})

test('accepted budget charges once; internal cost never adds to debt; partial payment updates same account', () => {
  const record = changeTreatmentStatus(withTreatment(), 'work-1', 'accepted', '2026-10-02')
  assert.deepEqual(dentalAccount(record), { charged: 5000000, paid: 0, balance: 5000000, internalCost: 1200000 })
  const payment = { id: 'pay-1', treatmentId: 'work-1', date: '2026-10-02', amountCents: 2000000, method: 'Efectivo' }
  const paid = addDentalPayment(record, payment)
  assert.deepEqual(dentalAccount(paid), { charged: 5000000, paid: 2000000, balance: 3000000, internalCost: 1200000 })
  assert.equal(record.payments.length, 0)
  assert.throws(() => addDentalPayment(paid, payment), /ya está registrado/)
  assert.throws(() => addDentalPayment(paid, { ...payment, id: 'pay-2', amountCents: 3000001 }), /supera/)
  assert.throws(() => changeTreatmentStatus(paid, 'work-1', 'cancelled', '2026-10-02'), /tiene pagos/)
})

test('completion preserves original charge and payment, never accepts twice or regresses', () => {
  const accepted = changeTreatmentStatus(withTreatment(), 'work-1', 'accepted', '2026-10-02')
  const completed = changeTreatmentStatus(accepted, 'work-1', 'completed', '2026-10-03')
  assert.deepEqual(dentalAccount(completed), dentalAccount(accepted))
  assert.equal(completed.treatments[0].acceptedDate, '2026-10-02')
  assert.equal(completed.treatments[0].performedDate, '2026-10-03')
  assert.throws(() => changeTreatmentStatus(accepted, 'work-1', 'accepted', '2026-10-03'))
  assert.throws(() => changeTreatmentStatus(completed, 'work-1', 'proposed', '2026-10-03'))
})

test('cancellation without payments removes charge but retains the treatment', () => {
  const accepted = changeTreatmentStatus(withTreatment(), 'work-1', 'accepted', '2026-10-02')
  const cancelled = changeTreatmentStatus(accepted, 'work-1', 'cancelled', '2026-10-03')
  assert.equal(dentalAccount(cancelled).balance, 0)
  assert.equal(cancelled.treatments.length, 1)
  assert.throws(() => addDentalPayment(cancelled, { id: 'pay-1', treatmentId: 'work-1', date: '2026-10-03', amountCents: 100, method: 'Efectivo' }))
})

test('payment and completion dates cannot precede acceptance or contain invalid calendar dates', () => {
  const record = changeTreatmentStatus(withTreatment(), 'work-1', 'accepted', '2026-10-02')
  for (const date of ['2026-10-01', '2026-02-30', 'not-a-date']) {
    assert.throws(() => addDentalPayment(record, { id: 'pay-1', treatmentId: 'work-1', date, amountCents: 100, method: 'Efectivo' }))
    assert.throws(() => changeTreatmentStatus(record, 'work-1', 'completed', date))
  }
})

test('local drafts validate structure, ownership of payments, duplicates and total bounds', () => {
  const accepted = changeTreatmentStatus(withTreatment(), 'work-1', 'accepted', '2026-10-02')
  const paid = addDentalPayment(accepted, { id: 'pay-1', treatmentId: 'work-1', date: '2026-10-02', amountCents: 100, method: 'Efectivo' })
  assert.equal(isDentalDesignRecord(JSON.parse(JSON.stringify(paid))), true)
  assert.equal(isDentalDesignRecord(null), false)
  assert.equal(isDentalDesignRecord({ ...paid, patient: {} }), false)
  assert.equal(isDentalDesignRecord({ ...paid, treatments: [{ ...paid.treatments[0], tooth: 99 }] }), false)
  assert.equal(isDentalDesignRecord({ ...paid, treatments: [...paid.treatments, paid.treatments[0]] }), false)
  assert.equal(isDentalDesignRecord({ ...paid, payments: [{ ...paid.payments[0], treatmentId: 'nonexistent' }] }), false)
  assert.equal(isDentalDesignRecord({ ...paid, payments: [{ ...paid.payments[0], amountCents: 5000001 }] }), false)
})
