export interface PatientClinicalBaseline {
  pesoInicial?: string
  pesoInicialFecha?: string
  tallaCm?: string
  tensionArterial?: string
  medicacionHabitual?: string
}

export interface ConsultationFollowUp {
  pesoActual?: string
  tensionArterial?: string
  tallaCmEnConsulta?: string
  farmacosAgregados?: string
  estudiosComplementarios?: string
  resumenSofia?: string
}

export function positiveMeasurement(value: string | undefined): number | null {
  const text = value?.trim()
  if (!text || !/^\d+(?:[.,]\d+)?$/.test(text)) return null
  const number = Number(text.replace(',', '.'))
  return Number.isFinite(number) && number > 0 ? number : null
}

export function calculateBmi(weight: string | undefined, heightCm: string | undefined): number | null {
  const kg = positiveMeasurement(weight)
  const cm = positiveMeasurement(heightCm)
  if (kg === null || cm === null) return null
  const bmi = kg / ((cm / 100) ** 2)
  return Number.isFinite(bmi) && bmi > 0 ? bmi : null
}

export function bmiLabel(weight: string | undefined, heightCm: string | undefined): string {
  const bmi = calculateBmi(weight, heightCm)
  return bmi === null ? 'Sin peso y talla válidos' : `${bmi.toFixed(2)} kg/m²`
}

function measurementDay(value: string | undefined): string | null {
  if (!value) return null
  const day = value.slice(0, 10)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return null
  const parsed = new Date(`${day}T12:00:00Z`)
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== day) return null
  if (value.length === 10) return day
  if (!/^\d{4}-\d{2}-\d{2}T.+(?:Z|[+-]\d{2}:\d{2})$/.test(value)) return null
  const timestamp = new Date(value)
  if (!Number.isFinite(timestamp.getTime())) return null
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Argentina/Buenos_Aires', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(timestamp)
  return ['year', 'month', 'day'].map(type => parts.find(part => part.type === type)?.value).join('-')
}

export function adultAtMeasurement(birthDate: string | undefined, date: string): boolean {
  const birth = measurementDay(birthDate)
  const day = measurementDay(date)
  if (!birth || !day || birth > day) return false
  const age = Number(day.slice(0, 4)) - Number(birth.slice(0, 4)) - (day.slice(5) < birth.slice(5) ? 1 : 0)
  return age >= 18
}

export function adultBmiCategory(bmi: number | null): string | null {
  if (bmi === null || !Number.isFinite(bmi) || bmi <= 0) return null
  if (bmi < 18.5) return 'Bajo peso'
  if (bmi < 25) return 'Normopeso'
  if (bmi < 30) return 'Sobrepeso'
  if (bmi < 35) return 'Obesidad clase I'
  if (bmi < 40) return 'Obesidad clase II'
  return 'Obesidad clase III'
}

export function classifiedBmiLabel(weight: string | undefined, heightCm: string | undefined, birthDate: string | undefined, date: string): string {
  const numeric = bmiLabel(weight, heightCm)
  const category = adultAtMeasurement(birthDate, date) ? adultBmiCategory(calculateBmi(weight, heightCm)) : null
  return category ? `${numeric} · ${category}` : numeric
}

export interface DatedWeight extends ConsultationFollowUp {
  date: string
  id?: string
}

export function weightComparison(baseline: PatientClinicalBaseline, current: ConsultationFollowUp): string | null {
  const initial = positiveMeasurement(baseline.pesoInicial)
  const actual = positiveMeasurement(current.pesoActual)
  if (initial === null || actual === null) return null
  const delta = actual - initial
  const initialBmi = calculateBmi(baseline.pesoInicial, baseline.tallaCm)
  const currentBmi = calculateBmi(current.pesoActual, current.tallaCmEnConsulta)
  return `Cambio desde peso inicial: ${delta >= 0 ? '+' : ''}${delta.toFixed(2)} kg (${delta >= 0 ? '+' : ''}${(delta / initial * 100).toFixed(2)}%)`
    + (initialBmi !== null && currentBmi !== null ? ` · IMC inicial ${initialBmi.toFixed(2)} → actual ${currentBmi.toFixed(2)}` : '')
}

