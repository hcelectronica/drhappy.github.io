import { useMemo, useState } from 'react'
import { findStudySuggestions, formatOrderedStudy, studyCodeLabel } from './studyCatalog'
import type { CatalogStudy } from './studyCatalog'

export function ClinicalStudyField({ value, onChange, catalog, loading, error }: {
  value: string
  onChange: (value: string) => void
  catalog: CatalogStudy[]
  loading: boolean
  error: string | null
}) {
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState(false)
  const suggestions = useMemo(() => findStudySuggestions(catalog, query), [catalog, query])
  return <div className="clinical-study-field">
    <label>Estudios complementarios (opcional)<textarea name="estudiosComplementarios" value={value} onChange={event => onChange(event.target.value)} rows={2} placeholder="Estudios solicitados y pendientes para revisar en la próxima consulta" /></label>
    <div className="clinical-study-search" onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false) }}>
      <label>Agregar práctica del nomenclador<input value={query} onChange={event => { setQuery(event.target.value); setOpen(true) }} onFocus={() => setOpen(true)}
        onKeyDown={event => { if (event.key === 'Escape') setOpen(false) }}
        placeholder="Nombre, código, RX, TC, ecografía…" autoComplete="off" /></label>
      {loading ? <small role="status">Cargando nomenclador…</small> : null}
      {error ? <small role="alert">{error} Podés completar el campo manualmente.</small> : null}
      {open && suggestions.length ? <ul className="search-suggestions clinical-suggestions">{suggestions.map(study => <li key={`${study.codeSystem || 'snomed'}-${study.code}`}>
        <button type="button" onMouseDown={event => event.preventDefault()} onClick={() => {
          const line = `• ${formatOrderedStudy(study)}`
          if (!value.split('\n').includes(line)) onChange(`${value.trim()}${value.trim() ? '\n' : ''}${line}`)
          setQuery(''); setOpen(false)
        }}><strong>{study.term}</strong><span>{studyCodeLabel(study)}</span></button>
      </li>)}</ul> : null}
      {open && query.trim().length >= 2 && !suggestions.length && !loading ? <small>No hay coincidencias. Conservá la indicación escrita manualmente.</small> : null}
    </div>
  </div>
}
