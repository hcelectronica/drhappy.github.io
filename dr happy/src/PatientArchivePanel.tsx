import { useState } from 'react'
import type { ArchivedPatient } from './patientArchive'
import './patientArchive.css'

export function PatientArchivePanel({ entries, busy, onAction, onOpen }: {
  entries: ArchivedPatient[]
  busy: boolean
  onAction: (id: string, action: 'restore' | 'confirm') => void
  onOpen: (id: string) => void
}) {
  const [query, setQuery] = useState('')
  const [confirmed, setConfirmed] = useState(false)
  const normalize = (value: string) => value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
  const visible = entries.filter((entry) => (entry.state === 'confirmed') === confirmed
    && normalize(`${entry.patient.apellido} ${entry.patient.nombre} ${entry.patient.dni}`).includes(normalize(query.trim())))
  return <section className="panel patient-archive-panel">
    <h3>Pacientes eliminados</h3>
    <p>Eliminar quita al paciente de las listas activas. Podés restaurarlo o confirmar su baja. Sus atenciones, pagos y saldos se conservan; el balance no cambia.</p>
    <div className="patient-archive-tabs">
      <button type="button" className={confirmed ? 'ghost' : ''} onClick={() => setConfirmed(false)}>Pendientes ({entries.filter((entry) => entry.state === 'archived').length})</button>
      <button type="button" className={confirmed ? '' : 'ghost'} onClick={() => setConfirmed(true)}>Archivo confirmado ({entries.filter((entry) => entry.state === 'confirmed').length})</button>
    </div>
    <label>Buscar en el archivo<input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Nombre, apellido o DNI" /></label>
    {confirmed ? <p className="flow-hint">Bajas confirmadas: consulta de solo lectura. Los registros no se borran.</p> : null}
    {!visible.length ? <p>No hay pacientes en esta sección.</p> : <div className="patient-archive-grid">
      {visible.map((entry) => <article key={entry.patient_id} className="patient-archive-card">
        <strong>{entry.patient.apellido}, {entry.patient.nombre}</strong><span>DNI {entry.patient.dni}</span>
        <small>Archivado: {new Date(entry.archived_at).toLocaleDateString('es-AR')}</small>
        {entry.confirmed_at ? <small>Baja confirmada: {new Date(entry.confirmed_at).toLocaleDateString('es-AR')}</small> : null}
        <div className="patient-archive-actions">
          <button type="button" className="ghost" disabled={busy} onClick={() => onOpen(entry.patient_id)}>Consultar ficha archivada</button>
          {entry.state === 'archived' ? <>
            <button type="button" disabled={busy} onClick={() => onAction(entry.patient_id, 'restore')}>Restaurar paciente</button>
            <button type="button" className="ghost" disabled={busy} onClick={() => onAction(entry.patient_id, 'confirm')}>Confirmar eliminación</button>
          </> : null}
        </div>
      </article>)}
    </div>}
  </section>
}
