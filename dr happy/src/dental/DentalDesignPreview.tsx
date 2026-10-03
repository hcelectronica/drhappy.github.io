import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import { DentalTooth } from './DentalTooth'
import {
  CONDITIONS, PERMANENT_ROWS, TEMPORARY_ROWS, SURFACES, addDentalPayment, changeTreatmentStatus,
  createDentalDesignRecord, dentalAccount, isDentalDesignRecord, markColor, moneyToCents, surfaceLabel, treatmentAccount, validTooth,
} from './dentalModel'
import type { DentalCondition, DentalDesignRecord, DentalPayment, DentalSurface } from './dentalModel'
import { dentalDate as dateLabel, dentalMoney as money, dentalStatusLabels as statusLabels, dentalLedgerRows } from './dentalPresentation'
import { printDentalRecord } from './DentalPrint'
import './dentalDesign.css'

const STORAGE_KEY = 'drhappy-dental-design-preview-v1'
const today = () => new Date().toLocaleDateString('en-CA', { timeZone: 'America/Argentina/Buenos_Aires' })
const newWork = () => ({ date: today(), tooth: '36', surface: 'central' as DentalSurface, work: '', budget: '', cost: '' })

function loadDesign(): { record: DentalDesignRecord; error: string | null } {
  try {
    const stored = localStorage.getItem(STORAGE_KEY)
    if (!stored) return { record: createDentalDesignRecord(), error: null }
    const parsed: unknown = JSON.parse(stored)
    if (!isDentalDesignRecord(parsed)) throw new Error('El borrador guardado no corresponde al formato de esta ficha.')
    return { record: parsed, error: null }
  } catch (error) {
    return { record: createDentalDesignRecord(), error: `No se pudo recuperar el borrador: ${error instanceof Error ? error.message : 'error de almacenamiento'}. No se sobrescribió el archivo guardado.` }
  }
}

