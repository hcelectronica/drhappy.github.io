import { useEffect, useRef, useState } from 'react'
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
import { GlucoseSummary } from './GlucoseSummary'
import { askSofia } from './aiAssistantService'

interface SharedFolderProps {
  dni: string
  patientId?: string
  onStudyDraft?: (text: string) => void
}

// Estudios que el paciente compartió desde su Carpeta de Salud. Se consultan en vivo: si revoca, desaparecen.
export default function PatientSharedFolderPanel({ dni, patientId, onStudyDraft }: SharedFolderProps) {
  const cleanDni = dni.replace(/\D/g, '')
  const [folders, setFolders] = useState<DoctorSharedFolder[]>([])
  const [error, setError] = useState('')
  const [busyId, setBusyId] = useState('')
  const [notice, setNotice] = useState('')
  const [carpeta, setCarpeta] = useState<DoctorCarpetaStatus | null>(null)
  const [requesting, setRequesting] = useState(false)
  const [readingId, setReadingId] = useState('')
  const [incorporating, setIncorporating] = useState(false)
  const [studyDraft, setStudyDraft] = useState<{ shareId: string; documentId: string; source: string; text: string; truncated: boolean } | null>(null)
  const context = useRef({ cancelled: false })
  const operation = useRef(false)
  const draftHandler = useRef(onStudyDraft)
  useEffect(() => { draftHandler.current = onStudyDraft }, [onStudyDraft])

  useEffect(() => {
    let cancelled = false
    const version = { cancelled: false }
    context.current = version
    if (cleanDni.length < 6) return
    void loadDoctorSharedFolders(cleanDni).then((result) => {
      if (cancelled) return
      if (!result.success) {
        setError(result.message || 'No se pudo consultar la carpeta compartida.')
        return
      }
      setFolders(result.folders ?? [])
      setCarpeta(result.carpeta ?? null)
    })
    return () => { cancelled = true; version.cancelled = true }
  }, [cleanDni, patientId])

  async function readWithSofia(shareId: string, documentId: string) {
    if (!patientId || !onStudyDraft || operation.current) return
    if (studyDraft && !window.confirm('¿Descartar el borrador actual y leer otro estudio?')) return
    const version = context.current
    operation.current = true
    setReadingId(documentId)
    setStudyDraft(null)
    setError('')
    setNotice('')
    try {
      const result = await askSofia({
        mode: 'shared-study-review', messages: [],
        sharedStudy: { patientId, shareId, documentId },
      })
      if (version.cancelled) return
      if (!result.success || !result.reply || !result.sharedStudy) throw new Error(result.message || 'No se pudo preparar el borrador del estudio.')
      setStudyDraft({
        shareId, documentId,
        source: `Fuente: Mi Carpeta de Salud · ${result.sharedStudy.title} · fecha del estudio: ${result.sharedStudy.studyDate ? formatDate(result.sharedStudy.studyDate) : 'No informada'} · ID: ${documentId}`,
        text: result.reply, truncated: result.truncated === true,
      })
    } catch (readError) {
      if (!version.cancelled) setError(readError instanceof Error ? readError.message : 'No se pudo leer el estudio con Sofía.')
    } finally {
      operation.current = false
      if (!version.cancelled) setReadingId('')
    }
  }

  async function incorporateDraft() {
    if (!patientId || !studyDraft?.text.trim() || studyDraft.truncated || !onStudyDraft || operation.current) return
    const draft = studyDraft
    const version = context.current
    operation.current = true
    setIncorporating(true)
    setError('')
    try {
      const result = await askSofia({
        mode: 'shared-study-review', messages: [], checkOnly: true,
        sharedStudy: { patientId, shareId: draft.shareId, documentId: draft.documentId },
      })
      if (version.cancelled) return
      if (!result.success) throw new Error(result.message || 'No se pudieron verificar los permisos del estudio.')
      if (!draftHandler.current) throw new Error('No se puede incorporar el estudio mientras editás otra evolución.')
      draftHandler.current(`${draft.source}\nBorrador preparado por Sofía, revisado por el profesional:\n${draft.text.trim()}`)
      setStudyDraft(null)
      setNotice('Se incorporó al borrador de evolución. Revisá los campos y elegí Guardar evolución para registrarlo y firmarlo.')
    } catch (incorporationError) {
      if (!version.cancelled) setError(incorporationError instanceof Error ? incorporationError.message : 'No se pudo incorporar el borrador.')
    } finally {
      operation.current = false
      if (!version.cancelled) setIncorporating(false)
    }
  }

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
    if (!carpeta?.hasAccount) return error ? <section className="patient-form-block"><p role="alert">{error}</p></section> : null
    return (
      <section className="patient-form-block paper-record-block">
        <h4 className="block-title">📁 Este paciente tiene Carpeta de Salud</h4>
        {carpeta.status === 'pending' ? (
          <p className="paper-record-meta">⏳ Le pediste acceso. Cuando lo acepte desde su app, vas a ver acá los datos que autorice compartir. La glucosa y su tratamiento requieren una autorización adicional del paciente.</p>
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
        {error ? <p className="access-note" role="alert">{error}</p> : null}
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
      {onStudyDraft ? <p className="paper-record-meta">Elegí Leer con Sofía para enviar ese estudio al servicio de IA y preparar un borrador editable (PDF o imagen, hasta 8 MB). Usa una consulta de Sofía. No cambia la historia ni el tratamiento: primero revisás y después guardás la evolución.</p> : null}
      {error ? <p className="access-note" role="alert">{error}</p> : null}
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
          {folder.glucose && <details className="patient-documents-folder" open>
            <summary>Glucosa y tratamiento de diabetes</summary>
            <GlucoseSummary record={folder.glucose} onCopy={setNotice} />
          </details>}
          {folder.documents.length === 0 ? <p className="paper-record-meta">{folder.pressure?.length || folder.glucose ? 'No compartió estudios. Sus controles autorizados se muestran a continuación.' : 'La carpeta todavía no tiene estudios compartidos.'}</p> : (
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
                        {onStudyDraft && patientId ? <button type="button" className="ghost compact" disabled={Boolean(readingId) || incorporating} onClick={() => void readWithSofia(folder.shareId, document.id)}>
                          {readingId === document.id ? 'Sofía está leyendo…' : 'Leer con Sofía'}
                        </button> : null}
                      </div>
                    </div>
                  </li>
                )
              })}
            </ul>
          )}
        </details>
      ))}
      {studyDraft ? <section className="patient-form-block">
        <h4>Borrador del estudio · revisión médica</h4>
        <p className="paper-record-meta">{studyDraft.source}</p>
        {studyDraft.truncated ? <p role="alert">La respuesta quedó incompleta. No se puede incorporar: descartala y volvé a intentar con un archivo más breve.</p> : null}
        <label>Revisá y editá el borrador de Sofía
          <textarea rows={10} value={studyDraft.text} disabled={incorporating} onChange={event => setStudyDraft(current => current ? { ...current, text: event.target.value } : null)} />
        </label>
        <div className="paper-record-buttons">
          <button type="button" disabled={incorporating || studyDraft.truncated || !studyDraft.text.trim()} onClick={() => void incorporateDraft()}>{incorporating ? 'Verificando permisos…' : 'Incorporar a evolución'}</button>
          <button type="button" className="ghost compact" disabled={incorporating} onClick={() => setStudyDraft(null)}>Descartar borrador</button>
        </div>
        <p className="paper-record-meta">Incorporar no guarda la historia. La evolución se registra recién al elegir Guardar evolución.</p>
      </section> : null}
    </section>
  )
}
