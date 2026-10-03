export const PERMANENT_ROWS = [
  [18, 17, 16, 15, 14, 13, 12, 11, 21, 22, 23, 24, 25, 26, 27, 28],
  [48, 47, 46, 45, 44, 43, 42, 41, 31, 32, 33, 34, 35, 36, 37, 38],
]
export const TEMPORARY_ROWS = [
  [55, 54, 53, 52, 51, 61, 62, 63, 64, 65],
  [85, 84, 83, 82, 81, 71, 72, 73, 74, 75],
]
export const SURFACES = ['whole', 'vestibular', 'oral', 'mesial', 'distal', 'central'] as const
export type DentalSurface = typeof SURFACES[number]
export const CONDITIONS = [
  { id: 'caries', label: 'Caries', symbol: 'surface' },
  { id: 'restoration', label: 'Restauración', symbol: 'surface' },
  { id: 'unerupted', label: 'Pieza no erupcionada', symbol: 'x' },
  { id: 'extraction', label: 'Extracción', symbol: '=' },
  { id: 'missing', label: 'Pieza ausente', symbol: 'x' },
  { id: 'fixed', label: 'Prótesis fija', symbol: 'bridge' },
  { id: 'removable', label: 'Prótesis removible', symbol: 'box' },
  { id: 'crown', label: 'Corona', symbol: 'circle' },
] as const
export type DentalCondition = typeof CONDITIONS[number]['id']
export interface DentalMark {
  id: string
  tooth: number
  surface: DentalSurface
  condition: DentalCondition
  status: 'existing' | 'needed'
  note: string
  createdAt: string
}
export interface DentalTreatment {
  id: string
  date: string
  tooth: number
  surface: DentalSurface
  work: string
  budgetCents: number
  internalCostCents: number
  status: 'proposed' | 'accepted' | 'completed' | 'cancelled'
  acceptedDate?: string
  performedDate?: string
}
export interface DentalPayment {
  id: string
  treatmentId: string
  date: string
  amountCents: number
  method: 'Efectivo' | 'Transferencia' | 'Mercado Pago'
}
export interface DentalDesignRecord {
  version: 1
  patient: { name: string; dni: string; address: string; phone: string; locality: string; coverage: string; email?: string; birthDate?: string; memberNumber?: string }
  status: 'provisional' | 'confirmed'
  marks: DentalMark[]
  treatments: DentalTreatment[]
  payments: DentalPayment[]
  observations: string
  coverageNotes: string
  consentNotes: string
}
export function validTooth(tooth: number): boolean {
  return [...PERMANENT_ROWS.flat(), ...TEMPORARY_ROWS.flat()].includes(tooth)
}
export function surfaceLabel(surface: DentalSurface, tooth: number): string {
  if (surface === 'whole') return 'Pieza completa'
  if (surface === 'central') return tooth % 10 <= 3 ? 'Incisal' : 'Oclusal'
  if (surface === 'oral') return [1, 2, 5, 6].includes(Math.floor(tooth / 10)) ? 'Palatina' : 'Lingual'
  return { vestibular: 'Vestibular', mesial: 'Mesial', distal: 'Distal' }[surface]
}
export function markColor(mark: DentalMark): 'red' | 'blue' {
  if (mark.condition === 'missing') return 'red'
  if (mark.condition === 'unerupted') return 'blue'
  return mark.status === 'needed' ? 'red' : 'blue'
}
export function moneyToCents(value: string): number {
  if (!/^\d+(?:[.,]\d{1,2})?$/.test(value.trim())) throw new Error('Usá un importe positivo, sin separadores de miles y con hasta dos decimales.')
  const [whole, fraction = ''] = value.trim().replace(',', '.').split('.')
  const cents = Number(whole) * 100 + Number(fraction.padEnd(2, '0'))
  if (!Number.isSafeInteger(cents)) throw new Error('El importe es demasiado grande.')
  return cents
}
function validDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const date = new Date(`${value}T00:00:00Z`)
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value
}
export function treatmentAccount(record: DentalDesignRecord, treatment: DentalTreatment) {
  const paid = record.payments.filter((payment) => payment.treatmentId === treatment.id).reduce((sum, payment) => sum + payment.amountCents, 0)
  const charged = ['accepted', 'completed'].includes(treatment.status) ? treatment.budgetCents : 0
  return { charged, paid, balance: charged - paid, internalCost: treatment.internalCostCents }
}
export function dentalAccount(record: DentalDesignRecord) {
  return record.treatments.reduce((total, treatment) => {
    const account = treatmentAccount(record, treatment)
    return {
      charged: total.charged + account.charged,
      paid: total.paid + account.paid,
      balance: total.balance + account.balance,
      internalCost: total.internalCost + (['accepted', 'completed'].includes(treatment.status) ? account.internalCost : 0),
    }
  }, { charged: 0, paid: 0, balance: 0, internalCost: 0 })
}
export function addDentalPayment(record: DentalDesignRecord, payment: DentalPayment): DentalDesignRecord {
  const treatment = record.treatments.find((item) => item.id === payment.treatmentId)
  if (!treatment || !['accepted', 'completed'].includes(treatment.status)) throw new Error('Aceptá el presupuesto antes de registrar un pago.')
  if (!validDate(payment.date) || payment.date < (treatment.acceptedDate || treatment.date)) throw new Error('La fecha del pago debe ser válida y no anterior a la aceptación del presupuesto.')
  if (record.payments.some((item) => item.id === payment.id)) throw new Error('Este pago ya está registrado.')
  if (!Number.isSafeInteger(payment.amountCents) || payment.amountCents <= 0) throw new Error('El pago debe ser mayor a cero.')
  if (payment.amountCents > treatmentAccount(record, treatment).balance) throw new Error('El pago supera el saldo pendiente de este tratamiento.')
  return { ...record, payments: [...record.payments, payment] }
}
export function changeTreatmentStatus(record: DentalDesignRecord, id: string, status: DentalTreatment['status'], date: string): DentalDesignRecord {
  const current = record.treatments.find((item) => item.id === id)
  if (!current) throw new Error('No se encontró el tratamiento.')
  if (!validDate(date)) throw new Error('Indicá una fecha válida.')
  if (status === 'completed' && date < (current.acceptedDate || current.date)) throw new Error('La realización no puede ser anterior a la aceptación del presupuesto.')
  const allowed: Record<DentalTreatment['status'], DentalTreatment['status'][]> = {
    proposed: ['accepted', 'cancelled'], accepted: ['completed', 'cancelled'], completed: [], cancelled: [],
  }
  if (!allowed[current.status].includes(status)) throw new Error('El cambio de estado no corresponde al estado actual del tratamiento.')
  if (status === 'cancelled' && treatmentAccount(record, current).paid > 0) throw new Error('Este tratamiento tiene pagos. No se puede anular sin resolverlos primero.')
  return { ...record, treatments: record.treatments.map((item) => item.id === id ? {
    ...item, status, ...(status === 'accepted' ? { acceptedDate: date } : {}), ...(status === 'completed' ? { performedDate: date } : {}),
  } : item) }
}
export function createDentalDesignRecord(): DentalDesignRecord {
  return {
    version: 1,
    patient: { name: 'Paciente de demostración', dni: '', address: '', phone: '', locality: '', coverage: '' },
    status: 'provisional', marks: [], treatments: [], payments: [],
    observations: '', coverageNotes: '', consentNotes: '',
  }

}

