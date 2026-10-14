import { useEffect, useState } from 'react'
import {
  formatBytes,
  formatDate,
  getDoctorSharedDocumentUrl,
  loadDoctorSharedFolders,
  patientCategoryMeta,
  type DoctorSharedFolder,
} from './patientFolderService'

// Estudios que el paciente compartió desde su Carpeta de Salud. Se consultan en vivo: si revoca, desaparecen.
export default function PatientSharedFolderPanel({ dni }: { dni: string }) {
  const cleanDni = dni.replace(/\D/g, '')
  const [folders, setFolders] = useState<DoctorSharedFolder[]>([])
  const [error, setError] = useState('')
  const [busyId, setBusyId] = useState('')

  useEffect(() => {
    let cancelled = false
    if (cleanDni.length < 6) return
    void loadDoctorSharedFolders(cleanDni).then((result) => {
      if (cancelled) return
      if (result.success) setFolders(result.folders ?? [])
    })
    return () => { cancelled = true }
  }, [cleanDni])

  if (!folders.length) return null

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
      {folders.map((folder) => (
        <details key={folder.shareId} className="patient-documents-folder" open>
          <summary>{folder.patientName} · compartido el {formatDate(folder.sharedAt)} ({folder.documents.length})</summary>
          {folder.documents.length === 0 ? <p className="paper-record-meta">La carpeta todavía no tiene estudios.</p> : (
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
