import { useCallback, useEffect, useState } from 'react'
import { fetchAdminPatientStats, retryPatientNotices } from './adminStatsService'
import type { AdminPatientStatsData } from './adminStatsService'
import { useErrorNotification } from './useErrorNotification'
import './adminPatientStats.css'

const dateTime = (value: string | null) => value
  ? new Date(value).toLocaleString('es-AR', { timeZone: 'America/Argentina/Buenos_Aires' }) : '—'
const number = (value: number) => value.toLocaleString('es-AR')
const FEATURES: Record<string, string> = {
  home: 'Inicio', folder: 'Mi carpeta', upload: 'Subir estudio', pressure: 'Mi presión',
  memory: 'Taller de memoria', share: 'Compartir con mi médico', account: 'Mi cuenta',
  game_completed: 'Partidas terminadas', invite_clicked: 'Clics en invitar por WhatsApp',
}

export function AdminPatientStats() {
  const [stats, setStats] = useState<AdminPatientStatsData | null>(null)
  const [page, setPage] = useState(0)
  const [loading, setLoading] = useState(true)
  const [retrying, setRetrying] = useState(false)
  const [notice, setNotice] = useState('')
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
      {loading && <p role="status">Cargando estadísticas…</p>}
      {stats && !loading && (
        <>
          <div className="analytics-summary-grid">
            {([
              ['Cuentas creadas', stats.summary.total],
              ['Email verificado', stats.summary.verified],
              ['Pendientes de verificar', stats.summary.pending],
              ['Nuevas cuentas · 7 días', stats.summary.registrations7d],
              ['Nuevas cuentas · 30 días', stats.summary.registrations30d],
              ['Pacientes activos hoy', stats.summary.active_today],
              ['Activos · 7 días', stats.summary.active7d],
              ['Activos · 30 días', stats.summary.active30d],
              ['Minutos visibles · 30 días', stats.summary.minutes30d],
              ['Partidas terminadas · 30 días', stats.summary.games30d],
              ['Clics WhatsApp · 30 días', stats.summary.invites30d],
              ['Estudios guardados', stats.documents.count],
              ['Pacientes con estudios', stats.documents.patients],
              ['Registros de presión', stats.pressure.count],
              ['Pacientes que anotaron presión', stats.pressure.patients],
              ['Accesos a médicos vigentes', stats.shares.doctor],
              ['Links compartidos vigentes', stats.shares.link],
            ] as const).map(([label, value]) => (
              <article key={label} className="analytics-stat-card"><strong>{number(value)}</strong><span>{label}</span></article>
            ))}
          </div>
          <p className="flow-hint">
            Almacenamiento de estudios: {(stats.documents.bytes / 1048576).toLocaleString('es-AR', { maximumFractionDigits: 1 })} MB.
            {' '}Actividad medida desde {stats.trackingSince || 'el primer ingreso posterior a esta actualización'}.
            {' '}Los días usan horario argentino. Los minutos cuentan la app visible, no garantizan interacción.
            {' '}Un clic en WhatsApp no confirma que se haya enviado una invitación.
          </p>
          <h4>Aperturas de herramientas · últimos 30 días</h4>
          <ul className="aps-features">
            {Object.entries(FEATURES).map(([key, label]) => <li key={key}><span>{label}</span><strong>{number(stats.features[key] ?? 0)}</strong></li>)}
          </ul>
          <h4>Altas y actividad por día · últimos 30 días</h4>
          <div className="aps-table-scroll">
            <table><thead><tr><th>Fecha</th><th>Cuentas creadas</th><th>Verificadas</th><th>Pacientes activos</th></tr></thead>
              <tbody>{stats.daily.map(day => <tr key={day.date}><td>{day.date.split('-').reverse().join('/')}</td><td>{number(day.registrations)}</td><td>{number(day.verified)}</td><td>{number(day.active)}</td></tr>)}</tbody>
            </table>
          </div>
          <h4>Pacientes registrados · más recientes primero</h4>
          <p className="flow-hint">Solo datos básicos de la cuenta para administrar las altas. No se muestran DNI ni información clínica.</p>
          <div className="aps-table-scroll">
            <table><thead><tr><th>Nombre</th><th>Email</th><th>Registro</th><th>Estado</th><th>Último inicio de sesión</th><th>Última actividad</th></tr></thead>
              <tbody>{stats.recent.map(patient => <tr key={patient.id}>
                <td>{patient.full_name}</td><td>{patient.email}</td><td>{dateTime(patient.created_at)}</td>
                <td>{!patient.active ? 'Desactivada' : patient.email_verified_at ? 'Verificada' : 'Sin verificar'}</td>
                <td>{dateTime(patient.last_login_at)}</td>
                <td>{dateTime(patient.last_seen_at)}</td>
              </tr>)}</tbody>
            </table>
          </div>
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
