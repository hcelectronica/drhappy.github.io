import { useEffect, useState } from 'react'
import {
  getPaidClinicalDocumentStatus,
  getPublicPaidClinicalDocuments,
  submitPaidClinicalDocumentRequest,
} from './paidClinicalDocumentsService'
import type {
  PaidClinicalDocumentSettings,
} from './paidClinicalDocumentsService'
import './PaidClinicalDocumentsPublicPage.css'

interface PublicDocumentStatus {
  status: 'pending_payment' | 'pending_review' | 'completed' | 'cancelled'
  paymentStatus: string
  paymentUrl: string
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
          if (!result.success || !result.service) throw new Error(result.message || 'Este enlace no está disponible.')
          if (!cancelled) {
            setSettings({
              slug,
              professionalName: result.professionalName || 'Profesional',
              service: result.service,
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

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault()
    if (!settings?.service.enabled) return
    setSubmitting(true)
    setError(null)
    try {
      const result = await submitPaidClinicalDocumentRequest({
        slug: settings.slug,
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
    ? status.status === 'completed' ? 'Solicitud respondida' : status.status === 'pending_review' ? 'Pago confirmado' : status.status === 'pending_payment' ? 'Pago pendiente' : 'Solicitud no completada'
    : 'Solicitá una evaluación profesional'

  return (
    <main className="paid-document-public">
      <section className="paid-document-public-card">
        <div className="paid-document-public-brand">
          <span aria-hidden="true">Dr.H</span>
          <div><strong>Dr Happy</strong><small>Atención profesional</small></div>
        </div>
        <span className="paid-document-public-kicker">{status ? 'Seguimiento de solicitud' : 'Solicitud profesional'}</span>
        <h1>{title}</h1>

        {loading ? <p className="paid-document-public-muted">Cargando…</p> : null}

        {!loading && status ? (
          <section className={`paid-document-public-status ${status.status}`} aria-live="polite">
            <strong>{status.professionalName}</strong>
            <p>
              {status.status === 'pending_payment'
                ? 'Estamos esperando la confirmación del pago. La solicitud se enviará al profesional cuando Mercado Pago lo confirme.'
                : status.status === 'pending_review'
                  ? 'Mercado Pago confirmó el pago y el profesional recibió tu solicitud. Revisará el motivo y te responderá por correo con el documento que corresponda.'
                  : status.status === 'completed'
                    ? 'El profesional indicó que respondió tu solicitud. Revisá el correo que informaste, incluida la carpeta de correo no deseado.'
                    : 'No se completó el pago, por eso no se envió la solicitud.'}
            </p>
            <div className="paid-document-public-status-detail">
              <span>Importe de la solicitud</span>
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
              Profesional: <strong>{settings.professionalName}</strong>. Completá tus datos y contá qué necesitás. El profesional evaluará el motivo y definirá la respuesta o el documento indicado.
            </p>
            <p className="paid-document-public-fee">Importe único de la solicitud: <strong>{formatPrice(settings.service.price)}</strong></p>
            <form className="paid-document-public-form" onSubmit={(event) => void handleSubmit(event)}>
              <div className="paid-document-public-two-col">
                <label>Nombre<input autoComplete="given-name" maxLength={80} value={patientFirstName} onChange={(event) => setPatientFirstName(event.target.value)} required /></label>
                <label>Apellido<input autoComplete="family-name" maxLength={80} value={patientLastName} onChange={(event) => setPatientLastName(event.target.value)} required /></label>
                <label>DNI<input inputMode="numeric" autoComplete="off" maxLength={9} value={patientDni} onChange={(event) => setPatientDni(event.target.value.replace(/\D/g, ''))} required /></label>
                <label>Fecha de nacimiento (opcional)<input type="date" max={new Date().toISOString().slice(0, 10)} value={birthDate} onChange={(event) => setBirthDate(event.target.value)} /></label>
                <label>Email<input type="email" autoComplete="email" maxLength={160} value={patientEmail} onChange={(event) => setPatientEmail(event.target.value)} required /></label>
                <label>Teléfono<input type="tel" autoComplete="tel" maxLength={30} value={patientPhone} onChange={(event) => setPatientPhone(event.target.value)} required /></label>
              </div>
              <label>Motivo de solicitud
                <textarea rows={4} maxLength={2000} value={reason} onChange={(event) => setReason(event.target.value)} required />
              </label>
              <label className="paid-document-public-consent">
                <input type="checkbox" checked={consent} onChange={(event) => setConsent(event.target.checked)} required />
                <span>Autorizo que mis datos y el motivo informado se envíen al profesional seleccionado para gestionar mi solicitud de atención.</span>
              </label>
              <label className="paid-document-public-honeypot" aria-hidden="true">Sitio web<input tabIndex={-1} autoComplete="off" value={website} onChange={(event) => setWebsite(event.target.value)} /></label>
              <button className="paid-document-public-submit" type="submit" disabled={submitting || !settings.service.enabled || !settings.paymentReady}>
                {submitting ? 'Enviando solicitud…' : 'Enviar solicitud'}
              </button>
              <p className="paid-document-public-terms">Al enviar, continuarás a Mercado Pago para abonar el importe único. La solicitud llegará al profesional cuando se confirme el pago; el profesional revisará el motivo y te responderá por correo. No cargues información de urgencia por este medio.</p>
            </form>
          </>
        ) : null}

        {error ? <p className="paid-document-public-error" role="alert">{error}</p> : null}
        <footer className="paid-document-public-footer">Pago seguro procesado por Mercado Pago · Datos enviados al profesional de este enlace</footer>
      </section>
    </main>
  )
}
