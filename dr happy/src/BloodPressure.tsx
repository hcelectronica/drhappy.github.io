import { useMemo, useState } from 'react'
import type { BpReading } from './patientFolderService'
import './BloodPressure.css'

export type BpLevel = 'normal' | 'elevated' | 'high' | 'crisis'

export const BP_CRISIS_SYSTOLIC = 180
export const BP_CRISIS_DIASTOLIC = 110
// Dos tomas en crisis separadas por menos de este tiempo cuentan como "consecutivas".
export const BP_CONSECUTIVE_WINDOW_MS = 3 * 60 * 60 * 1000

export function bpLevel(systolic: number, diastolic: number): BpLevel {
  if (systolic >= BP_CRISIS_SYSTOLIC || diastolic >= BP_CRISIS_DIASTOLIC) return 'crisis'
  if (systolic >= 140 || diastolic >= 90) return 'high'
  if (systolic >= 130 || diastolic >= 80) return 'elevated'
  return 'normal'
}

export const BP_LEVEL_LABEL: Record<BpLevel, string> = {
  normal: 'Normal',
  elevated: 'Algo elevada',
  high: 'Alta',
  crisis: 'Muy alta',
}

export interface BpStats {
  count: number
  systolic: number
  diastolic: number
  pulse: number | null
  maxSystolic: number
  maxDiastolic: number
  highCount: number
  crisisCount: number
}

export function bpStats(readings: BpReading[], days: number, now = Date.now()): BpStats | null {
  const from = now - days * 86400000
  const list = readings.filter((reading) => new Date(reading.measuredAt).getTime() >= from)
  if (!list.length) return null
  const avg = (values: number[]) => Math.round(values.reduce((sum, value) => sum + value, 0) / values.length)
  const pulses = list.map((reading) => reading.pulse).filter((pulse): pulse is number => typeof pulse === 'number')
  return {
    count: list.length,
    systolic: avg(list.map((reading) => reading.systolic)),
    diastolic: avg(list.map((reading) => reading.diastolic)),
    pulse: pulses.length ? avg(pulses) : null,
    maxSystolic: Math.max(...list.map((reading) => reading.systolic)),
    maxDiastolic: Math.max(...list.map((reading) => reading.diastolic)),
    highCount: list.filter((reading) => bpLevel(reading.systolic, reading.diastolic) !== 'normal' && bpLevel(reading.systolic, reading.diastolic) !== 'elevated').length,
    crisisCount: list.filter((reading) => bpLevel(reading.systolic, reading.diastolic) === 'crisis').length,
  }
}

export function formatBpDateTime(value: string): string {
  const date = new Date(value)
  return `${date.toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit', year: '2-digit' })} ${date.toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' })}`
}

export function bpSummaryText(readings: BpReading[], days = 30): string {
  const stats = bpStats(readings, days)
  if (!stats) return ''
  const parts = [
    `PA domiciliaria (últimos ${days} días, ${stats.count} ${stats.count === 1 ? 'toma' : 'tomas'}): promedio ${stats.systolic}/${stats.diastolic} mmHg`,
    stats.pulse ? `FC media ${stats.pulse} lpm` : '',
    `máx ${stats.maxSystolic}/${stats.maxDiastolic}`,
    stats.highCount ? `${stats.highCount} ${stats.highCount === 1 ? 'toma' : 'tomas'} ≥140/90` : '',
    stats.crisisCount ? `${stats.crisisCount} ≥${BP_CRISIS_SYSTOLIC}/${BP_CRISIS_DIASTOLIC}` : '',
  ].filter(Boolean)
  return `${parts.join(', ')}. Registrado por el paciente en Mi Carpeta de Salud.`
}

