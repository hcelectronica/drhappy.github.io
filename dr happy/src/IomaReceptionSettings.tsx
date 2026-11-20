import { useEffect, useState } from 'react'
import { callIoma, iomaUrl } from './iomaPrescriptionService'
import type { IomaRequest } from './iomaPrescriptionService'
import './iomaPrescription.css'

export default function IomaReceptionSettings() {
  const [settings, setSettings] = useState<{ enabled: boolean; slug: string } | null>(null)
  const [enabled, setEnabled] = useState(false)
  const [requests, setRequests] = useState<IomaRequest[] | null>(null)
  const [hasMore, setHasMore] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    let active = true
    async function load() {
      const [config, list] = await Promise.all([callIoma({ action: 'get-settings' }), callIoma({ action: 'list', offset: 0 })])
      if (!active) return
      if (config.success && typeof config.enabled === 'boolean' && typeof config.slug === 'string') {
        setSettings({ enabled: config.enabled, slug: config.slug }); setEnabled(config.enabled)
      } else setError(config.message || 'No se pudo cargar la configuración I.O.M.A.')
      if (list.success && Array.isArray(list.requests)) { setRequests(list.requests); setHasMore(list.requests.length === 100) }
      else setError(list.message || 'No se pudo cargar la bandeja I.O.M.A.')
    }
    void load()
    return () => { active = false }
  }, [])
  async function save() {
    setBusy(true); setError(''); setNotice('')
    const result = await callIoma({ action: 'save-settings', enabled })
    if (result.success && typeof result.enabled === 'boolean' && typeof result.slug === 'string') {
      setSettings({ enabled: result.enabled, slug: result.slug }); setEnabled(result.enabled); setNotice('Configuración I.O.M.A. guardada.')
    } else setError(result.message || 'No se pudo guardar la configuración I.O.M.A.')
    setBusy(false)
  }
  async function loadPage(append: boolean) {
    setBusy(true); setError(''); setNotice('')
    const result = await callIoma({ action: 'list', offset: append ? requests?.length ?? 0 : 0 })
    if (result.success && Array.isArray(result.requests)) {
      const page = result.requests
      setRequests(current => append ? [...(current ?? []), ...page] : page)
      setHasMore(page.length === 100)
    }
    else setError(result.message || 'No se pudo cargar la bandeja I.O.M.A.')
    setBusy(false)
  }
  async function complete(id: string) {
    setBusy(true); setError(''); setNotice('')
    const result = await callIoma({ action: 'complete', id })
    if (result.success) {
      setRequests(current => current?.map(request => request.id === id ? { ...request, status: 'completed' } : request) ?? null)
      setNotice('Solicitud marcada como atendida. La receta se gestiona por fuera de esta bandeja.')
    } else setError(result.message || 'No se pudo marcar la solicitud como atendida.')
    setBusy(false)
  }
  return <section className="ioma-settings" aria-labelledby="ioma-settings-title">
    <h3 id="ioma-settings-title">Receta I.O.M.A.</h3>
    <p>Solicitud independiente sin arancel. Gestioná la receta por fuera de esta bandeja.</p>
    {error && <p role="alert" className="reception-error">{error}</p>}
    {notice && <p role="status">{notice}</p>}
    {settings ? <>
      <label className="reception-toggle"><input type="checkbox" checked={enabled} disabled={busy} onChange={event => setEnabled(event.target.checked)} /> Habilitar solicitudes de receta I.O.M.A.</label>
      <button type="button" disabled={busy || enabled === settings.enabled} onClick={() => void save()}>Guardar configuración I.O.M.A.</button>
      {settings.enabled && settings.slug && <div className="reception-share"><a href={iomaUrl(settings.slug)} target="_blank" rel="noopener noreferrer">{iomaUrl(settings.slug)}</a></div>}
    </> : <p>Configuración no disponible. Cerrá y volvé a abrir Mi recepción para reintentar.</p>}
    <div className="ioma-inbox-heading"><h3>Bandeja I.O.M.A.</h3><button type="button" disabled={busy} onClick={() => void loadPage(false)}>Actualizar</button></div>
    {requests === null ? <p>Bandeja no disponible. Usá Actualizar para reintentar.</p> : requests.length === 0 ? <p>No hay solicitudes.</p> : <div className="ioma-list">
      {requests.map(request => <article key={request.id} className="ioma-request">
        <h4>{request.patient_last_name}, {request.patient_first_name}</h4>
        <p><strong>Estado:</strong> {request.status === 'completed' ? 'Atendida' : request.status === 'pending_review' ? 'Pendiente' : request.status} · <strong>Recibida:</strong> {request.created_at ? new Date(request.created_at).toLocaleString('es-AR') : 'Sin fecha'}</p>
        <p><strong>DNI:</strong> {request.patient_dni} · <strong>Nacimiento:</strong> {request.patient_birth_date} · <strong>Afiliado:</strong> {request.insurance_member_number}</p>
        <p><strong>Email:</strong> {request.patient_email} · <strong>Teléfono:</strong> {request.patient_phone}</p>
        <p><strong>Medicación solicitada:</strong> <span className="ioma-medication">{request.medication}</span></p>
        <p><strong>Notificación por correo:</strong> {request.email_status === 'sent' ? 'Enviada' : request.email_status === 'failed' ? 'No enviada' : 'Sin confirmar'}</p>
        <div className="ioma-actions">
          {request.status !== 'completed' && <button type="button" disabled={busy} onClick={() => void complete(request.id)}>Marcar atendida</button>}
        </div>
      </article>)}
    </div>}
    {hasMore && <button type="button" disabled={busy} onClick={() => void loadPage(true)}>Cargar más solicitudes</button>}
  </section>
}
