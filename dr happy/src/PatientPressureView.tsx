import { useCallback, useEffect, useMemo, useState } from 'react'
import type { FormEvent } from 'react'
import { callPatientFolder } from './patientFolderService'
import type { BpReading } from './patientFolderService'
import {
  BP_CONSECUTIVE_WINDOW_MS,
  BP_CRISIS_DIASTOLIC,
  BP_CRISIS_SYSTOLIC,
  BP_LEVEL_LABEL,
  BpChart,
  bpLevel,
  bpStats,
  formatBpDateTime,
} from './BloodPressure'

type Alert = 'repeat' | 'emergency' | null

function localDateTimeValue(date = new Date()): string {
  const offset = date.getTimezoneOffset() * 60000
  return new Date(date.getTime() - offset).toISOString().slice(0, 16)
}

export default function PatientPressureView({ onToast }: { onToast: (message: string) => void }) {
  const [readings, setReadings] = useState<BpReading[]>([])
  const [loading, setLoading] = useState(true)
  const [systolic, setSystolic] = useState('')
  const [diastolic, setDiastolic] = useState('')
  const [pulse, setPulse] = useState('')
  const [note, setNote] = useState('')
  const [changeTime, setChangeTime] = useState(false)
  const [measuredAt, setMeasuredAt] = useState(localDateTimeValue())
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [alert, setAlert] = useState<Alert>(null)
  const [showAll, setShowAll] = useState(false)

  const load = useCallback(async () => {
    const result = await callPatientFolder({ action: 'bp-list' })
    setLoading(false)
    if (result.success) setReadings(result.readings ?? [])
    else setError(result.message || 'No se pudo cargar tu registro.')
  }, [])

  useEffect(() => { void load() }, [load])

  const stats7 = useMemo(() => bpStats(readings, 7), [readings])
  const stats30 = useMemo(() => bpStats(readings, 30), [readings])

  async function save(event: FormEvent) {
    event.preventDefault()
    if (busy) return
    setError('')
    const sys = Number(systolic)
    const dia = Number(diastolic)
    if (!sys || !dia) return setError('Completá la máxima y la mínima.')
    if (dia >= sys) return setError('La mínima tiene que ser menor que la máxima. ¿Las cargaste al revés?')
    const when = changeTime ? new Date(measuredAt) : new Date()
    setBusy(true)
    const result = await callPatientFolder({
      action: 'bp-add', systolic: sys, diastolic: dia, pulse: pulse ? Number(pulse) : null, note, measuredAt: when.toISOString(),
    })
    setBusy(false)
    if (!result.success || !result.reading) return setError(result.message || 'No se pudo guardar.')
    const saved = result.reading
    const savedTime = new Date(saved.measuredAt).getTime()
    const previous = readings
      .filter((reading) => new Date(reading.measuredAt).getTime() <= savedTime)
      .sort((a, b) => new Date(b.measuredAt).getTime() - new Date(a.measuredAt).getTime())[0]
    setReadings((current) => [saved, ...current].sort((a, b) => new Date(b.measuredAt).getTime() - new Date(a.measuredAt).getTime()))
    setSystolic('')
    setDiastolic('')
    setPulse('')
    setNote('')
    setChangeTime(false)
    const level = bpLevel(saved.systolic, saved.diastolic)
    if (level === 'crisis') {
      const consecutive = previous
        && bpLevel(previous.systolic, previous.diastolic) === 'crisis'
        && savedTime - new Date(previous.measuredAt).getTime() <= BP_CONSECUTIVE_WINDOW_MS
      setAlert(consecutive ? 'emergency' : 'repeat')
    } else if (level === 'high') {
      onToast('Guardada. Está alta: comentáselo a tu médico.')
    } else {
      onToast('Presión guardada ✔')
    }
  }

  async function remove(reading: BpReading) {
    if (!window.confirm(`¿Borrar la toma ${reading.systolic}/${reading.diastolic} del ${formatBpDateTime(reading.measuredAt)}?`)) return
    const result = await callPatientFolder({ action: 'bp-delete', readingId: reading.id })
    if (!result.success) return setError(result.message || 'No se pudo borrar.')
    setReadings((current) => current.filter((item) => item.id !== reading.id))
    onToast('Toma borrada')
  }

  const visible = showAll ? readings : readings.slice(0, 8)

  return (
    <section className="pp-stack bp-scope">
      <form className="pp-card pp-form pp-bp-form" onSubmit={save}>
        <h2>❤️ Anotar mi presión</h2>
        <div className="pp-bp-inputs">
          <label>Máxima
            <input value={systolic} onChange={(e) => setSystolic(e.target.value.replace(/\D/g, '').slice(0, 3))} inputMode="numeric" placeholder="120" required aria-describedby="pp-bp-units" />
          </label>
          <span className="pp-bp-slash" aria-hidden>/</span>
          <label>Mínima
            <input value={diastolic} onChange={(e) => setDiastolic(e.target.value.replace(/\D/g, '').slice(0, 3))} inputMode="numeric" placeholder="80" required aria-describedby="pp-bp-units" />
          </label>
        </div>
        <small id="pp-bp-units" className="pp-muted">En mmHg, como lo muestra tu tensiómetro (ej.: 120 / 80).</small>
        <label>Pulso <small>(opcional)</small>
          <input value={pulse} onChange={(e) => setPulse(e.target.value.replace(/\D/g, '').slice(0, 3))} inputMode="numeric" placeholder="70" />
        </label>
        <label>Nota <small>(opcional)</small>
          <input value={note} onChange={(e) => setNote(e.target.value.slice(0, 200))} placeholder="Ej.: después de caminar, me sentía mareado" maxLength={200} />
        </label>
        {changeTime
          ? <label>Fecha y hora de la toma<input type="datetime-local" value={measuredAt} max={localDateTimeValue()} onChange={(e) => setMeasuredAt(e.target.value)} required /></label>
          : <button type="button" className="pp-link-btn" onClick={() => { setMeasuredAt(localDateTimeValue()); setChangeTime(true) }}>Se guarda con la hora de ahora · Cambiar</button>}
        {error && <p className="pp-error" role="alert">{error}</p>}
        <button type="submit" className="pp-primary" disabled={busy}>{busy ? 'Guardando…' : 'Guardar'}</button>
      </form>

      <div className="pp-card">
        <h2>Mi registro</h2>
        {loading ? <p className="pp-muted">Cargando…</p> : !readings.length ? (
          <p className="pp-muted">Todavía no anotaste ninguna toma. Cuando lo hagas, vas a ver acá tu promedio y un gráfico.</p>
        ) : (
          <>
            <div className="bp-stats">
              {[{ label: 'Promedio 7 días', stats: stats7 }, { label: 'Promedio 30 días', stats: stats30 }].map(({ label, stats }) => (
                <div key={label} className="bp-stat">
                  <small>{label}</small>
                  {stats ? <><strong className={`is-${bpLevel(stats.systolic, stats.diastolic)}`}>{stats.systolic}/{stats.diastolic}</strong><span>{stats.count} {stats.count === 1 ? 'toma' : 'tomas'}</span></> : <span>Sin tomas</span>}
                </div>
              ))}
            </div>
            <BpChart readings={readings} days={30} />
            <ul className="pp-bp-list">
              {visible.map((reading) => {
                const level = bpLevel(reading.systolic, reading.diastolic)
                return (
                  <li key={reading.id} className={`is-${level}`}>
                    <div>
                      <strong>{reading.systolic}/{reading.diastolic}</strong>
                      {reading.pulse ? <span> · {reading.pulse} lpm</span> : null}
                      <small className={`is-${level}`}> {BP_LEVEL_LABEL[level]}</small>
                      <span className="pp-bp-when">{formatBpDateTime(reading.measuredAt)}{reading.note ? ` · ${reading.note}` : ''}</span>
                    </div>
                    <button type="button" aria-label="Borrar toma" onClick={() => void remove(reading)}>✕</button>
                  </li>
                )
              })}
            </ul>
            {readings.length > 8 && <button type="button" className="pp-link-btn" onClick={() => setShowAll((value) => !value)}>{showAll ? 'Ver menos' : `Ver las ${readings.length} tomas`}</button>}
          </>
        )}
        <p className="pp-muted pp-bp-share">🩺 Si compartís tu carpeta con tu médico, también va a ver este registro.</p>
      </div>

      <details className="pp-card pp-bp-tips">
        <summary>¿Cómo tomarme bien la presión?</summary>
        <ul>
          <li>Sentate tranquilo/a 5 minutos antes, con la espalda apoyada y los pies en el piso.</li>
          <li>Brazo apoyado a la altura del corazón, sin ropa ajustada.</li>
          <li>Nada de café, mate, cigarrillo ni ejercicio 30 minutos antes.</li>
          <li>No hables durante la toma. Si podés, tomala 2 veces con 1 minuto de diferencia.</li>
          <li>Tratá de medirla siempre a la misma hora (por ejemplo, a la mañana y a la noche).</li>
        </ul>
      </details>

      {alert && (
        <div className="pp-install-overlay" role="alertdialog" aria-modal="true" aria-labelledby="pp-bp-alert-title">
          <div className={`pp-install-modal pp-bp-alert ${alert === 'emergency' ? 'is-emergency' : ''}`}>
            <span className="pp-bp-alert-icon" aria-hidden>{alert === 'emergency' ? '🚑' : '⚠️'}</span>
            {alert === 'emergency' ? (
              <>
                <h2 id="pp-bp-alert-title">Concurrí a la guardia</h2>
                <p>Tuviste <strong>2 tomas seguidas de {BP_CRISIS_SYSTOLIC}/{BP_CRISIS_DIASTOLIC} o más</strong>. Andá ahora a la guardia más cercana. No manejes vos.</p>
              </>
            ) : (
              <>
                <h2 id="pp-bp-alert-title">Tu presión está muy alta</h2>
                <p>Quedate sentado/a y tranquilo/a <strong>5 minutos</strong> y volvé a tomártela.</p>
                <p>Si la segunda toma también da <strong>{BP_CRISIS_SYSTOLIC}/{BP_CRISIS_DIASTOLIC} o más</strong>, concurrí a la guardia.</p>
              </>
            )}
            <p className="pp-bp-alert-symptoms">Si tenés dolor de pecho, falta de aire, dolor de cabeza muy fuerte, visión borrosa o dificultad para hablar o mover un brazo o una pierna, <strong>andá a la guardia ya</strong>.</p>
            <button type="button" className="pp-primary" onClick={() => setAlert(null)}>Entendido</button>
          </div>
        </div>
      )}
    </section>
  )
}