export function relevantWeightLoss(baseline: PatientClinicalBaseline, history: DatedWeight[], current: DatedWeight, birthDate?: string): { percent: number; referenceDate: string; referenceWeight: number } | null {
  if (!adultAtMeasurement(birthDate, current.date)) return null
  const day = measurementDay(current.date)
  const actual = positiveMeasurement(current.pesoActual)
  if (!day || actual === null) return null
  const [year, month, date] = day.split('-').map(Number)
  const first = new Date(Date.UTC(year, month - 1 - 6, 1))
  const lastDay = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0)).getUTCDate()
  first.setUTCDate(Math.min(date, lastDay))
  const lower = first.toISOString().slice(0, 10)
  const candidates = [
    { pesoActual: baseline.pesoInicial, date: baseline.pesoInicialFecha || '' },
    ...history.filter(entry => !current.id || entry.id !== current.id),
  ].flatMap(entry => {
    const previousDay = measurementDay(entry.date)
    const weight = positiveMeasurement(entry.pesoActual)
    return previousDay && previousDay >= lower && previousDay < day && weight !== null
      && adultAtMeasurement(birthDate, previousDay) ? [{ date: previousDay, weight }] : []
  }).sort((a, b) => b.weight - a.weight || b.date.localeCompare(a.date))
  const reference = candidates[0]
  if (!reference || actual > reference.weight * .95) return null
  return { percent: (reference.weight - actual) / reference.weight * 100, referenceDate: reference.date, referenceWeight: reference.weight }
}

export function validateClinicalMeasurements(patient: PatientClinicalBaseline, currentWeight?: string): string | null {
  for (const [label, value] of [
    ['Peso inicial', patient.pesoInicial], ['Talla', patient.tallaCm], ['Peso actual', currentWeight],
  ]) {
    if (value?.trim() && positiveMeasurement(value) === null) return `${label}: ingresá un número mayor que cero (kg para peso y cm para talla).`
  }
  if (patient.pesoInicialFecha?.trim() && !measurementDay(patient.pesoInicialFecha)) return 'Fecha del peso inicial: ingresá una fecha válida.'
  if (patient.tensionArterial?.trim() && (
    !/^\d{2,3}\s*\/\s*\d{2,3}$/.test(patient.tensionArterial.trim()) ||
    patient.tensionArterial.split('/').some(value => positiveMeasurement(value) === null)
  )) {
    return 'Tensión arterial: usá el formato sistólica/diastólica, por ejemplo 120/80 mmHg.'
  }
  return null
}

export function normalizeClinicalBaseline(value: PatientClinicalBaseline): PatientClinicalBaseline {
  return {
    pesoInicial: typeof value.pesoInicial === 'string' ? value.pesoInicial : '',
    pesoInicialFecha: typeof value.pesoInicialFecha === 'string' ? value.pesoInicialFecha : '',
    tallaCm: typeof value.tallaCm === 'string' ? value.tallaCm : '',
    tensionArterial: typeof value.tensionArterial === 'string' ? value.tensionArterial : '',
    medicacionHabitual: typeof value.medicacionHabitual === 'string' ? value.medicacionHabitual : '',
  }
}

export function appendMedication(current: string, addition: string): string {
  return [current.trim(), addition.trim()].filter(Boolean).join('\n')
}

export function mergeClinicalPathologies(known: string, chronic: string): string {
  return [...new Set([known.trim(), chronic.trim()].filter(Boolean))].join('\n')
}

export function followUpLines(entry: ConsultationFollowUp & { date?: string }, birthDate?: string): Array<[string, string]> {
  return [
    ['Peso actual (kg)', entry.pesoActual || ''],
    ['Tensión arterial (mmHg)', entry.tensionArterial || ''],
    ['Talla utilizada para IMC (cm)', entry.pesoActual ? entry.tallaCmEnConsulta || '' : ''],
    ['IMC', entry.pesoActual && entry.tallaCmEnConsulta ? classifiedBmiLabel(entry.pesoActual, entry.tallaCmEnConsulta, birthDate, entry.date || '') : ''],
    ['Agregado de fármacos', entry.farmacosAgregados || ''],
    ['Estudios complementarios solicitados', entry.estudiosComplementarios || ''],
    ['Resumen y reflexión de Sofía (revisado por el profesional)', entry.resumenSofia || ''],
  ].filter((line): line is [string, string] => Boolean(line[1]))
}
