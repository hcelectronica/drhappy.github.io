import { useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import { formatBytes, formatDate, openPatientShare, patientCategoryMeta } from './patientFolderService'
import type { BpReading, SharedDocument } from './patientFolderService'
import { BpDoctorSummary } from './BloodPressure'
import './PatientPortal.css'

// Página pública para el médico externo: link temporal + código de 6 números que le da el paciente.
export default function SharedFolderPage({ token }: { token: string }) {
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [data, setData] = useState<{ patientName: string; birthDate: string | null; expiresAt: string; documents: SharedDocument[]; pressure: BpReading[]; loadedAt: number; ttl: number } | null>(null)
  const [gone, setGone] = useState(false)

  useEffect(() => {
    document.title = 'Estudios compartidos | Dr Happy'
    const robots = document.createElement('meta')
    robots.name = 'robots'
    robots.content = 'noindex, nofollow'
    document.head.appendChild(robots)
    return () => robots.remove()
  }, [])

  async function load(event?: FormEvent) {
    event?.preventDefault()
    if (busy || code.length !== 6) return
    setBusy(true)
    setError('')
    const result = await openPatientShare(token, code)
    setBusy(false)
    if (!result.success) {
      if (result.step !== 'code') setGone(true)
      return setError(result.message || 'No se pudo abrir.')
    }
    setData({
      patientName: result.patientName ?? '',
      birthDate: result.birthDate ?? null,
      expiresAt: result.expiresAt ?? '',
      documents: result.documents ?? [],
      pressure: result.pressure ?? [],
      loadedAt: Date.now(),
      ttl: (result.urlTtlSeconds ?? 600) * 1000,
    })
  }

  function openDoc(url: string | undefined) {
    if (!url || !data) return
    if (Date.now() - data.loadedAt > data.ttl - 30000) {
      setError('Por seguridad los accesos se renuevan cada 10 minutos. Tocá “Actualizar” y volvé a abrir el estudio.')
      return
    }
    window.open(url, '_blank', 'noopener')
  }

  return (
    <main className="pp-auth pp-shared">
      <div className="pp-brand">
        <img src="/brand-mark.svg" alt="" width={40} height={40} />
        <div><strong>Estudios compartidos</strong><span>Mi Carpeta de Salud · Dr Happy</span></div>
      </div>

      {!data && (
        <form className="pp-card pp-form" onSubmit={load}>
          <h1>{gone ? 'Link no disponible' : 'Ingresá el código'}</h1>
          {gone
            ? <p className="pp-muted">{error}</p>
            : (
              <>
                <p className="pp-muted">El paciente te compartió sus estudios. Pedile el código de 6 números que le aparece en su app.</p>
                <label>Código
                  <input className="pp-code" value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))} inputMode="numeric" autoComplete="one-time-code" required minLength={6} maxLength={6} autoFocus />
                </label>
                {error && <p className="pp-error" role="alert">{error}</p>}
                <button className="pp-primary" type="submit" disabled={busy || code.length !== 6}>{busy ? 'Abriendo…' : 'Ver estudios'}</button>
              </>
            )}
        </form>
      )}

      {data && (
        <section className="pp-card">
          <h1>{data.patientName}</h1>
          <p className="pp-muted">
            {data.birthDate ? `Nacimiento: ${formatDate(data.birthDate)} · ` : ''}
            Acceso válido hasta el {new Date(data.expiresAt).toLocaleDateString('es-AR')}
          </p>
          {error && <p className="pp-error" role="alert">{error}</p>}
          {!data.documents.length && <p className="pp-empty">{data.pressure.length ? 'El paciente no compartió estudios.' : 'El paciente todavía no tiene estudios en lo que compartió.'}</p>}
          <ul className="pp-docs">
            {data.documents.map((doc) => {
              const info = patientCategoryMeta(doc.category)
              return (
                <li key={doc.id} className="pp-doc">
                  <span className="pp-doc-icon" aria-hidden>{doc.mimeType === 'application/pdf' ? '📄' : info.icon}</span>
                  <div className="pp-doc-body">
                    <strong>{doc.title}</strong>
                    <span>{info.label} · {formatDate(doc.studyDate)} · {formatBytes(doc.sizeBytes)}</span>
                    {doc.notes && <em>{doc.notes}</em>}
                  </div>
                  <div className="pp-doc-actions">
                    <button type="button" onClick={() => openDoc(doc.url)}>Ver</button>
                    <button type="button" onClick={() => openDoc(doc.downloadUrl)} aria-label="Descargar">⬇</button>
                  </div>
                </li>
              )
            })}
          </ul>
          <button type="button" className="pp-link-btn" onClick={() => void load()} disabled={busy}>{busy ? 'Actualizando…' : 'Actualizar'}</button>
        </section>
      )}

      {data && data.pressure.length > 0 && (
        <section className="pp-card">
          <h2>❤️ Presión arterial en casa</h2>
          <BpDoctorSummary readings={data.pressure} />
        </section>
      )}

      <aside className="pp-promo">
        <strong>¿Sos médico/a?</strong>
        <p>Con <b>Dr Happy</b> tus pacientes te comparten sus estudios directo en su ficha. Historia clínica, recetas, turnos y videoconsulta en un solo lugar.</p>
        <a className="pp-primary" href="/">Conocé Dr Happy — probalo gratis</a>
      </aside>
    </main>
  )
}
