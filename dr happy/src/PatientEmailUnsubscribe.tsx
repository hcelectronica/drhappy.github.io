import { useState } from 'react'
import { callPatientCommunications } from './patientCommunicationsService'

export function PatientEmailUnsubscribe({ token }: { token: string }) {
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState(false)
  const [error, setError] = useState('')
  async function unsubscribe() {
    setBusy(true); setError('')
    const result = await callPatientCommunications({ action: 'unsubscribe', token })
    setBusy(false)
    if (!result.success) { setError(result.message || 'No se pudo confirmar la baja.'); return }
    setDone(true)
  }
  return <main className="pp-auth"><section className="pp-card">
    <h1>Novedades de Dr Happy</h1>
    <p>{done ? 'Listo. Ya no recibirás estas invitaciones y novedades por email.' : 'Podés dejar de recibir invitaciones y novedades. No afecta tu atención, tu cuenta ni los avisos de seguridad.'}</p>
    {!done && <button type="button" className="pp-primary" disabled={busy} onClick={() => void unsubscribe()}>{busy ? 'Confirmando…' : 'Confirmar baja de novedades'}</button>}
    {error && <p className="pp-error" role="alert">{error}</p>}
    <p><a href="/paciente">Volver a Mi Carpeta de Salud</a></p>
  </section></main>
}
