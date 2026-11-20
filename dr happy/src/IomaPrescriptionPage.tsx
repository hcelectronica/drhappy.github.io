import { useEffect, useState } from 'react'
import { BrandMark } from './BrandMark'
import { callIoma } from './iomaPrescriptionService'
import type { IomaResponse } from './iomaPrescriptionService'
import './patientReception.css'
import './iomaPrescription.css'

const today = new Date().toISOString().slice(0, 10)

export default function IomaPrescriptionPage({ slug }: { slug: string }) {
  const [info, setInfo] = useState<IomaResponse | null>(null)
  const [attempt, setAttempt] = useState(0)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [submitted, setSubmitted] = useState<IomaResponse | null>(null)
  useEffect(() => {
    let active = true
    callIoma({ action: 'public-info', slug }).then(result => { if (active) setInfo(result) })
    return () => { active = false }
  }, [slug, attempt])
  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (busy) return
    const form = event.currentTarget
    const data = new FormData(form)
    const text = (name: string) => String(data.get(name) || '').trim()
    if (text('patientPhone').replace(/\D/g, '').length < 8) { setError('Ingresá un teléfono con al menos 8 dígitos.'); return }
    setBusy(true); setError('')
    try {
      const result = await callIoma({
        action: 'submit', slug, patientFirstName: text('patientFirstName'), patientLastName: text('patientLastName'),
        patientDni: text('patientDni'), patientEmail: text('patientEmail'), patientPhone: text('patientPhone'),
        birthDate: text('birthDate'), insuranceMemberNumber: text('insuranceMemberNumber'), medication: text('medication'),
        consent: data.get('consent') === 'on', website: text('website'),
      })
      if (!result.success) { setError(result.message || 'No se pudo enviar la solicitud.'); return }
      form.reset()
      setSubmitted(result)
    } catch {
      setError('No se pudo confirmar el envío. Contactá al consultorio antes de volver a enviar para evitar duplicados.')
    } finally { setBusy(false) }
  }
  return <main className="reception-page"><div className="reception-shell">
    <div className="reception-brand"><BrandMark /><span>Dr Happy</span><small>Solicitud I.O.M.A.</small></div>
    <section className="reception-card ioma-page">
      <header><p className="reception-doctor">{info?.professionalName || 'Recepción'}</p><h1>RECETA I.O.M.A</h1>
        <p>Solicitud sin arancel. La receta se gestiona por fuera de este formulario, según criterio profesional.</p></header>
      {!info ? <p role="status">Cargando…</p> : !info.success ? <div role="alert"><p>{info.message || 'No se pudo cargar el servicio.'}</p><button type="button" onClick={() => { setInfo(null); setAttempt(value => value + 1) }}>Reintentar</button></div>
        : !info.enabled ? <p>Esta solicitud no está habilitada. Consultá con tu profesional.</p>
          : submitted ? <div role="status"><p>Solicitud enviada al servicio.</p>
            <p>{submitted.emailSent === true ? 'Se informó el envío de la notificación por correo.' : 'No se confirmó el envío de la notificación por correo. Contactá al consultorio para verificar la recepción; no vuelvas a enviar la solicitud sin consultarlo.'}</p>
            <p>La atención y la receta dependen de la revisión del profesional.</p></div>
            : <form onSubmit={submit}>
              {error && <p className="ioma-error" role="alert">{error}</p>}
              <fieldset disabled={busy}>
                <div className="ioma-grid">
                  <label>Nombre<input name="patientFirstName" autoComplete="given-name" maxLength={80} required /></label>
                  <label>Apellido<input name="patientLastName" autoComplete="family-name" maxLength={80} required /></label>
                  <label>DNI<input name="patientDni" inputMode="numeric" pattern="[0-9]{6,9}" maxLength={9} required /></label>
                  <label>Fecha de nacimiento<input name="birthDate" type="date" min="1900-01-01" max={today} required /></label>
                  <label>Email<input name="patientEmail" type="email" autoComplete="email" maxLength={160} required /></label>
                  <label>Teléfono<input name="patientPhone" type="tel" autoComplete="tel" maxLength={30} required /></label>
                  <label>Obra social<input value="I.O.M.A." readOnly /></label>
                  <label>Número de afiliado<input name="insuranceMemberNumber" maxLength={80} required /></label>
                </div>
                <label>Medicación solicitada<textarea name="medication" rows={4} minLength={2} maxLength={2000} required /></label>
                <label className="ioma-consent"><input name="consent" type="checkbox" required /> Autorizo el envío de mis datos y medicación al profesional para gestionar esta solicitud.</label>
                <label className="ioma-honeypot" aria-hidden="true">Sitio web<input name="website" tabIndex={-1} autoComplete="off" /></label>
                <button type="submit">{busy ? 'Enviando…' : 'Enviar solicitud'}</button>
              </fieldset>
            </form>}
    </section>
    <footer>No atiende urgencias. Ante una emergencia, acudí a una guardia o llamá al servicio local.</footer>
  </div></main>
}
