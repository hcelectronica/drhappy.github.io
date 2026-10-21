import { useEffect, useState } from 'react'
import { BrandMark } from './BrandMark'
import { callReception, receptionTools } from './patientReceptionService'
import type { ReceptionResponse } from './patientReceptionService'
import './patientReception.css'

function ToolIcon({ kind }: { kind: string }) {
  const paths: Record<string, string> = {
    document: 'M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8ZM14 2v6h6M8 13h8m-8 4h5',
    studies: 'M4 3h16v18H4ZM8 8h8m-8 4h5m-5 4h8',
    calendar: 'M3 5h18v16H3ZM7 3v4m10-4v4M3 11h18m-13 5h2m4 0h2',
    video: 'M3 6h12v12H3ZM15 10l6-4v12l-6-4',
    user: 'M9 3a4 4 0 1 0 0 8 4 4 0 0 0 0-8M2 21v-2a7 7 0 0 1 14 0v2m3-12v6m-3-3h6',
  }
  return <svg viewBox="0 0 24 24" aria-hidden="true"><path d={paths[kind]} /></svg>
}
export default function PatientReception({ slug }: { slug: string }) {
  const [result, setResult] = useState<ReceptionResponse | null>(null)
  const [attempt, setAttempt] = useState(0)
  useEffect(() => {
    let cancelled = false
    callReception({ action: 'public', slug }).then(value => { if (!cancelled) setResult(value) })
      .catch(() => { if (!cancelled) setResult({ success: false, message: 'No se pudo conectar. Intentá nuevamente.' }) })
    return () => { cancelled = true }
  }, [slug, attempt])
  const reception = result?.reception
  const tools = receptionTools.filter(tool => reception?.links[tool.key])
  return <main className="reception-page">
    <div className="reception-shell">
      <div className="reception-brand"><BrandMark /><span>Dr Happy</span><small>Tu recepción digital</small></div>
      <section className="reception-card" aria-labelledby="reception-title">
        <header>
          <p className="reception-doctor">{reception?.displayName || 'Bienvenido'}</p>
          <h1 id="reception-title">¿Cómo podemos ayudarte?</h1>
          <p>Elegí lo que necesitás. Te llevamos al lugar indicado.</p>
        </header>
        {!result ? <p role="status">Abriendo recepción…</p> : !result.success || !reception ? <div role="alert">
          <p>{result.message || 'Esta recepción no está disponible.'}</p>
          <button type="button" onClick={() => { setResult(null); setAttempt(value => value + 1) }}>Volver a intentar</button>
        </div> : <nav className="reception-choices" aria-label="Opciones para pacientes">
          {tools.map(tool => <a className={`reception-choice reception-${tool.key}`} key={tool.key} href={reception.links[tool.key]}>
            <span className="reception-icon"><ToolIcon kind={tool.icon} /></span>
            <span><strong>{tool.title}</strong><small>{tool.description}</small></span>
            <span className="reception-arrow" aria-hidden="true">›</span>
          </a>)}
          {!tools.length && <p>No hay servicios disponibles en este momento. Consultá con tu profesional.</p>}
        </nav>}
      </section>
      <footer>No atiende urgencias. Ante una emergencia, acudí a una guardia o llamá al servicio local.<span>Atención virtual con revisión profesional. No es un diagnóstico automático.</span></footer>
    </div>
  </main>
}