export default function DentalDesignPreview({ initialRecord, realPatientId, onSave, onBack, onDirtyChange, onSavingChange, onReload, revisions, professional }: {
  professional?: { fullName: string; licenseNumber: string }
  initialRecord?: DentalDesignRecord
  realPatientId?: string
  onSave?: (record: DentalDesignRecord, confirm: boolean) => Promise<DentalDesignRecord>
  onBack?: () => void
  onDirtyChange?: (dirty: boolean) => void
  onSavingChange?: (saving: boolean) => void
  onReload?: () => Promise<void>
  revisions?: Array<{ revision: number; createdAt: string; confirmed: boolean }>
} = {}) {
  const real = Boolean(realPatientId)
  const [initial] = useState(() => initialRecord ? { record: initialRecord, error: null } : loadDesign())
  const [record, setRecord] = useState(initial.record)
  const [identitySaved, setIdentitySaved] = useState(Boolean(initial.record.patient.dni))
  const [error, setError] = useState<string | null>(initial.error)
  const [notice, setNotice] = useState(real ? 'Ficha odontológica privada. Guardá los cambios para sincronizar la ficha y el balance.' : 'Esta vista usa datos ficticios. No modifica pacientes ni el balance real.')
  const [saving, setSaving] = useState(false)
  const savingRef = useRef(false)
  const [dirty, setDirty] = useState(false)
  const [history, setHistory] = useState<DentalDesignRecord[]>([])
  const [back, setBack] = useState(() => new URLSearchParams(window.location.search).get('face') === 'back')
  const [dentition, setDentition] = useState<'mixed' | 'permanent' | 'temporary'>('mixed')
  const [tooth, setTooth] = useState(36)
  const [surface, setSurface] = useState<DentalSurface>('whole')
  const [condition, setCondition] = useState<DentalCondition>('caries')
  const [markStatus, setMarkStatus] = useState<'existing' | 'needed'>('needed')
  const [markNote, setMarkNote] = useState('')
  const [workDraft, setWorkDraft] = useState(newWork)
  const [paymentDraft, setPaymentDraft] = useState({ treatmentId: '', amount: '', date: today(), method: 'Efectivo' as DentalPayment['method'] })
  const flipButton = useRef<HTMLButtonElement>(null)
  const mobileFlipButton = useRef<HTMLButtonElement>(null)
  const [zoom, setZoom] = useState<{ x: number; y: number; piece?: number } | null>(null)
  const zoomDialog = useRef<HTMLDialogElement>(null)
  const zoomScroll = useRef<HTMLDivElement>(null)
  const chartRef = useRef<HTMLDivElement>(null)
  const formRef = useRef<HTMLFormElement>(null)
  useLayoutEffect(() => {
    if (!zoom) return
    zoomDialog.current?.showModal()
    const area = zoomScroll.current
    if (area) {
      area.scrollLeft = zoom.x * area.scrollWidth - area.clientWidth / 2
      area.scrollTop = zoom.y * area.scrollHeight - area.clientHeight / 2
      const piece = zoom.piece ? area.querySelector(`[data-tooth="${zoom.piece}"]`) : null
      if (piece) {
        const bounds = piece.getBoundingClientRect()
        const viewport = area.getBoundingClientRect()
        area.scrollLeft += bounds.left - viewport.left + bounds.width / 2 - area.clientWidth / 2
        area.scrollTop += bounds.top - viewport.top + bounds.height / 2 - area.clientHeight / 2
      }
    }
  }, [zoom])
  useEffect(() => {
    const desktop = window.matchMedia('(min-width: 601px)')
    const close = () => { if (desktop.matches) { zoomDialog.current?.close(); setZoom(null) } }
    desktop.addEventListener('change', close)
    return () => desktop.removeEventListener('change', close)
  }, [])
  useEffect(() => { onDirtyChange?.(dirty) }, [dirty, onDirtyChange])
  useEffect(() => {
    if (!dirty && !saving) return
    const warn = (event: BeforeUnloadEvent) => event.preventDefault()
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [dirty, saving])
  const account = dentalAccount(record)
  const marks = record.marks.filter((mark) => mark.tooth === tooth)
  const payableTreatments = record.treatments.filter((treatment) => treatmentAccount(record, treatment).balance > 0)
  const ledgerRows = dentalLedgerRows(record)

  function update(next: DentalDesignRecord) {
    setHistory((items) => [...items.slice(-39), record])
    setRecord(next)
    setDirty(true)
    setError(null)
    setNotice('Cambios en el borrador. Guardalos antes de salir.')
  }
  async function save(next = record, confirm = false) {
    if (savingRef.current) return
    savingRef.current = true
    setSaving(true)
    onSavingChange?.(true)
    try {
      const saved = onSave ? await onSave(next, confirm) : next
      if (!real) localStorage.setItem(STORAGE_KEY, JSON.stringify(saved))
      setRecord(saved)
      if (real) setIdentitySaved(Boolean(saved.patient.dni))
      setDirty(false)
      setHistory([])
      setError(null)
      setNotice(real ? (confirm ? 'Atención guardada. Ficha y balance sincronizados.' : 'Ficha y balance guardados en la nube.') : 'Borrador de diseño guardado en este navegador. No se enviaron datos a la nube.')
    } catch (error) {
      setError(`No se pudo guardar: ${error instanceof Error ? error.message : 'almacenamiento no disponible'}. Los cambios siguen en pantalla.`)
    } finally { savingRef.current = false; setSaving(false); onSavingChange?.(false) }
  }
  function selectTooth(number: number, face: DentalSurface) {
    setTooth(number)
    setSurface(face)
    setWorkDraft((draft) => ({ ...draft, tooth: String(number), surface: face }))
  }
  function addMark(event: FormEvent) {
    event.preventDefault()
    const face = ['caries', 'restoration'].includes(condition) ? surface : 'whole'
    const status = condition === 'missing' ? 'needed' : condition === 'unerupted' ? 'existing' : markStatus
    if (record.marks.some((mark) => mark.tooth === tooth && mark.surface === face && mark.condition === condition && mark.status === status && mark.note === markNote.trim())) {
      setError('Ese registro ya existe en esta pieza y superficie. No se agregó una copia.')
      return
    }
    update({ ...record, marks: [...record.marks, { id: crypto.randomUUID(), tooth, surface: face, condition, status, note: markNote.trim(), createdAt: new Date().toISOString() }] })
    setMarkNote('')
  }
  function addWork(event: FormEvent) {
    event.preventDefault()
    try {
      const budgetCents = moneyToCents(workDraft.budget)
      const internalCostCents = moneyToCents(workDraft.cost || '0')
      if (!workDraft.work.trim() || !workDraft.date || budgetCents <= 0) throw new Error('Indicá fecha, trabajo a realizar y presupuesto mayor a cero.')
      update({ ...record, treatments: [...record.treatments, {
        id: crypto.randomUUID(), date: workDraft.date, tooth: Number(workDraft.tooth), surface: workDraft.surface,
        work: workDraft.work.trim(), budgetCents, internalCostCents, status: 'proposed',
      }] })
      setWorkDraft((draft) => ({ ...newWork(), tooth: draft.tooth, surface: draft.surface }))
    } catch (error) { setError(error instanceof Error ? error.message : 'No se pudo agregar el trabajo.') }
  }
  function addPayment(event: FormEvent) {
    event.preventDefault()
    try {
      update(addDentalPayment(record, {
        id: crypto.randomUUID(), treatmentId: paymentDraft.treatmentId, date: paymentDraft.date,
        amountCents: moneyToCents(paymentDraft.amount), method: paymentDraft.method,
      }))
      setPaymentDraft((draft) => ({ ...draft, amount: '' }))
    } catch (error) { setError(error instanceof Error ? error.message : 'No se pudo registrar el pago.') }
  }
  function statusChange(id: string, status: 'accepted' | 'completed' | 'cancelled') {
    try { update(changeTreatmentStatus(record, id, status, today())) }
    catch (error) { setError(error instanceof Error ? error.message : 'No se pudo cambiar el estado.') }
  }
  function flip() {
    setBack((value) => !value)
    const button = window.matchMedia('(max-width: 600px)').matches ? mobileFlipButton : flipButton
    button.current?.focus()
  }
  function proposeSelected() {
    setWorkDraft((draft) => ({ ...draft, tooth: String(tooth), surface,
      work: marks.length ? CONDITIONS.find((item) => item.id === marks[marks.length - 1].condition)?.label || '' : '',
    }))
    setBack(true)
    requestAnimationFrame(() => formRef.current?.querySelector<HTMLInputElement>('input[name="work"]')?.focus())
  }
  const rows = [...(dentition !== 'temporary' ? [{ name: 'Dentición permanente', rows: PERMANENT_ROWS }] : []),
    ...(dentition !== 'permanent' ? [{ name: 'Dentición temporal', rows: TEMPORARY_ROWS }] : [])]
  function closeZoom() {
    zoomDialog.current?.close()
    setZoom(null)
    chartRef.current?.focus()
  }
  function openZoom(x: number, y: number, target: EventTarget | null) {
    const bounds = chartRef.current?.getBoundingClientRect()
    const piece = target instanceof Element ? Number(target.closest('[data-tooth]')?.getAttribute('data-tooth')) : 0
    if (bounds) setZoom({ x: Math.max(0, Math.min(1, (x - bounds.left) / bounds.width)), y: Math.max(0, Math.min(1, (y - bounds.top) / bounds.height)), piece: validTooth(piece) ? piece : undefined })
  }
  function renderChart(enlarged = false) {
    return <div className="dental-chart-canvas">
      {rows.map((group) => <div className={`dental-dentition ${group.name.includes('temporal') ? 'dental-dentition--temporary' : ''}`} key={group.name}>
        <h3>{group.name}</h3>
        {group.rows.map((row, rowIndex) => <div className="dental-tooth-row" key={rowIndex}>
          {row.map((number) => <DentalTooth key={number} tooth={number} marks={record.marks.filter((mark) => mark.tooth === number)}
            selected={tooth === number} surface={surface} onSelect={(face) => {
              selectTooth(number, face)
              if (enlarged) closeZoom()
            }} />)}
        </div>)}
        <div className="dental-quadrant-labels"><span>Derecha</span><span>Izquierda</span></div>
      </div>)}
    </div>
  }
  function print() {
    if (dirty) { setError('Guardá los cambios antes de imprimir para que el PDF coincida con la ficha y el balance guardados.'); return }
    try {
      printDentalRecord(record, professional, !real)
      setError(null)
      setNotice('Ficha en color preparada con ambas caras. Elegí Guardar como PDF o tu impresora en la vista de impresión.')
    } catch (error) { setError(error instanceof Error ? error.message : 'No se pudo preparar la impresión de la ficha.') }
  }

  return (
    <main className="dental-preview">
      {!real ? <div className="dental-demo-banner"><span>VISTA DE DISEÑO</span> Datos ficticios · Guardado solo en este navegador · Sin conexión a fichas reales</div> : null}
      <header className="dental-page-header">
        <div><span className="dental-eyebrow">DR HAPPY · ODONTOLOGÍA</span><h1>Ficha dental</h1><p>El formato de siempre, con cada pieza y cada trabajo en su lugar.</p></div>
        {real ? <button type="button" disabled={saving} onClick={onBack}>Volver a pacientes</button> : <a href="/">Volver a la app</a>}
      </header>
      <div className="dental-toolbar">
        <div className="dental-mobile-tools">
          <button ref={mobileFlipButton} type="button" onClick={flip} className="dental-flip-button" disabled={saving}><span aria-hidden="true">↻</span> Girar ficha</button>
          <button type="button" onClick={print} disabled={saving}>Imprimir / PDF</button>
        </div>
        <div className="dental-face-tabs" aria-label="Cara de la ficha">
          <button type="button" aria-pressed={!back} onClick={() => setBack(false)}>01 · Odontograma</button>
          <button type="button" aria-pressed={back} onClick={() => setBack(true)}>02 · Tratamientos y cuenta</button>
        </div>
        <div className="dental-toolbar-actions">
          <button type="button" className="dental-desktop-print" onClick={print} disabled={saving}>Imprimir / PDF</button>
          <button type="button" disabled={!history.length || saving} onClick={() => {
            const previous = history[history.length - 1]
            if (previous) { setRecord(previous); setHistory((items) => items.slice(0, -1)); setDirty(true); setError(null); setNotice('Último cambio deshecho. Guardá el borrador para conservarlo.') }
          }}>Deshacer</button>
          <button type="button" className="dental-primary" disabled={saving} onClick={() => void save()}>{saving ? 'Guardando...' : real ? (dirty ? 'Guardar cambios *' : 'Guardar cambios') : (dirty ? 'Guardar borrador *' : 'Guardar borrador')}</button>
        </div>
      </div>
      {error ? <div className="dental-error" role="alert"><p>{error}</p>{real && onReload ? <button type="button" disabled={saving} onClick={async () => {
        if (dirty && !window.confirm('¿Descartar los cambios en pantalla y cargar la última ficha guardada?')) return
        savingRef.current = true
        setSaving(true)
        onSavingChange?.(true)
        try { await onReload() }
        catch (error) { setError(`No se pudo recargar: ${error instanceof Error ? error.message : 'error de conexión'}. Los cambios siguen en pantalla.`) }
        finally { savingRef.current = false; setSaving(false); onSavingChange?.(false) }
      }}>Cargar última ficha guardada</button> : null}</div> : null}
      <p className="dental-notice" role="status">{notice}</p>
      <fieldset className="dental-save-lock" disabled={saving}><div className={`dental-flip ${back ? 'dental-flip--back' : ''}`}>
        <div className="dental-flip-inner">
          <section className="dental-sheet dental-sheet--front" inert={back} aria-hidden={back} aria-label="Anverso de la ficha dental">
            <div className="dental-sheet-heading"><div><span className="dental-eyebrow">ANVERSO · REGISTRO ODONTOLÓGICO</span><h2>Odontograma</h2></div><span className={`dental-record-status ${record.status === 'confirmed' ? 'dental-record-status--confirmed' : ''}`}>{record.status === 'provisional' ? 'Ficha provisoria' : real ? 'Ficha confirmada' : 'Atención registrada · demo'}</span></div>
            <div className="dental-patient-grid">
              {([
                ['name', 'Apellido y nombres'], ['dni', 'DNI'], ['phone', 'Teléfono'],
                ['address', 'Domicilio'], ['locality', 'Localidad'], ['coverage', 'Obra social / afiliación'],
              ] as const).map(([key, label]) => <label key={key}>{label}<input readOnly={real && key === 'dni' && identitySaved} placeholder={key === 'name' ? 'Apellido, Nombre' : undefined} value={record.patient[key]} onChange={(event) => update({ ...record, patient: { ...record.patient, [key]: event.target.value } })} /></label>)}
              {real ? <><label>Email<input type="email" value={record.patient.email || ''} onChange={(event) => update({ ...record, patient: { ...record.patient, email: event.target.value } })} /></label><label>Fecha de nacimiento<input type="date" value={record.patient.birthDate || ''} onChange={(event) => update({ ...record, patient: { ...record.patient, birthDate: event.target.value } })} /></label><label>Número de afiliado<input value={record.patient.memberNumber || ''} onChange={(event) => update({ ...record, patient: { ...record.patient, memberNumber: event.target.value } })} /></label></> : null}
            </div>
            <div className="dental-front-layout">
              <div className="dental-chart-section">
                <div className="dental-chart-toolbar">
                  <span>Derecha e izquierda del paciente</span>
                  <label>Dentición<select value={dentition} onChange={(event) => {
                    const value = event.target.value
                    if (value === 'mixed' || value === 'permanent' || value === 'temporary') setDentition(value)
                  }}><option value="mixed">Mixta / ambas</option><option value="permanent">Permanente</option><option value="temporary">Temporal</option></select></label>
                </div>
                <p className="dental-mobile-hint">Tocá el odontograma para ampliar esa zona y elegir la pieza.</p>
                <div ref={chartRef} className="dental-chart-scroll" tabIndex={0} role="region" aria-label="Odontograma completo"
                  onClickCapture={(event) => {
                    if (!window.matchMedia('(max-width: 600px)').matches) return
                    event.preventDefault(); event.stopPropagation()
                    openZoom(event.clientX, event.clientY, event.target)
                  }}
                  onKeyDownCapture={(event) => {
                    if (!window.matchMedia('(max-width: 600px)').matches || !['Enter', ' '].includes(event.key)) return
                    event.preventDefault(); event.stopPropagation()
                    const bounds = event.target instanceof Element ? event.target.getBoundingClientRect() : null
                    if (bounds) openZoom(bounds.left + bounds.width / 2, bounds.top + bounds.height / 2, event.target)
                  }}>{renderChart()}</div>
                <p className="dental-unassessed">Una pieza sin marcas está sin registrar: no equivale a una pieza sana.</p>
                <div className="dental-observations"><label>Observaciones de la atención<textarea rows={3} value={record.observations} onChange={(event) => update({ ...record, observations: event.target.value })} placeholder="Nota breve, sin formulario clínico extenso." /></label></div>
              </div>
              <aside className="dental-reference">
                <h3>Referencias</h3>
                <p><span className="dental-color-dot dental-color-dot--red" /> Rojo · prestaciones necesarias</p>
                <p><span className="dental-color-dot dental-color-dot--blue" /> Azul · prestaciones existentes</p>
                <ul><li><b className="dental-blue">×</b> Pieza no erupcionada</li><li><b className="dental-blue">=</b> Extracción existente</li><li><b className="dental-red">×</b> Pieza ausente</li><li><b>⊓</b> Prótesis fija</li><li><b>□</b> Prótesis removible</li><li><b>○</b> Corona</li></ul>
                <p className="dental-reference-note">Caries y restauraciones se registran por cara. Los símbolos corresponden a la pieza completa.</p>
                <label>Reservado obra social<textarea rows={4} value={record.coverageNotes} onChange={(event) => update({ ...record, coverageNotes: event.target.value })} placeholder="Observaciones de cobertura." /></label>
              </aside>
            </div>
            <section className="dental-selection" aria-label="Registro de pieza seleccionada">
              <div className="dental-selection-tooth"><DentalTooth expanded tooth={tooth} marks={marks} selected surface={surface} onSelect={(face) => setSurface(face)} /><strong>Pieza {tooth}</strong><span>{surfaceLabel(surface, tooth)}</span></div>
              <form onSubmit={addMark} className="dental-mark-form">
                <div className="dental-selection-heading"><h3>Registrar en esta pieza</h3><span>{marks.length} registro{marks.length !== 1 ? 's' : ''}</span></div>
                <div className="dental-form-grid">
                  <label>Cara<select value={surface} onChange={(event) => { const value = SURFACES.find((item) => item === event.target.value); if (value) setSurface(value) }}>{SURFACES.map((face) => <option key={face} value={face}>{surfaceLabel(face, tooth)}</option>)}</select></label>
                  <label>Hallazgo / prestación<select value={condition} onChange={(event) => { const value = CONDITIONS.find((item) => item.id === event.target.value); if (value) setCondition(value.id) }}>{CONDITIONS.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}</select></label>
                  <label>Referencia<select value={markStatus} onChange={(event) => { if (event.target.value === 'existing' || event.target.value === 'needed') setMarkStatus(event.target.value) }}><option value="needed">Rojo · necesaria</option><option value="existing">Azul · existente</option></select></label>
                  <label>Observación opcional<input value={markNote} onChange={(event) => setMarkNote(event.target.value)} placeholder="Detalle de esta marca" /></label>
                </div>
                <p className="dental-field-note">{condition === 'missing' ? 'Pieza ausente: X roja en toda la pieza.' : condition === 'unerupted' ? 'Pieza no erupcionada: X azul en toda la pieza.' : !['caries', 'restoration'].includes(condition) ? 'Esta prestación se marca en la pieza completa.' : 'Se conserva cada registro, incluso si una cara tiene varias marcas.'}</p>
                <div className="dental-inline-actions"><button type="submit" className="dental-primary">Agregar marca</button><button type="button" onClick={proposeSelected}>Preparar trabajo en reverso →</button></div>
              </form>
            </section>
            {marks.length ? <ul className="dental-mark-history">{marks.map((mark) => <li key={mark.id}><span className={`dental-color-dot dental-color-dot--${markColor(mark)}`} /><div><strong>{CONDITIONS.find((item) => item.id === mark.condition)?.label} · {surfaceLabel(mark.surface, tooth)}</strong><span>{markColor(mark) === 'red' ? 'Rojo' : 'Azul'} · {new Date(mark.createdAt).toLocaleString('es-AR', { timeZone: 'America/Argentina/Buenos_Aires' })}{mark.note ? ` · ${mark.note}` : ''}</span></div><button type="button" aria-label={`Quitar registro ${CONDITIONS.find((item) => item.id === mark.condition)?.label} de pieza ${tooth}`} onClick={() => update({ ...record, marks: record.marks.filter((item) => item.id !== mark.id) })}>Quitar</button></li>)}</ul> : null}
            <section className="dental-consent"><h3>Consentimiento informado</h3><p>Registro de observaciones y referencia al consentimiento. Completar este espacio no reemplaza la firma del paciente.</p><label>Observación / referencia al documento<textarea rows={2} value={record.consentNotes} onChange={(event) => update({ ...record, consentNotes: event.target.value })} placeholder="Documento firmado, fecha y observaciones pertinentes." /></label><div className="dental-signature-lines"><span>Firma y sello del profesional</span><span>Firma y aclaración del paciente</span></div></section>
          </section>
          <section className="dental-sheet dental-sheet--back" inert={!back} aria-hidden={!back} aria-label="Reverso de la ficha dental">
            <div className="dental-sheet-heading"><div><span className="dental-eyebrow">REVERSO · TRABAJOS Y CUENTA</span><h2>Tratamientos y pagos</h2></div><span className="dental-patient-chip">{record.patient.name || 'Paciente sin nombre'}</span></div>
            <section className="dental-budget-section">
              <div className="dental-section-heading"><h3>Trabajo a realizar</h3><p>Presupuesto al paciente · Costo interno del odontólogo</p></div>
              <div className="dental-table-scroll"><table className="dental-table"><caption>Plan de trabajos y presupuesto</caption><thead><tr><th>Fecha</th><th>Trabajo a realizar</th><th>Presupuesto</th><th>Costo interno</th><th>Estado</th><th>Acciones</th></tr></thead><tbody>
                {record.treatments.map((item) => <tr key={item.id}><td data-label="Fecha">{dateLabel(item.date)}</td><td className="dental-cell-description"><strong>{item.work}</strong><small>Pieza {item.tooth} · {surfaceLabel(item.surface, item.tooth)}</small></td><td data-label="Presupuesto">{money(item.budgetCents)}</td><td data-label="Costo interno">{money(item.internalCostCents)}</td><td data-label="Estado"><span className={`dental-work-status dental-work-status--${item.status}`}>{statusLabels[item.status]}</span>{item.performedDate ? <small>{dateLabel(item.performedDate)}</small> : null}</td><td className="dental-cell-actions"><div className="dental-row-actions">
                  {item.status === 'proposed' ? <button type="button" onClick={() => statusChange(item.id, 'accepted')}>Aceptar</button> : null}
                  {item.status === 'accepted' ? <button type="button" onClick={() => statusChange(item.id, 'completed')}>Registrar realizado</button> : null}
                  {['proposed', 'accepted'].includes(item.status) ? <button type="button" onClick={() => statusChange(item.id, 'cancelled')}>Anular</button> : null}
                </div></td></tr>)}
                {!record.treatments.length ? <tr><td colSpan={6} className="dental-empty">Todavía no hay trabajos propuestos. Agregá el primero abajo.</td></tr> : null}
              </tbody></table></div>
              <form ref={formRef} onSubmit={addWork} className="dental-work-form">
                <div className="dental-work-fields">
                  <label>Fecha<input required type="date" value={workDraft.date} onChange={(event) => setWorkDraft({ ...workDraft, date: event.target.value })} /></label>
                  <label>Pieza<select value={workDraft.tooth} onChange={(event) => setWorkDraft({ ...workDraft, tooth: event.target.value })}>{[...PERMANENT_ROWS.flat(), ...TEMPORARY_ROWS.flat()].map((number) => <option key={number} value={number}>{number}</option>)}</select></label>
                  <label>Cara<select value={workDraft.surface} onChange={(event) => { const value = SURFACES.find((item) => item === event.target.value); if (value) setWorkDraft({ ...workDraft, surface: value }) }}>{SURFACES.map((face) => <option key={face} value={face}>{surfaceLabel(face, Number(workDraft.tooth))}</option>)}</select></label>
                  <label className="dental-work-description">Trabajo a realizar<input name="work" required value={workDraft.work} onChange={(event) => setWorkDraft({ ...workDraft, work: event.target.value })} placeholder="Ej.: restauración oclusal" /></label>
                  <label>Presupuesto ($)<input required inputMode="decimal" value={workDraft.budget} onChange={(event) => setWorkDraft({ ...workDraft, budget: event.target.value })} placeholder="Sin puntos de miles" /></label>
                  <label>Costo interno ($)<input inputMode="decimal" value={workDraft.cost} onChange={(event) => setWorkDraft({ ...workDraft, cost: event.target.value })} placeholder="Opcional" /></label>
                </div><button type="submit" className="dental-primary">Agregar al presupuesto</button>
              </form>
              <p className="dental-field-note">Proponer un trabajo no genera deuda. Al aceptar el presupuesto, su importe pasa al debe; el costo interno nunca se cobra al paciente. {real ? 'Mercado Pago identifica un pago cargado manualmente; este formulario no procesa ni confirma cobros del proveedor.' : 'En esta demostración, Mercado Pago es solo una etiqueta: no procesa cobros.'}</p>
            </section>
            <section className="dental-account-section">
              <div className="dental-section-heading"><h3>Trabajo realizado y cuenta del paciente</h3><p>Los importes salen de los trabajos aceptados y sus pagos, no se vuelven a cargar.</p></div>
              <div className="dental-account-totals"><div><span>Debe · presupuestos aceptados</span><strong>{money(account.charged)}</strong></div><div><span>Haber · pagos registrados</span><strong>{money(account.paid)}</strong></div><div className="dental-balance"><span>Saldo del paciente</span><strong>{money(account.balance)}</strong></div></div>
              <div className="dental-table-scroll"><table className="dental-table dental-ledger-table"><caption>Movimientos de la cuenta del paciente</caption><thead><tr><th>Fecha</th><th>Pieza</th><th>Cara</th><th>Trabajo / movimiento</th><th>Debe</th><th>Haber</th><th>Saldo</th></tr></thead><tbody>
                {ledgerRows.map((movement) => <tr key={movement.id}><td data-label="Fecha">{dateLabel(movement.date)}</td><td data-label="Pieza">{movement.tooth}</td><td data-label="Cara">{movement.face}</td><td className="dental-cell-description"><strong>{movement.label}</strong><small>{movement.detail}</small></td><td data-label="Debe">{movement.debit ? money(movement.debit) : '—'}</td><td data-label="Haber">{movement.credit ? money(movement.credit) : '—'}</td><td data-label="Saldo">{money(movement.balance)}</td></tr>)}
                {!ledgerRows.length ? <tr><td colSpan={7} className="dental-empty">Sin movimientos. Los presupuestos propuestos no consumen saldo.</td></tr> : null}
              </tbody></table></div>
              <form onSubmit={addPayment} className="dental-payment-form">
                <label>Tratamiento a pagar<select required value={paymentDraft.treatmentId} onChange={(event) => setPaymentDraft({ ...paymentDraft, treatmentId: event.target.value })}><option value="">Elegí un trabajo con saldo</option>{payableTreatments.map((item) => <option key={item.id} value={item.id}>{item.work} · pieza {item.tooth} · {money(treatmentAccount(record, item).balance)}</option>)}</select></label>
                <label>Fecha<input required type="date" value={paymentDraft.date} onChange={(event) => setPaymentDraft({ ...paymentDraft, date: event.target.value })} /></label>
                <label>Importe ($)<input required inputMode="decimal" value={paymentDraft.amount} onChange={(event) => setPaymentDraft({ ...paymentDraft, amount: event.target.value })} /></label>
                <label>Medio<select value={paymentDraft.method} onChange={(event) => { const method = event.target.value; if (method === 'Efectivo' || method === 'Transferencia' || method === 'Mercado Pago') setPaymentDraft({ ...paymentDraft, method }) }}><option>Efectivo</option><option>Transferencia</option><option>Mercado Pago</option></select></label>
                <button type="submit" className="dental-primary" disabled={!payableTreatments.length}>{real ? 'Agregar pago a la ficha' : 'Registrar pago de prueba'}</button>
              </form>
              <p className="dental-internal-cost">Costo interno de trabajos aceptados: <strong>{money(account.internalCost)}</strong> · Separado de la cuenta del paciente.</p>
            </section>
          </section>
        </div>
      </div></fieldset>
      {zoom ? <dialog ref={zoomDialog} className="dental-zoom-dialog" aria-labelledby="dental-zoom-title" onCancel={closeZoom} onClose={() => setZoom(null)}>
        <div className="dental-zoom-heading"><div><h3 id="dental-zoom-title">Elegí la pieza</h3><p>Zona ampliada · derecha e izquierda del paciente</p></div><button type="button" onClick={closeZoom}>Cerrar</button></div>
        <div ref={zoomScroll} className="dental-zoom-scroll" tabIndex={0} role="region" aria-label="Odontograma ampliado, desplazable">{renderChart(true)}</div>
        <p>Deslizá para ver las piezas cercanas. Al elegir una volvés a «Registrar en esta pieza».</p>
      </dialog> : null}
      <footer className="dental-footer">
        <button ref={flipButton} type="button" onClick={flip} className="dental-flip-button"><span aria-hidden="true">↻</span> {back ? 'Girar al odontograma' : 'Girar a tratamientos y pagos'}</button>
        <button type="button" className="dental-primary" disabled={saving} onClick={() => {
          if (!record.marks.length && !record.observations.trim() && !record.treatments.some((item) => item.status === 'completed')) { setError('Registrá un hallazgo, una observación o un trabajo realizado antes de guardar la atención.'); return }
          void save({ ...record, status: 'confirmed' }, true)
        }}>{saving ? 'Guardando...' : real ? 'Guardar atención' : 'Guardar atención de prueba'}</button>
      </footer>
      {real ? <section className="dental-audit"><h3>Registro de guardado</h3><p>Cada guardado conserva una revisión. Las correcciones no eliminan las versiones anteriores.</p>{revisions?.length ? <ul>{revisions.map((entry) => <li key={entry.revision}>Revisión {entry.revision} · {new Date(entry.createdAt).toLocaleString('es-AR', { timeZone: 'America/Argentina/Buenos_Aires' })} · {entry.confirmed ? 'Atención' : 'Ficha / cuenta'}</li>)}</ul> : <p>Sin revisiones guardadas todavía.</p>}</section> : <div className="dental-preview-bottom"><span>Diseño basado en las dos caras de la ficha de referencia. La integración con pacientes, turneras y balance real es una etapa pendiente.</span><button type="button" onClick={() => {
        if (!window.confirm('¿Descartar el borrador de demostración y empezar con una ficha vacía?')) return
        try { localStorage.removeItem(STORAGE_KEY); setRecord(createDentalDesignRecord()); setHistory([]); setDirty(false); setError(null); setNotice('Ficha de demostración reiniciada.') }
        catch (error) { setError(`No se pudo reiniciar: ${error instanceof Error ? error.message : 'error de almacenamiento'}`) }
      }}>Reiniciar demo</button></div>}
    </main>
  )
}
