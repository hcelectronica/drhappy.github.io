export interface LedgerAmountEntry {
  id: string
  patientId: string
  patientName: string
  date: string
  intervention: string
  totalAmount: number
  paidAmount: number
  internalCost?: number
  dentalRecordPatientId?: string
}

export type LedgerFilter = 'all' | 'debt' | 'settled'

export function summarizeLedger(entries: readonly LedgerAmountEntry[]) {
  let totalCents = 0
  let collectedCents = 0
  let pendingCents = 0
  let costCents = 0
  let costedEntries = 0
  const debtors = new Set<string>()
  for (const entry of entries) {
    const total = Math.round(entry.totalAmount * 100)
    const collected = Math.round(entry.paidAmount * 100)
    const pending = Math.max(total - collected, 0)
    totalCents += total
    collectedCents += collected
    pendingCents += pending
    if (pending > 0) debtors.add(entry.patientId || entry.dentalRecordPatientId || entry.id)
    if (entry.internalCost !== undefined) {
      costCents += Math.round(entry.internalCost * 100)
      costedEntries++
    }
  }
  return {
    total: totalCents / 100, collected: collectedCents / 100, pending: pendingCents / 100,
    internalCost: costCents / 100, costedEntries, debtors,
  }
}

export function groupLedgerByPatient<T extends LedgerAmountEntry>(entries: readonly T[]) {
  const patients = new Map<string, { patientId: string; patientName: string; date: string; entries: T[] }>()
  for (const entry of [...entries].sort((left, right) => right.date.localeCompare(left.date))) {
    const id = entry.patientId || entry.dentalRecordPatientId || entry.id
    const group = patients.get(id) ?? { patientId: id, patientName: entry.patientName, date: entry.date, entries: [] }
    group.entries.push(entry)
    patients.set(id, group)
  }
  return Array.from(patients.values()).map((group) => ({ ...group, ...summarizeLedger(group.entries) }))
}

export function filterLedgerPatients<T extends LedgerAmountEntry>(
  groups: ReturnType<typeof groupLedgerByPatient<T>>,
  filter: LedgerFilter,
  search: string,
) {
  const normalize = (value: string) => value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim()
  const query = normalize(search)
  return groups.filter((group) => {
    if (filter === 'debt' && group.pending <= 0) return false
    if (filter === 'settled' && group.pending > 0) return false
    return !query || normalize(`${group.patientName} ${group.entries.map((entry) => entry.intervention).join(' ')}`).includes(query)
  })
}
