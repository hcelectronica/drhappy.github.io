import { useEffect, useRef, useState } from 'react'
import { supabase } from './supabaseClient'

interface Backup {
  total: number
  counts: Record<'pending' | 'sending' | 'sent' | 'failed' | 'uncertain', number>
}
interface Result { success: boolean; message?: string; deleted?: boolean; backup?: Backup | null }
async function call(body: Record<string, unknown>): Promise<Result> {
  if (!supabase) return { success: false, message: 'El servicio no está conectado.' }
  const { data, error } = await supabase.functions.invoke('patient-account-admin', { body })
  if (error) {
    if (error.context instanceof Response) {
      try { return await error.context.json() }
      catch { console.error('patient-account-admin: no se pudo leer el error del servidor') }
    }
    return { success: false, message: 'No se pudo conectar. Actualizá el estado antes de volver a intentar.' }
  }
  return data ?? { success: false, message: 'Respuesta vacía del servidor.' }
}
export function PatientAccountDeletion({ patient, onDeleted, onClose }: {
  patient: { id: string; full_name: string; email: string }; onDeleted: () => void; onClose: () => void
}) {
  const [email, setEmail] = useState('')
  const [backup, setBackup] = useState<Backup | null>(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [receipt, setReceipt] = useState(false)
  const mounted = useRef(true)
  const paused = useRef(false)
  const lock = useRef(false)
  useEffect(() => {
    mounted.current = true
    void call({ action: 'status', patientId: patient.id }).then(result => {
      if (!mounted.current) return
      setLoading(false)
      if (!result.success) setError(result.message || 'No se pudo consultar el estado.')
      else setBackup(result.backup ?? null)
    })
    return () => { mounted.current = false }
  }, [patient.id])
  const confirmed = email.trim().toLowerCase() === patient.email.trim().toLowerCase()
  async function run(action: 'prepare' | 'send-next' | 'retry' | 'delete' | 'status') {
    if (lock.current) return
    if (action === 'delete' && !window.confirm(`¿Eliminar definitivamente la cuenta de ${patient.full_name}? Esta acción no se puede deshacer.`)) return
    if (action === 'retry' && !window.confirm('Un envío sin confirmar podría haber llegado. Reintentar puede mandar copias duplicadas. ¿Continuar?')) return
    lock.current = true; paused.current = false; setBusy(true); setError('')
    try {
      let next: string = action
      let steps = 0
      do {
        if (++steps > 500) { setError('Se pausó después de 500 pasos. Actualizá el estado para continuar sin repetir los PDF confirmados.'); return }
        const result = await call({ action: next, patientId: patient.id, confirmEmail: email,
          confirmPermanent: true, receiptConfirmed: receipt, acceptDuplicateRisk: action === 'retry' })
        if (!mounted.current) return
        if (result.backup) setBackup(result.backup)
        if (!result.success) { setError(result.message || 'No se pudo completar la operación.'); return }
        if (result.deleted) { onDeleted(); return }
        if (next === 'delete') continue
        if (next === 'status' || !result.backup?.counts.pending) return
        next = 'send-next'
      } while (mounted.current && !paused.current)
    } finally {
      lock.current = false
      if (mounted.current) setBusy(false)
    }
  }
  const ready = backup !== null && backup.total === backup.counts.sent
  return <section className="aps-delete-confirm" aria-label={`Eliminar cuenta de ${patient.full_name}`}>
    <h4>Eliminar cuenta de Mi Carpeta de Salud</h4>
    <p><strong>{patient.full_name}</strong> · {patient.email}</p>
    <p>Primero se bloquea el acceso y se envían sus estudios como PDF adjuntos al email registrado y verificado, un archivo por correo. Los PDF originales no se modifican; las fotos se convierten a PDF.</p>
    <p>Después de confirmar que el paciente recibió las copias, se borrarán la cuenta, archivos, presión, glucosa, tratamiento, sesiones y accesos compartidos. No se borra la historia clínica del consultorio ni copias ya descargadas por terceros.</p>
    <label>Escribí el email del paciente para confirmar<input type="email" autoComplete="off" autoFocus value={email} onChange={event => setEmail(event.target.value)} disabled={busy} /></label>
    {loading && <p role="status">Consultando estado…</p>}
    {backup && <p role="status">PDF aceptados por correo: {backup.counts.sent} de {backup.total}. Pendientes: {backup.counts.pending}. Fallidos: {backup.counts.failed}. Sin confirmar: {backup.counts.sending + backup.counts.uncertain}.</p>}
    {backup && <p>La cuenta está bloqueada mientras termina este proceso. Cerrar esta pantalla pausa al terminar el archivo actual; podés retomarlo con “Eliminar paciente”. Ningún archivo original se borra antes de completar todos los envíos y la confirmación final.</p>}
    {ready && <label className="aps-delete-receipt"><input type="checkbox" checked={receipt} onChange={e => setReceipt(e.target.checked)} disabled={busy} /> {backup.total ? 'Confirmo que el paciente recibió y pudo guardar todos los PDF. La aceptación SMTP por sí sola no garantiza recepción.' : 'Confirmo el borrado definitivo. Esta cuenta no tiene estudios cargados para enviar.'}</label>}
    {error && <p className="error" role="alert">{error}</p>}
    {busy && <p role="status">Procesando… No cierres la pantalla hasta que termine el archivo actual.</p>}
    <div className="aps-actions">
      {!backup && <button type="button" disabled={!confirmed || busy || loading} onClick={() => void run('prepare')}>Enviar copia PDF y preparar eliminación</button>}
      {backup && backup.counts.pending > 0 && <button type="button" disabled={!confirmed || busy} onClick={() => void run('send-next')}>Continuar envío de PDF</button>}
      {backup && backup.counts.failed + backup.counts.uncertain + backup.counts.sending > 0 && <><p>Un envío interrumpido en curso se puede reclamar después de 2 minutos. Reintentar puede duplicar un correo ya recibido.</p><button type="button" disabled={!confirmed || busy} onClick={() => void run('retry')}>Reintentar copias no confirmadas</button></>}
      {backup && <button type="button" disabled={busy} onClick={() => void run('status')}>Actualizar estado</button>}
      {ready && <button type="button" className="aps-delete-button" disabled={!confirmed || !receipt || busy} onClick={() => void run('delete')}>Eliminar definitivamente</button>}
      {busy && <button type="button" className="ghost" onClick={() => { paused.current = true }}>Pausar después de este archivo</button>}
      <button type="button" className="ghost" disabled={busy} onClick={onClose}>Cerrar</button>
    </div>
  </section>
}
