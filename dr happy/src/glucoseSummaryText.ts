import { DIABETES_TYPES, GLUCOSE_CONTEXTS, GLUCOSE_METHODS } from '../supabase/functions/_shared/patientGlucose'
import type { GlucoseRecord } from '../supabase/functions/_shared/patientGlucose'

export const glucoseDateTime = (value: string) => new Date(value).toLocaleString('es-AR', { dateStyle: 'short', timeStyle: 'short' })
export function glucoseSummaryText(record: GlucoseRecord): string {
  const recent = record.readings.filter(row => new Date(row.measuredAt).getTime() >= Date.now() - 30 * 86400000)
  const treatment = record.treatment
  return [
    'Registro de glucosa informado por el paciente (mg/dL; no verificado).',
    record.totalReadings > record.readings.length ? `Resumen limitado a las últimas ${record.readings.length} de ${record.totalReadings} mediciones.` : '',
    treatment ? `Diabetes: ${DIABETES_TYPES[treatment.diabetesType]}${treatment.diagnosedYear ? `, diagnóstico ${treatment.diagnosedYear}` : ''}.` : '',
    ...(treatment?.insulins.map(item => `Insulina: ${item.name}, ${item.units} unidades, ${item.schedule}.`) ?? []),
    ...(treatment?.medications.map(item => `Medicación: ${item.name}, ${item.dose}, ${item.schedule}.`) ?? []),
    treatment?.notes ? `Observaciones: ${treatment.notes}` : '',
    recent.length ? `Últimos 30 días: ${recent.length} mediciones; rango ${Math.min(...recent.map(r => r.value))}–${Math.max(...recent.map(r => r.value))} mg/dL. Los momentos de las tomas pueden diferir.` : 'Sin mediciones en los últimos 30 días.',
    ...recent.slice(0, 10).map(row => `${glucoseDateTime(row.measuredAt)}: ${row.value} mg/dL, ${GLUCOSE_CONTEXTS[row.context]}, ${GLUCOSE_METHODS[row.method]}${row.note ? ` (${row.note})` : ''}.`),
  ].filter(Boolean).join('\n')
}
