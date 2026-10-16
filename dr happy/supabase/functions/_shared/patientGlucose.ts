export const GLUCOSE_CONTEXTS = {
  fasting: 'En ayunas', before_meal: 'Antes de comer', after_meal: 'Después de comer',
  bedtime: 'Antes de dormir', other: 'Otro momento',
} as const
export const GLUCOSE_METHODS = { capillary: 'Glucómetro (dedo)', sensor: 'Sensor', laboratory: 'Laboratorio' } as const
export const DIABETES_TYPES = { unknown: 'No sé / en estudio', type1: 'Tipo 1', type2: 'Tipo 2', gestational: 'Gestacional', other: 'Otra' } as const
export interface GlucoseReading {
  id: string
  measuredAt: string
  value: number
  context: keyof typeof GLUCOSE_CONTEXTS
  method: keyof typeof GLUCOSE_METHODS
  note: string | null
}
export interface DiabetesTreatment {
  diabetesType: keyof typeof DIABETES_TYPES
  diagnosedYear: number | null
  usesInsulin: boolean
  insulins: Array<{ name: string; units: number; schedule: string }>
  medications: Array<{ name: string; dose: string; schedule: string }>
  notes: string
}
export interface GlucoseRecord { readings: GlucoseReading[]; totalReadings: number; treatment: DiabetesTreatment | null; updatedAt: string | null }
export class GlucoseInputError extends Error {}
const object = (value: unknown): Record<string, unknown> => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new GlucoseInputError('Revisá los datos del registro.')
  return value as Record<string, unknown>
}
function field(value: unknown, max: number, required = false): string {
  if (typeof value !== 'string' || value.trim().length > max || (required && !value.trim())) throw new GlucoseInputError('Completá los nombres, dosis y horarios sin superar el largo permitido.')
  return value.trim()
}
export function parseGlucoseReading(value: unknown, now = Date.now()) {
  const body = object(value)
  if (typeof body.value !== 'number' || !Number.isInteger(body.value) || body.value < 1 || body.value > 1000) throw new GlucoseInputError('Ingresá la glucosa entre 1 y 1000 mg/dL. Si el equipo muestra HI o LO, no inventes un número: consultá a tu equipo de salud.')
  if (typeof body.context !== 'string' || !Object.hasOwn(GLUCOSE_CONTEXTS, body.context)) throw new GlucoseInputError('Elegí el momento de la medición.')
  if (typeof body.method !== 'string' || !Object.hasOwn(GLUCOSE_METHODS, body.method)) throw new GlucoseInputError('Elegí cómo mediste la glucosa.')
  const measured = typeof body.measuredAt === 'string' ? new Date(body.measuredAt).getTime() : NaN
  if (!Number.isFinite(measured) || measured > now + 300000 || measured < now - 366 * 86400000) throw new GlucoseInputError('Revisá la fecha y hora de la medición (hasta un año atrás).')
  return { value: body.value, measured_at: new Date(measured).toISOString(), context: body.context, method: body.method, note: field(body.note ?? '', 300) || null }
}
export function parseDiabetesTreatment(value: unknown): DiabetesTreatment {
  const body = object(value)
  if (typeof body.diabetesType !== 'string' || !Object.hasOwn(DIABETES_TYPES, body.diabetesType) || typeof body.usesInsulin !== 'boolean') throw new GlucoseInputError('Elegí el tipo de diabetes y si usás insulina.')
  const year = body.diagnosedYear
  if (year !== null && (typeof year !== 'number' || !Number.isInteger(year) || year < 1900 || year > new Date().getFullYear())) throw new GlucoseInputError('Revisá el año del diagnóstico.')
  if (!Array.isArray(body.insulins) || body.insulins.length > 10 || !Array.isArray(body.medications) || body.medications.length > 20) throw new GlucoseInputError('Podés registrar hasta 10 pautas de insulina y 20 medicamentos.')
  const insulins = body.insulins.map(value => {
    const item = object(value)
    if (typeof item.units !== 'number' || !Number.isFinite(item.units) || item.units <= 0 || item.units > 1000 || Math.abs(Math.round(item.units * 10) - item.units * 10) > 1e-9) throw new GlucoseInputError('Revisá las unidades de insulina (hasta un decimal). Registrá solo la dosis indicada por tu médico.')
    return { name: field(item.name, 100, true), units: item.units, schedule: field(item.schedule, 120, true) }
  })
  if (body.usesInsulin && !insulins.length) throw new GlucoseInputError('Agregá al menos una insulina con sus unidades y horario.')
  if (!body.usesInsulin && insulins.length) throw new GlucoseInputError('Quitá las insulinas o indicá que las usás.')
  const medications = body.medications.map(value => {
    const item = object(value)
    return { name: field(item.name, 100, true), dose: field(item.dose, 100, true), schedule: field(item.schedule, 120, true) }
  })
  return { diabetesType: body.diabetesType as DiabetesTreatment['diabetesType'], diagnosedYear: year as number | null,
    usesInsulin: body.usesInsulin, insulins, medications, notes: field(body.notes ?? '', 500) }
}
