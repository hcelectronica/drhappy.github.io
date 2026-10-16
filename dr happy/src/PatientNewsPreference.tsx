import { useEffect, useState } from 'react'
import { callPatientFolder } from './patientFolderService'

export function PatientNewsPreference() {
  const [enabled, setEnabled] = useState<boolean | null>(null)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  useEffect(() => {
    let cancelled = false
    void callPatientFolder({ action: 'news-preference' }).then(result => {
      if (cancelled) return
      if (!result.success) { setError(result.message || 'No se pudo consultar tu preferencia de novedades.'); return }
      setEnabled(result.newsEnabled === true)
    })
    return () => { cancelled = true }
  }, [])
  async function save() {
    setBusy(true); setError(''); setMessage('')
    const result = await callPatientFolder({ action: 'news-preference-save', enabled: !enabled })
    setBusy(false)
    if (!result.success) { setError(result.message || 'No se pudo guardar tu preferencia.'); return }
    setEnabled(result.newsEnabled === true)
    setMessage(result.newsEnabled ? 'Aceptaste recibir novedades. Podés darte de baja cuando quieras.' : 'Ya no vas a recibir estas invitaciones y novedades.')
  }
  return <section className="pp-card">
    <h2>Novedades para tu salud</h2>
    <p>Si querés, Dr Happy puede enviarte por email información sobre funciones de la app y servicios de profesionales, algunos pagos. Es opcional: no afecta tu atención ni comparte tus datos clínicos.</p>
    {enabled !== null && <button className="pp-secondary" type="button" disabled={busy} onClick={() => void save()}>
      {busy ? 'Guardando…' : enabled ? 'Dejar de recibir novedades' : 'Quiero recibir novedades por email'}
    </button>}
    {message && <p role="status">{message}</p>}
    {error && <p className="pp-error" role="alert">{error}</p>}
  </section>
}
