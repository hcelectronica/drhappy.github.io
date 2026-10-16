import { useState } from 'react'
import { DIABETES_TYPES, GLUCOSE_CONTEXTS, GLUCOSE_METHODS } from '../supabase/functions/_shared/patientGlucose'
import type { GlucoseRecord } from '../supabase/functions/_shared/patientGlucose'
import { formatBpDateTime } from './BloodPressure'
import { glucoseSummaryText } from './glucoseSummaryText'
import './patientGlucose.css'

export function GlucoseSummary({ record, onCopy }: { record: GlucoseRecord; onCopy?: (message: string) => void }) {
  const [all, setAll] = useState(false)
  const [error, setError] = useState('')
  const treatment = record.treatment
  async function copy() {
    try {
      await navigator.clipboard.writeText(glucoseSummaryText(record))
      onCopy?.('Resumen copiado. Revisalo antes de incorporarlo a la evolución.')
    } catch {
      setError('No se pudo copiar el resumen. Seleccioná el texto del registro o habilitá el portapapeles.')
    }
  }
  return <section className="glucose-summary">
    <p>Datos informados por el paciente. No reemplazan la evaluación médica ni se incorporan automáticamente a una evolución.</p>
    {record.totalReadings > record.readings.length && <p>Mostrando las últimas {record.readings.length} de {record.totalReadings} mediciones. El resumen se limita a los registros cargados.</p>}
    {treatment && <div>
      <h4>Tratamiento habitual</h4>
      <p>{DIABETES_TYPES[treatment.diabetesType]}{treatment.diagnosedYear ? ` · Diagnóstico: ${treatment.diagnosedYear}` : ''} · {treatment.usesInsulin ? `${treatment.insulins.length} pautas de insulina` : 'No usa insulina'}</p>
      <ul>{treatment.insulins.map((item, i) => <li key={`i${i}`}>{item.name}: {item.units} unidades · {item.schedule}</li>)}
        {treatment.medications.map((item, i) => <li key={`m${i}`}>{item.name}: {item.dose} · {item.schedule}</li>)}</ul>
      {treatment.notes && <p>{treatment.notes}</p>}
      {record.updatedAt && <small>Tratamiento actualizado: {formatBpDateTime(record.updatedAt)}</small>}
    </div>}
    <div className="glucose-table-wrap"><table>
      <caption>Mediciones de glucosa (mg/dL)</caption>
      <thead><tr><th>Fecha y hora</th><th>Glucosa</th><th>Momento / método</th><th>Nota</th></tr></thead>
      <tbody>{(all ? record.readings : record.readings.slice(0, 10)).map(row => <tr key={row.id}>
        <td>{formatBpDateTime(row.measuredAt)}</td><td>{row.value} mg/dL</td>
        <td>{GLUCOSE_CONTEXTS[row.context]} · {GLUCOSE_METHODS[row.method]}</td><td>{row.note || '—'}</td>
      </tr>)}</tbody>
    </table></div>
    {!record.readings.length && <p>Sin mediciones registradas.</p>}
    {record.readings.length > 10 && <button type="button" onClick={() => setAll(value => !value)}>{all ? 'Ver menos' : 'Ver todas las mediciones'}</button>}
    {onCopy && <button type="button" onClick={() => void copy()}>Copiar resumen para la evolución</button>}
    {error && <p role="alert">{error}</p>}
  </section>
}
