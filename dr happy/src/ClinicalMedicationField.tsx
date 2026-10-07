import { useMemo, useState } from 'react'
import { appendMedication } from './clinicalFollowUp'

export function ClinicalMedicationField({ label, value, onChange, catalog }: {
  label: string
  value: string
  onChange: (value: string) => void
  catalog: ReadonlyArray<{ drug: string }>
}) {
  const [query, setQuery] = useState('')
  const suggestions = useMemo(() => {
    const normalize = (text: string) => text.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
    const search = normalize(query.trim())
    return search.length < 2 ? [] : [...new Set(catalog.map(item => item.drug))]
      .filter(name => normalize(name).includes(search)).slice(0, 12)
  }, [catalog, query])
  return (
    <div className="evolution-field evolution-field--wide">
      <label>{label}
        <textarea value={value} onChange={event => onChange(event.target.value)} placeholder="Genérico, dosis, frecuencia y observaciones. Podés completarlo manualmente." />
      </label>
      <label>Buscar genérico en el vademécum
        <input value={query} onChange={event => setQuery(event.target.value)} placeholder="Escribí al menos dos letras" autoComplete="off" />
      </label>
      {suggestions.length ? <ul className="search-suggestions">
        {suggestions.map(name => <li key={name}><button type="button" onClick={() => {
          onChange(appendMedication(value, name))
          setQuery('')
        }}>{name}</button></li>)}
      </ul> : query.trim().length >= 2 ? <small>Sin coincidencias. Podés escribir el medicamento manualmente.</small> : null}
    </div>
  )
}
