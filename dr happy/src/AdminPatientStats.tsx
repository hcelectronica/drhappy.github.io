import { useCallback, useEffect, useState } from 'react'
import { fetchAdminPatientStats, retryPatientNotices } from './adminStatsService'
import type { AdminPatientStatsData } from './adminStatsService'
import { useErrorNotification } from './useErrorNotification'
import './adminPatientStats.css'
import { PatientAccountDeletion } from './PatientAccountDeletion'

const dateTime = (value: string | null) => value
  ? new Date(value).toLocaleString('es-AR', { timeZone: 'America/Argentina/Buenos_Aires' }) : '—'
const number = (value: number) => value.toLocaleString('es-AR')

export function AdminPatientStats({ onCommunications }: { onCommunications?: () => void }) {
  const [stats, setStats] = useState<AdminPatientStatsData | null>(null)
  const [page, setPage] = useState(0)
  const [loading, setLoading] = useState(true)
  const [retrying, setRetrying] = useState(false)
  const [notice, setNotice] = useState('')
  const [deleting, setDeleting] = useState<AdminPatientStatsData['recent'][number] | null>(null)
  const [error, setError] = useErrorNotification()

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    const result = await fetchAdminPatientStats(page)
    if (result.success && result.stats) setStats(result.stats)
    else { setStats(null); setError(result.message || 'No se pudieron cargar las estadísticas de pacientes.') }
    setLoading(false)
  }, [page, setError])

  useEffect(() => {
    const timer = window.setTimeout(() => { void load() }, 0)
    return () => window.clearTimeout(timer)
  }, [load])

  async function retry() {
    setRetrying(true)
    setNotice('')
    const result = await retryPatientNotices()
    if (!result.success) setError(result.message || 'No se pudieron reintentar los avisos.')
    else {
      setNotice(`Avisos enviados en este intento: ${result.sent ?? 0}.`)
      await load()
    }
    setRetrying(false)
  }

  return (
    <section className="admin-patient-stats">
      <div className="panel-header">
        <div>
          <h3>Mi Carpeta de Salud · Estadísticas</h3>
          <p className="flow-hint">Uso de la mini app de pacientes. Sin acceso a estudios, diagnósticos ni valores de presión.</p>
        </div>
        <button type="button" className="ghost" disabled={loading} onClick={() => void load()}>Actualizar</button>
      </div>
      {error && <p className="error" role="alert">{error}</p>}
      {onCommunications && <button type="button" onClick={onCommunications}>Enviar novedades a pacientes de Mi Carpeta de Salud</button>}
      {deleting && <PatientAccountDeletion key={deleting.id} patient={deleting} onClose={() => { setDeleting(null); void load() }} onDeleted={() => {
        setDeleting(null); setNotice('Cuenta y datos de Mi Carpeta de Salud eliminados. La historia clínica del consultorio se conserva.'); void load()
      }} />}
      {loading && <p role="status">Cargando estadísticas…</p>}
      {stats && !loading && (
        <>
          <h4>Registros y uso de la mini app</h4>
          <div className="aps-summary">
            {([
              ['Cuentas creadas', stats.summary.total],
              ['Email verificado', stats.summary.verified],
              ['Pendientes de verificar', stats.summary.pending],
              ['Nuevas cuentas · 7 días', stats.summary.registrations7d],
              ['Nuevas cuentas · 30 días', stats.summary.registrations30d],
              ['Pacientes activos hoy', stats.summary.active_today],
              ['Activos · 7 días', stats.summary.active7d],
              ['Activos · 30 días', stats.summary.active30d],
              ['Clics WhatsApp · 30 días', stats.summary.invites30d],
            ] as const).map(([label, value]) => (
              <article key={label} className="aps-stat"><strong>{number(value)}</strong><span>{label}</span></article>
            ))}
          </div>
          <h4>Uso de la carpeta</h4>
          <ul className="aps-usage">
            <li><span>Estudios guardados</span><strong>{number(stats.documents.count)}</strong></li>
            <li><span>Pacientes con estudios</span><strong>{number(stats.documents.patients)}</strong></li>
            <li><span>Pacientes que registran su presión</span><strong>{number(stats.pressure.patients)}</strong></li>
            <li><span>Accesos a médicos vigentes</span><strong>{number(stats.shares.doctor)}</strong></li>
            <li><span>Links compartidos vigentes</span><strong>{number(stats.shares.link)}</strong></li>
          </ul>
          <p className="flow-hint">
            Almacenamiento de estudios: {(stats.documents.bytes / 1048576).toLocaleString('es-AR', { maximumFractionDigits: 1 })} MB.
            {' '}Actividad medida desde {stats.trackingSince || 'el primer ingreso posterior a esta actualización'}.
            {' '}Los días usan horario argentino. Activos son pacientes que abrieron la mini app en el período.
            {' '}Un clic en WhatsApp no confirma que se haya enviado una invitación.
          </p>
          <details className="aps-daily">
          <summary>Ver altas y actividad por día · últimos 30 días</summary>
          <div className="aps-table-scroll">
            <table><thead><tr><th>Fecha</th><th>Cuentas creadas</th><th>Verificadas</th><th>Pacientes activos</th></tr></thead>
              <tbody>{stats.daily.map(day => <tr key={day.date}><td data-label="Fecha">{day.date.split('-').reverse().join('/')}</td><td data-label="Cuentas creadas">{number(day.registrations)}</td><td data-label="Verificadas">{number(day.verified)}</td><td data-label="Pacientes activos">{number(day.active)}</td></tr>)}</tbody>
            </table>
          </div>
          </details>
          <h4>Pacientes registrados · más recientes primero</h4>
          <p className="flow-hint">Solo datos básicos de la cuenta para administrar las altas. No se muestran DNI ni información clínica.</p>
          <ul className="aps-patients">
            {stats.recent.map(patient => (
              <li key={patient.id}>
                <strong>{patient.full_name}</strong>
                <span className="aps-email">{patient.email}</span>
                <span className="aps-status">{!patient.active ? 'Desactivada' : patient.email_verified_at ? 'Verificada' : 'Sin verificar'}</span>
                <dl>
                  <div><dt>Registro</dt><dd>{dateTime(patient.created_at)}</dd></div>
                  <div><dt>Última actividad</dt><dd>{dateTime(patient.last_seen_at || patient.last_login_at)}</dd></div>
                </dl>
                <button type="button" className="ghost aps-delete-button" disabled={deleting !== null} onClick={() => { setNotice(''); setDeleting(patient) }}>Eliminar paciente</button>
              </li>
            ))}
          </ul>
          {stats.recent.length === 0 && <p>Todavía no hay pacientes en esta página.</p>}
          <div className="aps-actions">
            <button type="button" className="ghost" disabled={page === 0} onClick={() => setPage(page - 1)}>Anterior</button>
            <span>Página {page + 1}</span>
            <button type="button" className="ghost" disabled={(page + 1) * 50 >= stats.summary.total} onClick={() => setPage(page + 1)}>Siguiente</button>
          </div>
          <h4>Avisos de nuevos pacientes al administrador</h4>
          <p>Enviados: {stats.notices.sent}. Pendientes o fallidos: {stats.notices.pending}.</p>
          <p className="flow-hint">Se avisa al verificar el email. Los registros anteriores a esta herramienta no generan correos retroactivos. Si el correo falla, el alta se conserva y el aviso queda pendiente.</p>
          <button type="button" className="ghost" disabled={retrying || stats.notices.pending === 0} onClick={() => void retry()}>
            {retrying ? 'Reintentando…' : 'Reintentar avisos pendientes (hasta 10)'}
          </button>
          {notice && <p role="status">{notice}</p>}
          <p className="flow-hint">Última actualización: {dateTime(stats.generatedAt)}.</p>
        </>
      )}
    </section>
  )
}
