import type { ReactNode } from 'react'
import type { groupLedgerByPatient, LedgerAmountEntry } from './ledgerModel'
import './patientLedger.css'

export function PatientLedgerCards<T extends LedgerAmountEntry>({ groups, formatMoney, formatDate, renderEntry, onOpenPatient, archivedIds }: {
  archivedIds?: ReadonlySet<string>
  groups: ReturnType<typeof groupLedgerByPatient<T>>
  formatMoney: (amount: number) => string
  formatDate: (date: string) => string
  renderEntry: (entry: T) => ReactNode
  onOpenPatient: (patientId: string) => void
}) {
  return <div className="ledger-grid ledger-patient-grid">
    {groups.map((group) => <article key={group.patientId} className={`ledger-card ledger-patient-card ${group.pending > 0 ? 'has-debt' : 'settled'}`}>
      <div className="ledger-card-top">
        <div><strong className="ledger-card-patient">{group.patientName}</strong>
          {archivedIds?.has(group.patientId) ? <span className="ledger-card-date">Paciente archivado · registros conservados</span> : null}
          <span className="ledger-card-date">{group.entries.length} intervención{group.entries.length === 1 ? '' : 'es'} · Último registro: {formatDate(group.date)}</span>
        </div>
        <span className={`ledger-badge ${group.pending > 0 ? 'warn' : 'ok'}`}>{group.pending > 0 ? `Debe ${formatMoney(group.pending)}` : 'Saldado'}</span>
      </div>
      <dl className="ledger-patient-totals">
        <div><dt>Importe registrado</dt><dd>{formatMoney(group.total)}</dd></div>
        <div><dt>Cobrado</dt><dd>{formatMoney(group.collected)}</dd></div>
        <div><dt>Pendiente</dt><dd>{formatMoney(group.pending)}</dd></div>
        <div><dt>Costo interno registrado</dt><dd>{group.costedEntries ? formatMoney(group.internalCost) : 'Sin dato'}</dd></div>
      </dl>
      {group.costedEntries > 0 && group.costedEntries < group.entries.length ? <small className="flow-hint">Costo disponible en {group.costedEntries} de {group.entries.length} intervenciones.</small> : null}
      {group.entries.some((entry) => entry.dentalRecordPatientId) ? <div className="ledger-card-actions">
        <button type="button" className="ghost" onClick={() => onOpenPatient(group.patientId)}>{archivedIds?.has(group.patientId) ? 'Consultar ficha archivada' : 'Abrir ficha dental'}</button>
      </div> : null}
      <details className="ledger-patient-details">
        <summary>Ver tratamientos y pagos ({group.entries.length})</summary>
        <div className="ledger-patient-treatments">{group.entries.map(renderEntry)}</div>
      </details>
    </article>)}
  </div>
}
