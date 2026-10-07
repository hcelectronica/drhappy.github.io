import { adultAtMeasurement, classifiedBmiLabel, relevantWeightLoss, weightComparison } from './clinicalFollowUp'
import type { DatedWeight, PatientClinicalBaseline } from './clinicalFollowUp'

export function ClinicalWeightReview({ baseline, history, current, birthDate, compact = false }: {
  baseline: PatientClinicalBaseline
  history: DatedWeight[]
  current: DatedWeight
  birthDate?: string
  compact?: boolean
}) {
  const comparison = weightComparison(baseline, current)
  const loss = relevantWeightLoss(baseline, history, current, birthDate)
  return <div className="clinical-weight-review">
    <strong>IMC actual: {classifiedBmiLabel(current.pesoActual, current.tallaCmEnConsulta, birthDate, current.date)}</strong>
    {comparison ? <strong>{comparison}</strong> : null}
    {loss ? <p className="clinical-weight-alert" role="status">
      Pérdida de peso relevante: revisar si fue intencional y valorar clínicamente.
      {' '}{loss.percent.toFixed(2)}% desde {loss.referenceWeight} kg ({loss.referenceDate.split('-').reverse().join('/')}) en hasta 6 meses. No determina una enfermedad.
    </p> : null}
    {!compact ? <small>{adultAtMeasurement(birthDate, current.date)
      ? 'OMS adultos: bajo peso <18,5 · normopeso 18,5–<25 · sobrepeso 25–<30 · obesidad I 30–<35 · II 35–<40 · III ≥40. Valorar contexto clínico; no usar estos cortes en embarazo.'
      : 'Categorías OMS para adultos no aplicadas: falta fecha de nacimiento válida o el paciente era menor de 18 años. Menores requieren IMC por edad y sexo.'}</small> : null}
    {!compact && !baseline.pesoInicialFecha && baseline.pesoInicial ? <small>El peso inicial no tiene fecha: sirve como comparación, pero no se usa para alertas por tiempo.</small> : null}
  </div>
}
