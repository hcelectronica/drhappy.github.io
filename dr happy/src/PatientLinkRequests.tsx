import { useEffect, useState } from 'react'
import { callPatientFolder } from './patientFolderService'
import type { PatientLinkRequest } from './patientFolderService'

// Médicos que ya tienen agendado al paciente (por DNI) y esperan que les comparta la carpeta.
export default function PatientLinkRequests({ onToast }: { onToast: (message: string) => void }) {
  const [requests, setRequests] = useState<PatientLinkRequest[]>([])
  const [busyId, setBusyId] = useState('')
  const [error, setError] = useState('')
  const [glucose, setGlucose] = useState<Record<string, boolean>>({})

  useEffect(() => {
    let cancelled = false
    void callPatientFolder({ action: 'link-requests' }).then((result) => {
      if (!cancelled && result.success) setRequests(result.requests ?? [])
    })
    return () => { cancelled = true }
  }, [])

  if (!requests.length) return null

  async function respond(request: PatientLinkRequest, accept: boolean) {
    setBusyId(request.id)
    setError('')
    const result = await callPatientFolder({ action: 'link-respond', requestId: request.id, accept, includeGlucose: glucose[request.id] === true })
    setBusyId('')
    if (!result.success) {
      setError(result.message || 'No se pudo responder. Intentá de nuevo.')
      return
    }
    setRequests((current) => current.filter((item) => item.id !== request.id))
    onToast(accept ? `Listo, ${doctorLabel(request)} ya puede ver tu carpeta ✔` : 'Listo, no compartimos tu carpeta.')
  }

  return (
    <section className="pp-link-requests" aria-label="Pedidos de tus médicos">
      {requests.map((request) => (
        <article key={request.id} className="pp-card pp-link-request">
          <span className="pp-link-request-icon" aria-hidden>🩺</span>
          <div>
            <h2>{doctorLabel(request)}{request.doctorSpecialty ? <small> · {request.doctorSpecialty}</small> : null}</h2>
            <p>
              {request.source === 'doctor_request'
                ? 'Te tiene como paciente y te pide ver tu carpeta.'
                : 'Te tiene registrado como paciente en Dr Happy.'}
              {' '}¿Querés compartirle tus estudios y tu registro de presión?
            </p>
            <p className="pp-muted">Lo va a ver en tu ficha. Podés dejar de compartir cuando quieras desde “Compartir con mi médico”.</p>
            <label className="pp-check"><input type="checkbox" checked={glucose[request.id] === true} onChange={e => setGlucose(current => ({ ...current, [request.id]: e.target.checked }))} /> Incluir glucosa y tratamiento de diabetes (también futuras actualizaciones)</label>
            <div className="pp-row">
              <button type="button" className="pp-secondary" disabled={busyId === request.id} onClick={() => void respond(request, false)}>Ahora no</button>
              <button type="button" className="pp-primary" disabled={busyId === request.id} onClick={() => void respond(request, true)}>
                {busyId === request.id ? 'Un momento…' : 'Compartir'}
              </button>
            </div>
          </div>
        </article>
      ))}
      {error && <p className="pp-error" role="alert">{error}</p>}
    </section>
  )
}

function doctorLabel(request: PatientLinkRequest): string {
  return request.doctorName || 'Tu médico'
}
