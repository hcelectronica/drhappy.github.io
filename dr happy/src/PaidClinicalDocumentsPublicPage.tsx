import { useEffect, useState } from 'react'
import {
  getPaidClinicalDocumentStatus,
  getPublicPaidClinicalDocuments,
  submitPaidClinicalDocumentRequest,
} from './paidClinicalDocumentsService'
import type {
  PaidClinicalDocumentSettings,
  PaidClinicalDocumentType,
} from './paidClinicalDocumentsService'
import './PaidClinicalDocumentsPublicPage.css'

interface PublicDocumentStatus {
  status: 'pending_payment' | 'pending_review' | 'completed' | 'cancelled'
  paymentStatus: string
  paymentUrl: string
  serviceType: PaidClinicalDocumentType
  purpose: string
  amount: number
  professionalName: string
  createdAt: string
}

function getPublicSlug(): string {
  const pathSlug = window.location.pathname.match(/^\/documentos\/([a-z0-9-]+)\/?$/i)?.[1]
  return pathSlug || new URLSearchParams(window.location.search).get('paid_documents_slug') || ''
}

function formatPrice(amount: number): string {
  return `$${amount.toLocaleString('es-AR')}`
}

export function PaidClinicalDocumentsPublicPage() {
  const slug = getPublicSlug()
  const trackingToken = new URLSearchParams(window.location.search).get('s') || ''
  const [settings, setSettings] = useState<PaidClinicalDocumentSettings | null>(null)
  const [status, setStatus] = useState<PublicDocumentStatus | null>(null)
  const [serviceType, setServiceType] = useState<PaidClinicalDocumentType>('certificate')
  const [purpose, setPurpose] = useState('')
  const [patientFirstName, setPatientFirstName] = useState('')
  const [patientLastName, setPatientLastName] = useState('')
  const [patientDni, setPatientDni] = useState('')
  const [patientEmail, setPatientEmail] = useState('')
  const [patientPhone, setPatientPhone] = useState('')
  const [birthDate, setBirthDate] = useState('')
  const [reason, setReason] = useState('')
  const [consent, setConsent] = useState(false)
  const [website, setWebsite] = useState('')
  const [loading, setLoading] = useState(Boolean(slug || trackingToken))
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(() => (
    !slug && !trackingToken ? 'El enlace de solicitud no es válido.' : null
  ))

  useEffect(() => {
    let cancelled = false
    async function load(): Promise<void> {
      try {
        if (trackingToken) {
          const result = await getPaidClinicalDocumentStatus(trackingToken)
          if (!result.success || !result.request) throw new Error(result.message || 'No se encontró el estado de la solicitud.')
          if (!cancelled) setStatus(result.request)
        } else {
          const result = await getPublicPaidClinicalDocuments(slug)
          if (!result.success || !result.services) throw new Error(result.message || 'Este enlace no está disponible.')
          if (!cancelled) {
            setSettings({
              slug,
              professionalName: result.professionalName || 'Profesional',
              services: result.services,
              paymentReady: result.paymentReady === true,
            })
          }
          if (!result.paymentReady) throw new Error('El profesional todavía no habilitó los cobros en línea. No completes ningún pago.')
        }
      } catch (loadError) {
        if (!cancelled) setError(loadError instanceof Error ? loadError.message : 'No se pudo cargar el enlace.')
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    if (!slug && !trackingToken) return
    void load()
    return () => { cancelled = true }
  }, [slug, trackingToken])

  useEffect(() => {
    if (!trackingToken || status?.status !== 'pending_payment') return
    const intervalId = window.setInterval(() => {
      void getPaidClinicalDocumentStatus(trackingToken).then((result) => {
        if (result.success && result.request) setStatus(result.request)
      })
    }, 5000)
    return () => window.clearInterval(intervalId)
  }, [trackingToken, status?.status])

  const effectiveServiceType = settings && (
    serviceType === 'certificate' ? settings.services.certificate.enabled : settings.services.studyOrder.enabled
  )
    ? serviceType
    : settings?.services.certificate.enabled ? 'certificate' : 'study-order'
  const selectedService = effectiveServiceType === 'certificate' ? settings?.services.certificate : settings?.services.studyOrder

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault()
    if (!settings || !selectedService?.enabled) return
    setSubmitting(true)
    setError(null)
    try {
      const result = await submitPaidClinicalDocumentRequest({
        slug: settings.slug,
        serviceType: effectiveServiceType,
        purpose,
        patientFirstName,
        patientLastName,
        patientDni,
        patientEmail,
        patientPhone,
        birthDate,
        reason,
        consent,
        website,
      })
      if (!result.success || !result.paymentUrl) throw new Error(result.message || 'No se pudo preparar el pago.')
      window.location.assign(result.paymentUrl)
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : 'No se pudo enviar la solicitud.')
      setSubmitting(false)
    }
  }

  const title = status
    ? status.status === 'completed' ? 'Solicitud emitida' : status.status === 'pending_review' ? 'Pago confirmado' : status.status === 'pending_payment' ? 'Pago pendiente' : 'Solicitud no completada'
    : 'Solicitá tu documento médico'

  return (
    <main className="paid-document-public">
      <section className="paid-document-public-card">
        <div className="paid-document-public-brand">
          <span aria-hidden="true">Dr.H</span>
          <div><strong>Dr Happy</strong><small>Atención profesional</small></div>
        </div>
        <span className="paid-document-public-kicker">{status ? 'Seguimiento de solicitud' : 'Certificados y estudios'}</span>
        <h1>{title}</h1>

        {loading ? <p className="paid-document-public-muted">Cargando…</p> : null}

        {!loading && status ? (
          <section className={`paid-document-public-status ${status.status}`} aria-live="polite">
            <strong>{status.professionalName}</strong>
            <p>
              {status.status === 'pending_payment'
                ? 'Estamos esperando la confirmación del pago. La solicitud se enviará al profesional cuando Mercado Pago lo confirme.'
                : status.status === 'pending_review'
                  ? 'Mercado Pago confirmó el pago. El profesional recibió tu solicitud y preparará el documento acordado.'
                  : status.status === 'completed'
                    ? 'El profesional indicó que el documento fue emitido. Revisá tu correo o contactá al consultorio para recibirlo.'
                    : 'No se completó el pago, por eso no se envió la solicitud.'}
            </p>
            <div className="paid-document-public-status-detail">
              <span>{status.serviceType === 'study-order' ? 'Orden de estudios' : 'Certificado médico'} · {status.purpose}</span>
              <strong>{formatPrice(status.amount)}</strong>
            </div>
            {status.status === 'pending_payment' && status.paymentUrl
              ? <a className="paid-document-public-submit" href={status.paymentUrl}>Continuar al pago</a>
              : null}
          </section>
        ) : null}

        {!loading && !status && settings ? (
          <>
            <p className="paid-document-public-intro">
              Profesional: <strong>{settings.professionalName}</strong>. Completá tus datos y el profesional recibirá tu solicitud después de acreditarse el pago.
            </p>
            <form className="paid-document-public-form" onSubmit={(event) => void handleSubmit(event)}>
              <fieldset className="paid-document-type-options">
                <legend>¿Qué documento necesitás?</legend>
                {settings.services.certificate.enabled ? (
                  <label>
                    <input type="radio" name="serviceType" checked={effectiveServiceType === 'certificate'} onChange={() => { setServiceType('certificate'); setPurpose('') }} />
                    <span><strong>Certificado médico</strong><small>{formatPrice(settings.services.certificate.price)}</small></span>
                  </label>
                ) : null}
                {settings.services.studyOrder.enabled ? (
                  <label>
                    <input type="radio" name="serviceType" checked={effectiveServiceType === 'study-order'} onChange={() => { setServiceType('study-order'); setPurpose('') }} />
                    <span><strong>Orden de estudios</strong><small>{formatPrice(settings.services.studyOrder.price)}</small></span>
                  </label>
                ) : null}
              </fieldset>

              <label className="paid-document-purpose">
                Tipo de {effectiveServiceType === 'certificate' ? 'certificado' : 'orden'}
                <select value={purpose} onChange={(event) => setPurpose(event.target.value)} required>
                  <option value="">Seleccioná una opción</option>
                  {effectiveServiceType === 'certificate' ? (
                    <>
                      <option value="Apto físico">Apto físico</option>
                      <option value="Justificativo laboral">Justificativo laboral</option>
                      <option value="Otro certificado acordado">Otro certificado acordado</option>
                    </>
                  ) : (
                    <option value="Orden de estudios acordada">Orden de estudios acordada</option>
                  )}
                </select>
              </label>

              <div className="paid-document-public-two-col">
                <label>Nombre<input autoComplete="given-name" maxLength={80} value={patientFirstName} onChange={(event) => setPatientFirstName(event.target.value)} required /></label>
                <label>Apellido<input autoComplete="family-name" maxLength={80} value={patientLastName} onChange={(event) => setPatientLastName(event.target.value)} required /></label>
                <label>DNI<input inputMode="numeric" autoComplete="off" maxLength={9} value={patientDni} onChange={(event) => setPatientDni(event.target.value.replace(/\D/g, ''))} required /></label>
                <label>Fecha de nacimiento (opcional)<input type="date" max={new Date().toISOString().slice(0, 10)} value={birthDate} onChange={(event) => setBirthDate(event.target.value)} /></label>
                <label>Email<input type="email" autoComplete="email" maxLength={160} value={patientEmail} onChange={(event) => setPatientEmail(event.target.value)} required /></label>
                <label>Teléfono<input type="tel" autoComplete="tel" maxLength={30} value={patientPhone} onChange={(event) => setPatientPhone(event.target.value)} required /></label>
              </div>
              <label>Motivo acordado con el profesional
                <textarea rows={4} maxLength={2000} value={reason} onChange={(event) => setReason(event.target.value)} required />
              </label>
              <label className="paid-document-public-consent">
                <input type="checkbox" checked={consent} onChange={(event) => setConsent(event.target.checked)} required />
                <span>Autorizo que mis datos y el motivo informado se envíen al profesional seleccionado y se incorporen a mi ficha clínica para gestionar el documento solicitado.</span>
              </label>
              <label className="paid-document-public-honeypot" aria-hidden="true">Sitio web<input tabIndex={-1} autoComplete="off" value={website} onChange={(event) => setWebsite(event.target.value)} /></label>
              <button className="paid-document-public-submit" type="submit" disabled={submitting || !selectedService?.enabled || !settings.paymentReady}>
                {submitting ? 'Conectando con Mercado Pago…' : `Pagar ${selectedService ? formatPrice(selectedService.price) : ''} con Mercado Pago`}
              </button>
              <p className="paid-document-public-terms">El documento se emite con la herramienta clínica del profesional luego de confirmarse el pago. No cargues información de urgencia por este medio.</p>
            </form>
          </>
        ) : null}

        {error ? <p className="paid-document-public-error" role="alert">{error}</p> : null}
        <footer className="paid-document-public-footer">Pago seguro procesado por Mercado Pago · Datos enviados al profesional de este enlace</footer>
      </section>
    </main>
  )
}
