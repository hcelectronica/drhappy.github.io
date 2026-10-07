export interface PatientClinicalBaseline {
  pesoInicial?: string
  tallaCm?: string
  tensionArterial?: string
  medicacionHabitual?: string
}

export interface ConsultationFollowUp {
  pesoActual?: string
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

export function validateClinicalMeasurements(patient: PatientClinicalBaseline, currentWeight?: string): string | null {
  for (const [label, value] of [
    ['Peso inicial', patient.pesoInicial], ['Talla', patient.tallaCm], ['Peso actual', currentWeight],
  ]) {
    if (value?.trim() && positiveMeasurement(value) === null) return `${label}: ingresá un número mayor que cero (kg para peso y cm para talla).`
  }
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

export function followUpLines(entry: ConsultationFollowUp): Array<[string, string]> {
  return [
    ['Peso actual (kg)', entry.pesoActual || ''],
    ['Talla utilizada para IMC (cm)', entry.pesoActual ? entry.tallaCmEnConsulta || '' : ''],
    ['IMC', entry.pesoActual && entry.tallaCmEnConsulta ? bmiLabel(entry.pesoActual, entry.tallaCmEnConsulta) : ''],
    ['Agregado de fármacos', entry.farmacosAgregados || ''],
    ['Estudios complementarios solicitados', entry.estudiosComplementarios || ''],
    ['Resumen y reflexión de Sofía (revisado por el profesional)', entry.resumenSofia || ''],
  ].filter((line): line is [string, string] => Boolean(line[1]))
}
