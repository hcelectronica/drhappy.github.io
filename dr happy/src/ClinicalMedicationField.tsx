import { useId, useMemo, useState } from 'react'
import { appendMedication } from './clinicalFollowUp'
import { clinicalMedicationLine, clinicalMedicationSuggestions } from './clinicalMedication'
import type { ClinicalMedication } from './clinicalMedication'

export function ClinicalMedicationField({ label, value, onChange, catalog }: {
  label: string
  value: string
  onChange: (value: string) => void
  catalog: ReadonlyArray<ClinicalMedication>
}) {
  const [query, setQuery] = useState('')
  const [selected, setSelected] = useState<ClinicalMedication | null>(null)
  const [regimen, setRegimen] = useState('')
  const regimenId = useId()
  const suggestions = useMemo(() => clinicalMedicationSuggestions(catalog, query), [catalog, query])
  return (
    <div className="clinical-medication-field">
      <label>{label}
        <textarea rows={2} value={value} onChange={event => onChange(event.target.value)} placeholder="Medicación, dosis y frecuencia. También podés escribir manualmente." />
      </label>
      <label>Agregar del vademécum
        <input value={query} onChange={event => setQuery(event.target.value)} placeholder="Escribí al menos dos letras" autoComplete="off" />
      </label>
      {suggestions.length ? <ul className="search-suggestions clinical-suggestions">
        {suggestions.map(item => <li key={`${item.drug}|${item.presentation}`}><button type="button" onClick={() => {
          setSelected(item)
          setRegimen('')
          setQuery('')
        }}><strong>{item.drug}</strong> <span>{item.presentation}</span></button></li>)}
      </ul> : query.trim().length >= 2 ? <small>Sin coincidencias. Podés escribir el medicamento manualmente.</small> : null}
      {selected ? <div className="clinical-medication-choice">
        <strong>{selected.drug} · {selected.presentation}</strong>
        {selected.dosage ? <details><summary>Posología de referencia del vademécum</summary><p>{selected.dosage}</p><small>No se asigna automáticamente al paciente.</small></details> : null}
        <label>Dosis por toma / frecuencia del paciente
          <input value={regimen} list={regimenId} onChange={event => setRegimen(event.target.value)} placeholder="Ej.: 1 comprimido cada 24 h; ajustar según paciente" />
        </label>
        {/comp/i.test(selected.presentation) ? <datalist id={regimenId}>
          <option value="1 comprimido cada 24 h" />
          <option value="1 comprimido cada 12 h" />
          <option value="2 comprimidos por día" />
        </datalist> : null}
        <div className="clinical-inline-actions">
          <button type="button" onClick={() => { onChange(appendMedication(value, clinicalMedicationLine(selected, regimen))); setSelected(null); setRegimen('') }}>Agregar medicamento</button>
          <button type="button" className="ghost compact" onClick={() => setSelected(null)}>Cancelar</button>
        </div>
      </div> : null}
    </div>
  )
}
