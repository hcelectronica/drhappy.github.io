import { useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import { callPatientFolder } from './patientFolderService'
import { DIABETES_TYPES, GLUCOSE_CONTEXTS, GLUCOSE_METHODS, parseDiabetesTreatment, parseGlucoseReading } from '../supabase/functions/_shared/patientGlucose'
import type { DiabetesTreatment, GlucoseRecord } from '../supabase/functions/_shared/patientGlucose'
import { formatBpDateTime } from './BloodPressure'
import './patientGlucose.css'

const localTime = () => new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 16)
const emptyTreatment = (): DiabetesTreatment => ({ diabetesType: 'unknown', diagnosedYear: null, usesInsulin: false, insulins: [], medications: [], notes: '' })
export default function PatientGlucoseView({ onToast }: { onToast: (message: string) => void }) {
  const [record, setRecord] = useState<GlucoseRecord | null>(null)
  const [treatment, setTreatment] = useState<DiabetesTreatment>(emptyTreatment)
  const [value, setValue] = useState('')
  const [context, setContext] = useState<keyof typeof GLUCOSE_CONTEXTS>('fasting')
  const [method, setMethod] = useState<keyof typeof GLUCOSE_METHODS>('capillary')
  const [when, setWhen] = useState(localTime)
  const [now, setNow] = useState(true)
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [all, setAll] = useState(false)
  useEffect(() => {
    let cancelled = false
    void callPatientFolder({ action: 'glucose-list' }).then(result => {
      if (cancelled) return
      setLoading(false)
      if (!result.success || !result.glucose) { setError(result.message || 'No se pudo cargar el registro. Volvé a entrar para reintentar.'); return }
      setRecord(result.glucose)
      setTreatment(result.glucose.treatment ?? emptyTreatment())
    })
    return () => { cancelled = true }
  }, [])
  async function saveReading(event: FormEvent) {
    event.preventDefault()
    if (busy) return
    setError('')
    let reading
    try {
      const date = now ? new Date() : new Date(when)
      reading = { value: Number(value), context, method, note, measuredAt: Number.isNaN(date.getTime()) ? '' : date.toISOString() }
      parseGlucoseReading(reading)
    } catch (error) { setError(error instanceof Error ? error.message : 'Revisá la medición.'); return }
    setBusy(true)
    const result = await callPatientFolder({ action: 'glucose-add', ...reading })
    setBusy(false)
    if (!result.success || !result.glucose) { setError(result.message || 'No se pudo guardar la glucosa.'); return }
    setRecord(result.glucose); setValue(''); setNote(''); setNow(true)
    onToast('Medición de glucosa guardada con fecha y hora.')
  }
  async function saveTreatment(event: FormEvent) {
    event.preventDefault()
    if (busy) return
    setError('')
    try { parseDiabetesTreatment(treatment) } catch (error) { setError(error instanceof Error ? error.message : 'Revisá el tratamiento.'); return }
    setBusy(true)
    const result = await callPatientFolder({ action: 'diabetes-save', treatment })
    setBusy(false)
    if (!result.success || !result.glucose) { setError(result.message || 'No se pudo guardar el tratamiento.'); return }
    setRecord(result.glucose)
    onToast('Tratamiento guardado.')
  }
  async function remove(id: string) {
    if (busy || !window.confirm('¿Borrar esta medición de glucosa?')) return
    setBusy(true); setError('')
    const result = await callPatientFolder({ action: 'glucose-delete', readingId: id })
    setBusy(false)
    if (!result.success) { setError(result.message || 'No se pudo borrar la medición.'); return }
    setRecord(current => current ? { ...current, totalReadings: Math.max(0, current.totalReadings - 1), readings: current.readings.filter(row => row.id !== id) } : current)
    onToast('Medición borrada.')
  }
  return <section className="pp-stack glucose-patient">
    <div className="pp-card"><h1>Mi glucosa</h1>
      <p>Registrá tus controles y el tratamiento que te indicó tu médico. No cambies dosis por lo que veas en esta app.</p>
      <p className="pp-muted">No hay vigilancia médica en tiempo real. Si tenés confusión, desmayo, dificultad para respirar o te sentís muy mal, buscá atención de urgencia. Si el equipo marca HI/LO o un valor inesperado, seguí el plan indicado por tu equipo y consultalo.</p>
    </div>
    {error && <p className="pp-error" role="alert">{error}</p>}
    {loading ? <p>Cargando tu registro…</p> : !record ? null : <>
      {record.totalReadings > record.readings.length && <p>Mostrando las últimas {record.readings.length} de {record.totalReadings} mediciones. Las anteriores siguen guardadas.</p>}
      <form className="pp-card pp-form" onSubmit={saveReading}>
        <h2>Anotar glucosa</h2>
        <label>Glucosa en mg/dL<input type="number" inputMode="numeric" min="1" max="1000" step="1" value={value} onChange={e => setValue(e.target.value)} required placeholder="Ej.: 110" /></label>
        <p className="pp-muted">Usá mg/dL, no mmol/L. Si tu equipo usa otra unidad, consultá antes de cargar.</p>
        <label>Momento<select value={context} onChange={e => setContext(e.target.value as typeof context)}>{Object.entries(GLUCOSE_CONTEXTS).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label>
        <label>Método<select value={method} onChange={e => setMethod(e.target.value as typeof method)}>{Object.entries(GLUCOSE_METHODS).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label>
        <label className="pp-check"><input type="checkbox" checked={now} onChange={e => { setNow(e.target.checked); setWhen(localTime()) }} /> Usar fecha y hora de ahora</label>
        {!now && <label>Fecha y hora de la medición<input type="datetime-local" value={when} max={localTime()} onChange={e => setWhen(e.target.value)} required /></label>}
        <label>Notas o síntomas (opcional)<textarea value={note} onChange={e => setNote(e.target.value)} maxLength={300} placeholder="Ej.: 2 horas después del almuerzo" /></label>
        <button className="pp-primary" disabled={busy}>Guardar medición</button>
      </form>
      <form className="pp-card pp-form" onSubmit={saveTreatment}>
        <h2>Mi diabetes y tratamiento</h2>
        <label>Tipo de diabetes<select value={treatment.diabetesType} onChange={e => setTreatment({ ...treatment, diabetesType: e.target.value as DiabetesTreatment['diabetesType'] })}>{Object.entries(DIABETES_TYPES).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label>
        <label>Año del diagnóstico (opcional)<input type="number" min="1900" max={new Date().getFullYear()} value={treatment.diagnosedYear ?? ''} onChange={e => setTreatment({ ...treatment, diagnosedYear: e.target.value ? Number(e.target.value) : null })} /></label>
        <label className="pp-check"><input type="checkbox" checked={treatment.usesInsulin} onChange={e => {
          if (!e.target.checked && treatment.insulins.length && !window.confirm('¿Quitar las pautas de insulina de este formulario? Se aplicará al guardar.')) return
          setTreatment({ ...treatment, usesInsulin: e.target.checked, insulins: e.target.checked ? treatment.insulins : [] })
        }} /> Uso insulina</label>
        {treatment.usesInsulin && <>
          <p>Agregá una pauta por insulina y horario. Podés repetir la misma insulina si usás distintas dosis a lo largo del día.</p>
          {treatment.insulins.map((item, index) => <fieldset key={index}><legend>Insulina {index + 1}</legend>
            <label>Nombre<input value={item.name} maxLength={100} required onChange={e => setTreatment({ ...treatment, insulins: treatment.insulins.map((r, i) => i === index ? { ...r, name: e.target.value } : r) })} /></label>
            <label>Unidades por aplicación<input type="number" min=".1" max="1000" step=".1" value={item.units || ''} required onChange={e => setTreatment({ ...treatment, insulins: treatment.insulins.map((r, i) => i === index ? { ...r, units: Number(e.target.value) } : r) })} /></label>
            <label>Horario o pauta indicada<input value={item.schedule} maxLength={120} required placeholder="Ej.: antes del desayuno" onChange={e => setTreatment({ ...treatment, insulins: treatment.insulins.map((r, i) => i === index ? { ...r, schedule: e.target.value } : r) })} /></label>
            <button type="button" className="pp-link-btn" onClick={() => setTreatment({ ...treatment, insulins: treatment.insulins.filter((_, i) => i !== index) })}>Quitar insulina {index + 1}</button>
          </fieldset>)}
          <button type="button" className="pp-secondary" disabled={treatment.insulins.length >= 10} onClick={() => setTreatment({ ...treatment, insulins: [...treatment.insulins, { name: '', units: 0, schedule: '' }] })}>Agregar insulina / horario</button>
        </>}
        <h3>Otros medicamentos para la diabetes</h3>
        <p>También podés anotarlos si usás insulina. Cargá nombre, dosis y frecuencia tal como fueron indicados.</p>
        {treatment.medications.map((item, index) => <fieldset key={index}><legend>Medicamento {index + 1}</legend>
          {(['name', 'dose', 'schedule'] as const).map((field, i) => <label key={field}>{['Nombre', 'Dosis (incluí la unidad)', 'Horario / frecuencia'][i]}<input value={item[field]} maxLength={field === 'schedule' ? 120 : 100} required onChange={e => setTreatment({ ...treatment, medications: treatment.medications.map((r, j) => j === index ? { ...r, [field]: e.target.value } : r) })} /></label>)}
          <button type="button" className="pp-link-btn" onClick={() => setTreatment({ ...treatment, medications: treatment.medications.filter((_, i) => i !== index) })}>Quitar medicamento {index + 1}</button>
        </fieldset>)}
        <button type="button" className="pp-secondary" disabled={treatment.medications.length >= 20} onClick={() => setTreatment({ ...treatment, medications: [...treatment.medications, { name: '', dose: '', schedule: '' }] })}>Agregar medicamento</button>
        <label>Observaciones del tratamiento<textarea value={treatment.notes} maxLength={500} onChange={e => setTreatment({ ...treatment, notes: e.target.value })} /></label>
        <button className="pp-primary" disabled={busy}>Guardar tratamiento</button>
      </form>
      <section className="pp-card"><h2>Mis mediciones</h2>
        {!record.readings.length && <p>Todavía no registraste mediciones.</p>}
        <ul className="glucose-reading-list">{(all ? record.readings : record.readings.slice(0, 10)).map(row => <li key={row.id}>
          <div><strong>{row.value} mg/dL</strong><span>{formatBpDateTime(row.measuredAt)}</span><span>{GLUCOSE_CONTEXTS[row.context]} · {GLUCOSE_METHODS[row.method]}</span>{row.note && <span>{row.note}</span>}</div>
          <button type="button" className="pp-link-btn" disabled={busy} onClick={() => void remove(row.id)} aria-label={`Borrar glucosa del ${formatBpDateTime(row.measuredAt)}`}>Borrar</button>
        </li>)}</ul>
        {record.readings.length > 10 && <button type="button" className="pp-link-btn" onClick={() => setAll(v => !v)}>{all ? 'Ver menos' : 'Ver todas'}</button>}
        <p className="pp-muted">Tu médico verá las mediciones y el tratamiento solo si activás «Incluir glucosa y tratamiento» en Compartir con mi médico. Los permisos anteriores no se amplían solos.</p>
      </section>
    </>}
  </section>
}
