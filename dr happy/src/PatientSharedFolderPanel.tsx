import { useEffect, useState } from 'react'
import {
  formatBytes,
  formatDate,
  getDoctorSharedDocumentUrl,
  loadDoctorSharedFolders,
  patientCategoryMeta,
  requestPatientFolderAccess,
  type DoctorCarpetaStatus,
  type DoctorSharedFolder,
} from './patientFolderService'
import { BpDoctorSummary } from './BloodPressure'

// Estudios que el paciente compartió desde su Carpeta de Salud. Se consultan en vivo: si revoca, desaparecen.
export default function PatientSharedFolderPanel({ dni }: { dni: string }) {
  const cleanDni = dni.replace(/\D/g, '')
  const [folders, setFolders] = useState<DoctorSharedFolder[]>([])
  const [error, setError] = useState('')
  const [busyId, setBusyId] = useState('')
  const [notice, setNotice] = useState('')
  const [carpeta, setCarpeta] = useState<DoctorCarpetaStatus | null>(null)
  const [requesting, setRequesting] = useState(false)

  useEffect(() => {
    let cancelled = false
    if (cleanDni.length < 6) return
    void loadDoctorSharedFolders(cleanDni).then((result) => {
      if (cancelled) return
      if (!result.success) return
      setFolders(result.folders ?? [])
      setCarpeta(result.carpeta ?? null)
    })
    return () => { cancelled = true }
  }, [cleanDni])

  async function requestAccess() {
    setRequesting(true)
    setError('')
    const result = await requestPatientFolderAccess(cleanDni)
    setRequesting(false)
    if (!result.success) {
      setError(result.message || 'No se pudo enviar el pedido.')
      return
    }
    setCarpeta({ hasAccount: true, status: 'pending', canRequest: false })
  }

  if (!folders.length) {
    if (!carpeta?.hasAccount) return null
    return (
      <section className="patient-form-block paper-record-block">
        <h4 className="block-title">📁 Este paciente tiene Carpeta de Salud</h4>
        {carpeta.status === 'pending' ? (
          <p className="paper-record-meta">⏳ Le pediste acceso. Cuando lo acepte desde su app, vas a ver acá sus estudios y su registro de presión.</p>
        ) : carpeta.status === 'declined' ? (
          <p className="paper-record-meta">El paciente prefirió no compartir su carpeta por ahora. Vas a poder volver a pedirlo en unos días.</p>
        ) : (
          <>
            <p className="paper-record-meta">Guarda sus estudios y controles de presión en la app Mi Carpeta de Salud. Pedile acceso y le llega el aviso para aceptarlo con un toque.</p>
            <div className="paper-record-buttons">
              <button type="button" className="primary compact" disabled={requesting || !carpeta.canRequest} onClick={() => void requestAccess()}>
                {requesting ? 'Enviando…' : 'Pedirle acceso'}
              </button>
            </div>
          </>
        )}
        {error ? <p className="access-note">{error}</p> : null}
      </section>
    )
  }

  async function openDocument(shareId: string, documentId: string, download: boolean) {
    setBusyId(documentId)
    setError('')
    const popup = download ? null : window.open('', '_blank')
    const result = await getDoctorSharedDocumentUrl(shareId, documentId, download)
    setBusyId('')
    if (!result.success || !result.url) {
      popup?.close()
      setError(result.message || 'No se pudo abrir el estudio.')
      return
    }
    if (popup) popup.location.replace(result.url)
    else window.location.assign(result.url)
  }

  return (
    <section className="patient-form-block paper-record-block">
      <h4 className="block-title">📂 Carpeta de Salud compartida por el paciente</h4>
      <p className="paper-record-meta">El paciente te compartió estos estudios desde su app. Si deja de compartirlos, dejarán de verse acá.</p>
      {error ? <p className="access-note">{error}</p> : null}
      {notice ? <p className="access-note">{notice}</p> : null}
      {folders.map((folder) => (
        <details key={folder.shareId} className="patient-documents-folder" open>
          <summary>{folder.patientName} · compartido el {formatDate(folder.sharedAt)} ({folder.documents.length})</summary>
          {folder.pressure?.length ? (
            <details className="patient-documents-folder" open>
              <summary>❤️ Presión arterial en casa ({folder.pressure.length} {folder.pressure.length === 1 ? 'toma' : 'tomas'})</summary>
              <BpDoctorSummary readings={folder.pressure} onCopy={setNotice} />
            </details>
          ) : null}
          {folder.documents.length === 0 ? <p className="paper-record-meta">{folder.pressure?.length ? 'No compartió estudios, solo su registro de presión.' : 'La carpeta todavía no tiene estudios.'}</p> : (
            <ul className="paper-record-list">
              {folder.documents.map((document) => {
                const meta = patientCategoryMeta(document.category)
                return (
                  <li key={document.id} className="paper-record-item">
                    <div className="paper-record-body">
                      <strong>{meta.icon} {document.title}{document.studyDate ? ` — ${formatDate(document.studyDate)}` : ''}</strong>
                      <span className="paper-record-meta">
                        {meta.label} · {document.mimeType === 'application/pdf' ? 'PDF' : 'Imagen'} · {formatBytes(document.sizeBytes)}
                      </span>
                      {document.notes ? <span className="paper-record-meta">{document.notes}</span> : null}
                      <div className="paper-record-buttons">
                        <button type="button" className="ghost compact" disabled={busyId === document.id} onClick={() => void openDocument(folder.shareId, document.id, false)}>
                          {busyId === document.id ? 'Abriendo…' : 'Ver'}
                        </button>
                        <button type="button" className="ghost compact" disabled={busyId === document.id} onClick={() => void openDocument(folder.shareId, document.id, true)}>Descargar</button>
                      </div>
                    </div>
                  </li>
                )
              })}
            </ul>
          )}
        </details>
      ))}
    </section>
  )
}