export function BpChart({ readings, days = 30 }: { readings: BpReading[]; days?: number }) {
  const width = 640
  const height = 220
  const pad = { top: 12, right: 12, bottom: 24, left: 34 }
  const now = Date.now()
  const from = now - days * 86400000
  const points = readings
    .filter((reading) => new Date(reading.measuredAt).getTime() >= from)
    .sort((a, b) => new Date(a.measuredAt).getTime() - new Date(b.measuredAt).getTime())
  if (points.length < 2) return <p className="bp-empty">Con 2 tomas o más vas a ver el gráfico.</p>
  const maxValue = Math.max(200, ...points.map((point) => point.systolic + 10))
  const minValue = Math.min(40, ...points.map((point) => point.diastolic - 10))
  const x = (time: number) => pad.left + ((time - from) / (now - from)) * (width - pad.left - pad.right)
  const y = (value: number) => pad.top + (1 - (value - minValue) / (maxValue - minValue)) * (height - pad.top - pad.bottom)
  const line = (key: 'systolic' | 'diastolic') => points.map((point, index) => `${index ? 'L' : 'M'}${x(new Date(point.measuredAt).getTime()).toFixed(1)},${y(point[key]).toFixed(1)}`).join(' ')
  const ticks = [60, 80, 100, 120, 140, 160, 180].filter((value) => value > minValue && value < maxValue)
  const dayTicks = [0, Math.round(days / 2), days].map((offset) => from + offset * 86400000)
  return (
    <figure className="bp-chart">
      <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label={`Gráfico de presión arterial de los últimos ${days} días`}>
        <rect className="bp-band" x={pad.left} width={width - pad.left - pad.right} y={y(130)} height={y(90) - y(130)} />
        <rect className="bp-band" x={pad.left} width={width - pad.left - pad.right} y={y(80)} height={y(60) - y(80)} />
        {ticks.map((value) => (
          <g key={value}>
            <line className={value === 140 || value === 90 ? 'bp-grid is-limit' : 'bp-grid'} x1={pad.left} x2={width - pad.right} y1={y(value)} y2={y(value)} />
            <text className="bp-axis" x={pad.left - 6} y={y(value) + 4} textAnchor="end">{value}</text>
          </g>
        ))}
        {dayTicks.map((time, index) => (
          <text key={time} className="bp-axis" x={x(time)} y={height - 6} textAnchor={index === 0 ? 'start' : index === 2 ? 'end' : 'middle'}>
            {index === 2 ? 'Hoy' : new Date(time).toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit' })}
          </text>
        ))}
        <path className="bp-line is-sys" d={line('systolic')} />
        <path className="bp-line is-dia" d={line('diastolic')} />
        {points.map((point) => {
          const level = bpLevel(point.systolic, point.diastolic)
          const cx = x(new Date(point.measuredAt).getTime())
          return (
            <g key={point.id}>
              <circle className={`bp-dot is-sys is-${level}`} cx={cx} cy={y(point.systolic)} r={level === 'crisis' ? 5 : 3.5}><title>{`${formatBpDateTime(point.measuredAt)} · ${point.systolic}/${point.diastolic}`}</title></circle>
              <circle className="bp-dot is-dia" cx={cx} cy={y(point.diastolic)} r={3} />
            </g>
          )
        })}
      </svg>
      <figcaption><span className="bp-key is-sys" /> Máxima <span className="bp-key is-dia" /> Mínima <span className="bp-key is-band" /> Rango normal</figcaption>
    </figure>
  )
}

function StatsBox({ label, stats }: { label: string; stats: BpStats | null }) {
  return (
    <div className="bp-stat">
      <small>{label}</small>
      {stats ? (
        <>
          <strong className={`is-${bpLevel(stats.systolic, stats.diastolic)}`}>{stats.systolic}/{stats.diastolic}</strong>
          <span>{stats.count} {stats.count === 1 ? 'toma' : 'tomas'}{stats.pulse ? ` · ${stats.pulse} lpm` : ''}</span>
        </>
      ) : <span>Sin tomas</span>}
    </div>
  )
}

// Resumen para el médico (ficha en Dr Happy y link compartido).
export function BpDoctorSummary({ readings, onCopy }: { readings: BpReading[]; onCopy?: (text: string) => void }) {
  const [days, setDays] = useState(30)
  const [showAll, setShowAll] = useState(false)
  const stats7 = useMemo(() => bpStats(readings, 7), [readings])
  const stats30 = useMemo(() => bpStats(readings, 30), [readings])
  const sorted = useMemo(() => [...readings].sort((a, b) => new Date(b.measuredAt).getTime() - new Date(a.measuredAt).getTime()), [readings])
  const visible = showAll ? sorted : sorted.slice(0, 10)
  const summary = bpSummaryText(readings, 30)

  async function copySummary() {
    if (!summary) return
    try {
      await navigator.clipboard.writeText(summary)
      onCopy?.('Resumen copiado. Pegalo en la evolución.')
    } catch {
      window.prompt('Copiá el resumen:', summary)
    }
  }

  return (
    <div className="bp-doctor bp-scope">
      <div className="bp-stats">
        <StatsBox label="Promedio 7 días" stats={stats7} />
        <StatsBox label="Promedio 30 días" stats={stats30} />
        <div className="bp-stat">
          <small>Tomas ≥140/90 (30 d)</small>
          <strong className={stats30?.highCount ? 'is-high' : 'is-normal'}>{stats30?.highCount ?? 0}</strong>
          <span>{stats30?.crisisCount ? `${stats30.crisisCount} ≥${BP_CRISIS_SYSTOLIC}/${BP_CRISIS_DIASTOLIC}` : 'Ninguna en crisis'}</span>
        </div>
      </div>
      <div className="bp-range" role="group" aria-label="Período del gráfico">
        {[7, 30, 90].map((value) => (
          <button key={value} type="button" className={days === value ? 'is-active' : ''} onClick={() => setDays(value)}>{value} días</button>
        ))}
      </div>
      <BpChart readings={readings} days={days} />
      <table className="bp-table">
        <thead><tr><th>Fecha y hora</th><th>Presión</th><th>Pulso</th><th>Nota</th></tr></thead>
        <tbody>
          {visible.map((reading) => {
            const level = bpLevel(reading.systolic, reading.diastolic)
            return (
              <tr key={reading.id} className={`is-${level}`}>
                <td>{formatBpDateTime(reading.measuredAt)}</td>
                <td><strong>{reading.systolic}/{reading.diastolic}</strong>{level !== 'normal' ? <small> {BP_LEVEL_LABEL[level]}</small> : null}</td>
                <td>{reading.pulse ?? '—'}</td>
                <td>{reading.note ?? ''}</td>
              </tr>
            )
          })}
        </tbody>
      </table>
      <div className="bp-actions">
        {sorted.length > 10 ? <button type="button" onClick={() => setShowAll((value) => !value)}>{showAll ? 'Ver menos' : `Ver las ${sorted.length} tomas`}</button> : null}
        {summary ? <button type="button" onClick={() => void copySummary()}>📋 Copiar resumen para la evolución</button> : null}
      </div>
      <p className="bp-note">Valores cargados por el paciente con su tensiómetro. Referencia: normal &lt;130/80; alta ≥140/90; muy alta ≥{BP_CRISIS_SYSTOLIC}/{BP_CRISIS_DIASTOLIC}.</p>
    </div>
  )
}
