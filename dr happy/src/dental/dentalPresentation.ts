import { surfaceLabel } from './dentalModel.ts'
import type { DentalDesignRecord } from './dentalModel'

export const dentalMoney = (cents: number) => (cents / 100).toLocaleString('es-AR', { style: 'currency', currency: 'ARS', maximumFractionDigits: 2 })
export const dentalDate = (date: string) => date.split('-').reverse().join('/')
export const dentalStatusLabels = { proposed: 'Propuesto', accepted: 'Aceptado', completed: 'Realizado', cancelled: 'Anulado' }

export function dentalLedgerRows(record: DentalDesignRecord) {
  const movements = [
    ...record.treatments.filter((item) => ['accepted', 'completed'].includes(item.status)).map((item) => ({
      id: item.id, date: item.acceptedDate || item.date, tooth: item.tooth,
      face: surfaceLabel(item.surface, item.tooth), label: item.work, detail: dentalStatusLabels[item.status],
      debit: item.budgetCents, credit: 0,
    })),
    ...record.payments.map((payment) => {
      const treatment = record.treatments.find((item) => item.id === payment.treatmentId)
      return {
        id: payment.id, date: payment.date, tooth: treatment?.tooth, face: '—',
        label: `Pago · ${treatment?.work || ''}`, detail: payment.method, debit: 0, credit: payment.amountCents,
      }
    }),
  ].sort((a, b) => a.date.localeCompare(b.date) || (b.debit - a.debit))
  return movements.reduce<Array<typeof movements[number] & { balance: number }>>((rows, movement) => [
    ...rows, { ...movement, balance: (rows.at(-1)?.balance ?? 0) + movement.debit - movement.credit },
  ], [])
}
