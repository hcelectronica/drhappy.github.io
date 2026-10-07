import { useState } from 'react'

export function ClinicalDiagnosisField({ label, name, value, onChange, suggestions }: {
  label: string
  name: string
  value: string
  onChange: (value: string) => void
  suggestions: string[]
}) {
  const [open, setOpen] = useState(false)
  return <div className="clinical-diagnosis-field" onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false) }}>
    <label>{label}
      <input name={name} value={value} onChange={event => { onChange(event.target.value); setOpen(true) }}
        onFocus={() => setOpen(true)}
        onKeyDown={event => { setOpen(event.key !== 'Escape') }}
        autoComplete="off" placeholder="CIE-10 o diagnóstico propio" />
    </label>
    {open && value.trim().length >= 2 && suggestions.length > 0 ? <ul className="search-suggestions clinical-suggestions">
      {suggestions.map(diagnosis => <li key={diagnosis}><button type="button"
        onMouseDown={event => event.preventDefault()}
        onClick={() => { onChange(diagnosis); setOpen(false) }}>{diagnosis}</button></li>)}
    </ul> : null}
  </div>
}
