import { useEffect, useState } from 'react'
import {
  buildPaidClinicalDocumentsUrl,
  completePaidClinicalDocumentRequest,
  getPaidClinicalDocumentSettings,
  listPaidClinicalDocumentRequests,
  savePaidClinicalDocumentSettings,
} from './paidClinicalDocumentsService'
import type {
  PaidClinicalDocumentRequest,
  PaidClinicalDocumentSettings,
} from './paidClinicalDocumentsService'

interface PaidClinicalDocumentsPanelProps {
  onClose: () => void
  onStartIssue: (request: PaidClinicalDocumentRequest) => void
}

const serviceRows = [
  {
    key: 'certificate',
    label: 'Certificado médico',
    description: 'Por ejemplo: apto físico, justificativo laboral u otro certificado acordado.',
  },
  {
    key: 'studyOrder',
    label: 'Orden de estudios',
    description: 'El profesional completa los estudios indicados con su herramienta habitual.',
  },
] as const

function formatPrice(value: number): string {
  return `$${value.toLocaleString('es-AR')}`
}

function formatDate(value: string | null): string {
  if (!value) return '—'
  return new Intl.DateTimeFormat('es-AR', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(value))
}

export function PaidClinicalDocumentsPanel({ onClose, onStartIssue }: PaidClinicalDocumentsPanelProps) {
  const [settings, setSettings] = useState<PaidClinicalDocumentSettings | null>(null)
  const [requests, setRequests] = useState<PaidClinicalDocumentRequest[]>([])
  const [prices, setPrices] = useState({ certificate: '', studyOrder: '' })
  const [enabled, setEnabled] = useState({ certificate: false, studyOrder: false })
  const [tab, setTab] = useState<'settings' | 'requests'>('settings')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [busyRequestId, setBusyRequestId] = useState<string | null>(null)
  const [copyState, setCopyState] = useState<'idle' | 'copied' | 'error'>('idle')
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  async function refreshRequests(): Promise<void> {
    const result = await listPaidClinicalDocumentRequests()
    if (!result.success) throw new Error(result.message || 'No se pudieron cargar las solicitudes.')
    setRequests(result.requests ?? [])
  }

  useEffect(() => {
    let cancelled = false
    async function load(): Promise<void> {
      try {
        const [settingsResult, requestsResult] = await Promise.all([
          getPaidClinicalDocumentSettings(),
          listPaidClinicalDocumentRequests(),
        ])
        if (!settingsResult.success || !settingsResult.settings) throw new Error(settingsResult.message || 'No se pudo cargar la configuración.')
        if (!requestsResult.success) throw new Error(requestsResult.message || 'No se pudieron cargar las solicitudes.')
        if (cancelled) return
        setSettings(settingsResult.settings)
        setPrices({
          certificate: String(settingsResult.settings.services.certificate.price || ''),
          studyOrder: String(settingsResult.settings.services.studyOrder.price || ''),
        })
        setEnabled({
          certificate: settingsResult.settings.services.certificate.enabled,
          studyOrder: settingsResult.settings.services.studyOrder.enabled,
        })
        setRequests(requestsResult.requests ?? [])
      } catch (loadError) {
        if (!cancelled) setError(loadError instanceof Error ? loadError.message : 'No se pudo cargar el piloto.')
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    void load()
    return () => { cancelled = true }
  }, [])

  async function copyLink(): Promise<void> {
    if (!settings) return
    try {
      await navigator.clipboard.writeText(buildPaidClinicalDocumentsUrl(settings.slug))
      setCopyState('copied')
      setError(null)
    } catch (copyError) {
      console.error('No se pudo copiar el enlace de documentos:', copyError)
      setCopyState('error')
    }
  }

  async function saveSettings(): Promise<void> {
    if (!settings) return
    setSaving(true)
    setError(null)
    setNotice(null)
    try {
      const result = await savePaidClinicalDocumentSettings({
        certificateEnabled: enabled.certificate,
        certificatePrice: Number(prices.certificate) || 0,
        studyOrderEnabled: enabled.studyOrder,
        studyOrderPrice: Number(prices.studyOrder) || 0,
      })
      if (!result.success || !result.settings) throw new Error(result.message || 'No se pudo guardar la configuración.')
      setSettings(result.settings)
      setNotice('Configuración guardada. Los cambios del enlace público ya están activos.')
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'No se pudo guardar la configuración.')
    } finally {
      setSaving(false)
    }
  }

  async function markIssued(request: PaidClinicalDocumentRequest): Promise<void> {
    setBusyRequestId(request.id)
    setError(null)
    setNotice(null)
    try {
      const result = await completePaidClinicalDocumentRequest(request.id)
      if (!result.success) throw new Error(result.message || 'No se pudo cerrar la solicitud.')
      await refreshRequests()
      setNotice('Solicitud marcada como emitida.')
    } catch (statusError) {
      setError(statusError instanceof Error ? statusError.message : 'No se pudo cerrar la solicitud.')
    } finally {
      setBusyRequestId(null)
    }
  }

  return (
    <div className="drhappy-modal-overlay paid-documents-overlay" onClick={onClose}>
      <section
        className="drhappy-modal-card paid-documents-modal"
        onClick={(event) => event.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="paid-documents-title"
      >
        <header className="drhappy-modal-header">
          <div>
            <span className="section-kicker">Piloto · enlace y cobro independientes</span>
            <h2 id="paid-documents-title">Certificados y órdenes con pago</h2>
          </div>
          <button type="button" className="drhappy-modal-close-btn" onClick={onClose} aria-label="Cerrar">✕</button>
        </header>

        <div className="paid-documents-warning" role="note">
          <strong>Este enlace es independiente de Consulta Virtual e Invitar paciente.</strong>
          <span>Los pagos se procesan en la cuenta de Mercado Pago conectada a este perfil. El documento se emite luego desde la herramienta clínica habitual.</span>
        </div>

        <nav className="paid-documents-tabs" aria-label="Secciones de certificados y órdenes">
          <button type="button" className={tab === 'settings' ? 'active' : ''} aria-pressed={tab === 'settings'} onClick={() => setTab('settings')}>
            Configurar enlace
          </button>
          <button type="button" className={tab === 'requests' ? 'active' : ''} aria-pressed={tab === 'requests'} onClick={() => setTab('requests')}>
            Solicitudes {requests.filter((request) => request.status === 'pending_review').length ? <small>{requests.filter((request) => request.status === 'pending_review').length}</small> : null}
          </button>
        </nav>

        {loading ? <p className="paid-documents-loading">Cargando configuración y solicitudes…</p> : null}

        {!loading && tab === 'settings' && settings ? (
          <div className="paid-documents-content">
            <section className="paid-documents-link-card">
              <div>
                <span className="paid-documents-label">Enlace fijo para tus pacientes</span>
                <code>{buildPaidClinicalDocumentsUrl(settings.slug)}</code>
                <small>Los pacientes pueden abrirlo sin iniciar sesión en Dr Happy.</small>
              </div>
              <button type="button" className="ghost" onClick={() => void copyLink()}>
                {copyState === 'copied' ? 'Copiado' : 'Copiar enlace'}
              </button>
            </section>
            {copyState === 'error' ? <p className="paid-documents-inline-error" role="status">No se pudo copiar automáticamente. Seleccioná y copiá el enlace.</p> : null}
            <div className={`paid-documents-payment-status${settings.paymentReady ? ' connected' : ''}`}>
              <span aria-hidden="true">{settings.paymentReady ? '●' : '○'}</span>
              {settings.paymentReady
                ? 'Mercado Pago conectado: los cobros llegarán a la cuenta de este perfil.'
                : 'Conectá Mercado Pago en Perfil y ajustes para habilitar cobros.'}
            </div>
            <div className="paid-documents-professional"><span>Profesional</span><strong>{settings.professionalName}</strong></div>
            <h3>Servicios y precios</h3>
            <div className="paid-documents-service-list">
              {serviceRows.map((service) => {
                const key = service.key
                return (
                  <article className="paid-documents-service" key={key}>
                    <label className="paid-documents-switch">
                      <input type="checkbox" checked={enabled[key]} onChange={(event) => setEnabled((current) => ({ ...current, [key]: event.target.checked }))} />
                      <span>{service.label}</span>
                    </label>
                    <label className="paid-documents-price">
                      Precio (ARS)
                      <input inputMode="numeric" type="number" min="100" max="1000000" step="1" value={prices[key]} disabled={!enabled[key]}
                        onChange={(event) => setPrices((current) => ({ ...current, [key]: event.target.value }))} />
                    </label>
                    <p>{service.description}</p>
                  </article>
                )
              })}
            </div>
            <p className="paid-documents-clinical-note">El paciente paga el documento previamente acordado. La emisión y firma se realizan desde la herramienta habitual de certificados y órdenes.</p>
            <button type="button" onClick={() => void saveSettings()} disabled={saving || !settings.paymentReady}>
              {saving ? 'Guardando…' : 'Guardar configuración'}
            </button>
          </div>
        ) : null}

        {!loading && tab === 'requests' ? (
          <div className="paid-documents-requests">
            <div className="paid-documents-requests-heading">
              <p>Las solicitudes aparecen cuando Mercado Pago confirma el pago.</p>
              <button type="button" className="ghost compact" onClick={() => { void refreshRequests().catch((refreshError: unknown) => setError(refreshError instanceof Error ? refreshError.message : 'No se pudieron actualizar las solicitudes.')) }}>
                Actualizar
              </button>
            </div>
            {requests.length ? requests.map((request) => (
              <article className="paid-documents-request" key={request.id}>
                <div className="paid-documents-request-top">
                  <div>
                    <strong>{request.service_type === 'study-order' ? 'Orden de estudios' : 'Certificado médico'} · {request.requested_purpose}</strong>
                    <span>{request.patient_last_name}, {request.patient_first_name} · DNI {request.patient_dni}</span>
                  </div>
                  <span className={`paid-documents-status ${request.status}`}>{request.status === 'pending_review' ? 'Pago confirmado' : request.status === 'completed' ? 'Emitido' : request.status === 'pending_payment' ? 'Pendiente de pago' : 'Cancelado'}</span>
                </div>
                <p>{request.reason}</p>
                <div className="paid-documents-request-meta">
                  <span>{request.patient_email} · {request.patient_phone}</span>
                  <strong>{formatPrice(request.amount)}</strong>
                  <span>Recibido: {formatDate(request.paid_at || request.created_at)}</span>
                </div>
                {request.status === 'pending_review' ? (
                  <div className="paid-documents-request-actions">
                    <button type="button" onClick={() => onStartIssue(request)}>Abrir herramienta de emisión</button>
                    <button type="button" className="ghost" disabled={busyRequestId === request.id} onClick={() => void markIssued(request)}>
                      {busyRequestId === request.id ? 'Guardando…' : 'Marcar como emitido'}
                    </button>
                  </div>
                ) : null}
              </article>
            )) : <p className="paid-documents-empty">Todavía no hay solicitudes para este perfil.</p>}
          </div>
        ) : null}

        {error ? <p className="paid-documents-inline-error" role="alert">{error}</p> : null}
        {notice ? <p className="paid-documents-inline-notice" role="status">{notice}</p> : null}
        <footer className="paid-documents-footer">
          <span>Los pagos y solicitudes pertenecen al perfil activo.</span>
          <button type="button" className="ghost" onClick={onClose}>Cerrar</button>
        </footer>
      </section>
    </div>
  )
}