function object(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
function cents(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
}
function isMark(value: unknown): value is DentalMark {
  return object(value) && typeof value.id === 'string' && typeof value.tooth === 'number' && validTooth(value.tooth)
    && SURFACES.some((surface) => surface === value.surface)
    && CONDITIONS.some((condition) => condition.id === value.condition)
    && ['existing', 'needed'].includes(String(value.status)) && typeof value.note === 'string' && typeof value.createdAt === 'string'
}
function isTreatment(value: unknown): value is DentalTreatment {
  return object(value) && typeof value.id === 'string' && typeof value.date === 'string' && validDate(value.date)
    && typeof value.tooth === 'number' && validTooth(value.tooth) && SURFACES.some((surface) => surface === value.surface)
    && typeof value.work === 'string' && cents(value.budgetCents) && cents(value.internalCostCents)
    && ['proposed', 'accepted', 'completed', 'cancelled'].includes(String(value.status))
    && (value.acceptedDate === undefined || (typeof value.acceptedDate === 'string' && validDate(value.acceptedDate)))
    && (value.performedDate === undefined || (typeof value.performedDate === 'string' && validDate(value.performedDate)))
    && (!['accepted', 'completed'].includes(String(value.status)) || typeof value.acceptedDate === 'string')
    && (value.status !== 'completed' || (typeof value.performedDate === 'string' && typeof value.acceptedDate === 'string' && value.performedDate >= value.acceptedDate))
}
function isPayment(value: unknown): value is DentalPayment {
  return object(value) && typeof value.id === 'string' && typeof value.treatmentId === 'string' && typeof value.date === 'string' && validDate(value.date)
    && cents(value.amountCents) && value.amountCents > 0 && ['Efectivo', 'Transferencia', 'Mercado Pago'].includes(String(value.method))
}
export function isDentalDesignRecord(value: unknown): value is DentalDesignRecord {
  if (!object(value) || value.version !== 1 || !object(value.patient)) return false
  const patient = value.patient
  if (!['name', 'dni', 'address', 'phone', 'locality', 'coverage'].every((key) => typeof patient[key] === 'string')) return false
  if (!['provisional', 'confirmed'].includes(String(value.status))) return false
  if (!Array.isArray(value.marks) || !value.marks.every(isMark) || !Array.isArray(value.treatments) || !value.treatments.every(isTreatment) || !Array.isArray(value.payments) || !value.payments.every(isPayment)) return false
  if (!['observations', 'coverageNotes', 'consentNotes'].every((key) => typeof value[key] === 'string')) return false
  for (const entries of [value.marks, value.treatments, value.payments]) {
    if (new Set(entries.map((entry) => entry.id)).size !== entries.length) return false
  }
  const accountRecord = { treatments: value.treatments, payments: value.payments }
  for (const payment of accountRecord.payments) {
    if (!accountRecord.treatments.some((treatment) => treatment.id === payment.treatmentId && ['accepted', 'completed'].includes(treatment.status) && payment.date >= (treatment.acceptedDate || treatment.date))) return false
  }
  for (const treatment of accountRecord.treatments) {
    const paid = accountRecord.payments.filter((payment) => payment.treatmentId === treatment.id).reduce((sum, payment) => sum + payment.amountCents, 0)
    if (paid > treatment.budgetCents) return false
  }
  return true
}
