import { useCallback, useEffect, useMemo, useState } from 'react'
import type { FormEvent } from 'react'
import {
  PATIENT_DOCUMENT_CATEGORIES,
  callPatientFolder,
  formatBytes,
  getPatientSessionToken,
  setPatientSessionToken,
  uploadPatientDocument,
} from './patientFolderService'
import type { PatientDocument, PatientDocumentCategory, PatientFolderResponse, PatientProfile } from './patientFolderService'
import './PatientPortal.css'

type AuthMode = 'login' | 'register' | 'verify' | 'forgot' | 'reset'
type View = 'home' | 'folder' | 'upload' | 'share' | 'account'

const todayIso = () => new Date().toISOString().slice(0, 10)

function formatDate(value: string | null): string {
  if (!value) return 'Sin fecha'
  const [year, month, day] = value.slice(0, 10).split('-')
  return `${day}/${month}/${year}`
}

function categoryInfo(id: string) {
  return PATIENT_DOCUMENT_CATEGORIES.find((item) => item.id === id) ?? PATIENT_DOCUMENT_CATEGORIES[PATIENT_DOCUMENT_CATEGORIES.length - 1]
}

function Brand() {
  return (
    <div className="pp-brand">
      <img src="/brand-mark.svg" alt="" width={40} height={40} />
      <div>
        <strong>Mi Carpeta de Salud</strong>
        <span>by Dr Happy</span>
      </div>
    </div>
  )
}

function AuthScreen({ onSession }: { onSession: (patient: PatientProfile) => void }) {
  const [mode, setMode] = useState<AuthMode>('login')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [info, setInfo] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [fullName, setFullName] = useState('')
  const [dni, setDni] = useState('')
  const [birthDate, setBirthDate] = useState('')
  const [phone, setPhone] = useState('')
  const [consent, setConsent] = useState(false)
  const [code, setCode] = useState('')

  function go(next: AuthMode, message = '') {
    setMode(next)
    setError('')
    setInfo(message)
    setCode('')
  }

  function finish(result: PatientFolderResponse) {
    if (result.sessionToken && result.patient) {
      setPatientSessionToken(result.sessionToken)
      onSession(result.patient)
      return true
    }
    return false
  }

  async function submit(event: FormEvent) {
    event.preventDefault()
    if (busy) return
    setBusy(true)
    setError('')
    try {
      if (mode === 'login') {
        const result = await callPatientFolder({ action: 'login', email, password })
        if (!result.success) return setError(result.message || 'No pudimos ingresar.')
        if (result.step === 'verify') return go('verify', result.message || 'Te enviamos un código a tu email.')
        finish(result)
      } else if (mode === 'register') {
        if (password.length < 8) return setError('La contraseña debe tener al menos 8 caracteres.')
        if (!consent) return setError('Para continuar tenés que aceptar el uso de tus datos.')
        const result = await callPatientFolder({ action: 'register', email, password, fullName, dni, birthDate, phone, consent })
        if (!result.success) return setError(result.message || 'No pudimos crear tu carpeta.')
        go('verify', `Te enviamos un código de 6 números a ${email}. Revisá también Spam o Promociones.`)
      } else if (mode === 'verify') {
        const result = await callPatientFolder({ action: 'verify', email, code })
        if (!result.success) return setError(result.message || 'El código no es correcto.')
        finish(result)
      } else if (mode === 'forgot') {
        const result = await callPatientFolder({ action: 'request-reset', email })
        if (!result.success) return setError(result.message || 'No pudimos enviar el código.')
        go('reset', 'Si el email está registrado, te llegó un código de 6 números.')
      } else if (mode === 'reset') {
        if (password.length < 8) return setError('La nueva contraseña debe tener al menos 8 caracteres.')
        const result = await callPatientFolder({ action: 'reset-password', email, code, password })
        if (!result.success) return setError(result.message || 'No pudimos cambiar la contraseña.')
        finish(result)
      }
    } finally {
      setBusy(false)
    }
  }

  async function resend() {
    setError('')
    const result = await callPatientFolder({ action: 'resend-code', email, purpose: mode === 'reset' ? 'reset' : 'verify' })
    if (result.success) setInfo('Listo, te enviamos un código nuevo.')
    else setError(result.message || 'No pudimos reenviar el código.')
  }

  const titles: Record<AuthMode, string> = {
    login: 'Ingresá a tu carpeta',
    register: 'Creá tu carpeta gratis',
    verify: 'Confirmá tu email',
    forgot: 'Recuperá tu contraseña',
    reset: 'Elegí una nueva contraseña',
  }

  return (
    <main className="pp-auth">
      <Brand />
      {mode === 'login' && (
        <p className="pp-auth-pitch">Tus estudios médicos ordenados en un solo lugar, siempre a mano y listos para mostrarle a tu médico. <strong>Gratis.</strong></p>
      )}
      <form className="pp-card pp-form" onSubmit={submit}>
        <h1>{titles[mode]}</h1>
        {info && <p className="pp-info">{info}</p>}

        {mode === 'register' && (
          <>
            <label>Nombre y apellido<input value={fullName} onChange={(e) => setFullName(e.target.value)} autoComplete="name" required maxLength={160} /></label>
            <label>DNI<input value={dni} onChange={(e) => setDni(e.target.value.replace(/\D/g, ''))} inputMode="numeric" required maxLength={10} /></label>
            <label>Fecha de nacimiento<input type="date" value={birthDate} onChange={(e) => setBirthDate(e.target.value)} max={todayIso()} /></label>
            <label>Celular (opcional)<input value={phone} onChange={(e) => setPhone(e.target.value)} inputMode="tel" autoComplete="tel" maxLength={40} /></label>
          </>
        )}

        {mode !== 'verify' && mode !== 'reset' && (
          <label>Email<input type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" required maxLength={254} /></label>
        )}

        {(mode === 'verify' || mode === 'reset') && (
          <label>Código que te llegó por email
            <input className="pp-code" value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))} inputMode="numeric" autoComplete="one-time-code" required minLength={6} maxLength={6} />
          </label>
        )}

        {(mode === 'login' || mode === 'register' || mode === 'reset') && (
          <label>{mode === 'reset' ? 'Nueva contraseña' : 'Contraseña'}
            <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete={mode === 'login' ? 'current-password' : 'new-password'} required minLength={mode === 'login' ? 1 : 8} maxLength={200} />
          </label>
        )}

        {mode === 'register' && (
          <label className="pp-check">
            <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} />
            <span>Acepto que Dr Happy guarde mis estudios de forma privada. Solo yo decido con quién compartirlos. Ver <a href="/privacidad.html" target="_blank" rel="noreferrer">política de privacidad</a>.</span>
          </label>
        )}

        {error && <p className="pp-error" role="alert">{error}</p>}
        <button className="pp-primary" type="submit" disabled={busy}>
          {busy ? 'Un momento…' : mode === 'login' ? 'Ingresar' : mode === 'register' ? 'Crear mi carpeta' : mode === 'forgot' ? 'Enviarme un código' : 'Continuar'}
        </button>

        <div className="pp-links">
          {mode === 'login' && (
            <>
              <button type="button" onClick={() => go('register')}>¿No tenés cuenta? <strong>Creala gratis</strong></button>
              <button type="button" onClick={() => go('forgot')}>Olvidé mi contraseña</button>
            </>
          )}
          {(mode === 'verify' || mode === 'reset') && <button type="button" onClick={resend}>Reenviar código</button>}
          {mode !== 'login' && <button type="button" onClick={() => go('login')}>Volver a ingresar</button>}
        </div>
      </form>
      <p className="pp-foot">¿Sos profesional de la salud? <a href="/">Ingresá a Dr Happy</a></p>
    </main>
  )
}

function UploadView({ onDone, onCancel }: { onDone: () => void; onCancel: () => void }) {
  const [file, setFile] = useState<File | null>(null)
  const [title, setTitle] = useState('')
  const [category, setCategory] = useState<PatientDocumentCategory>('laboratorio')
  const [studyDate, setStudyDate] = useState(todayIso())
  const [notes, setNotes] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  function pick(selected: File | null) {
    setError('')
    if (!selected) return
    if (!/^(image\/(jpeg|png|webp)|application\/pdf)$/.test(selected.type)) {
      setError('Solo se aceptan fotos (JPG, PNG) o archivos PDF.')
      return
    }
    setFile(selected)
    if (!title) setTitle(selected.name.replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' ').slice(0, 140))
  }

  async function submit(event: FormEvent) {
    event.preventDefault()
    if (!file || busy) return
    setBusy(true)
    setError('')
    const result = await uploadPatientDocument(file, { title, category, studyDate, notes })
    setBusy(false)
    if (!result.success) return setError(result.message || 'No se pudo guardar el estudio.')
    onDone()
  }

  return (
    <form className="pp-card pp-form" onSubmit={submit}>
      <h2>Subir estudio</h2>
      <div className="pp-pick">
        <label className="pp-pick-btn">
          <span aria-hidden>📷</span> Sacar foto
          <input type="file" accept="image/*" capture="environment" onChange={(e) => pick(e.target.files?.[0] ?? null)} hidden />
        </label>
        <label className="pp-pick-btn">
          <span aria-hidden>📄</span> Elegir archivo
          <input type="file" accept="image/jpeg,image/png,image/webp,application/pdf" onChange={(e) => pick(e.target.files?.[0] ?? null)} hidden />
        </label>
      </div>
      {file && <p className="pp-info">Archivo: <strong>{file.name}</strong> ({formatBytes(file.size)})</p>}
      <label>Nombre del estudio<input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Ej: Análisis de sangre" required maxLength={140} /></label>
      <fieldset className="pp-chips">
        <legend>Categoría</legend>
        {PATIENT_DOCUMENT_CATEGORIES.map((item) => (
          <button type="button" key={item.id} className={category === item.id ? 'is-active' : ''} onClick={() => setCategory(item.id)}>
            <span aria-hidden>{item.icon}</span> {item.label}
          </button>
        ))}
      </fieldset>
      <label>Fecha del estudio<input type="date" value={studyDate} onChange={(e) => setStudyDate(e.target.value)} max={todayIso()} /></label>
      <label>Nota (opcional)<textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} maxLength={500} placeholder="Ej: pedido por la Dra. Gómez" /></label>
      {error && <p className="pp-error" role="alert">{error}</p>}
      <div className="pp-row">
        <button type="button" className="pp-secondary" onClick={onCancel} disabled={busy}>Cancelar</button>
        <button type="submit" className="pp-primary" disabled={!file || busy}>{busy ? 'Subiendo…' : 'Guardar en mi carpeta'}</button>
      </div>
    </form>
  )
}

function FolderView({ documents, loading, onReload }: { documents: PatientDocument[]; loading: boolean; onReload: () => void }) {
  const [filter, setFilter] = useState<'todos' | PatientDocumentCategory>('todos')
  const [query, setQuery] = useState('')
  const [busyId, setBusyId] = useState('')
  const [error, setError] = useState('')

  const visible = useMemo(() => {
    const term = query.trim().toLowerCase()
    return documents.filter((doc) => (filter === 'todos' || doc.category === filter)
      && (!term || doc.title.toLowerCase().includes(term) || (doc.notes || '').toLowerCase().includes(term)))
  }, [documents, filter, query])

  async function open(doc: PatientDocument, download: boolean) {
    setBusyId(doc.id)
    setError('')
    const popup = download ? null : window.open('', '_blank')
    const result = await callPatientFolder({ action: 'document-url', documentId: doc.id, download })
    setBusyId('')
    if (!result.success || !result.url) {
      popup?.close()
      return setError(result.message || 'No se pudo abrir el estudio.')
    }
    if (popup) popup.location.replace(result.url)
    else window.location.assign(result.url)
  }

  async function remove(doc: PatientDocument) {
    if (!window.confirm(`¿Borrar "${doc.title}" de tu carpeta? No se puede deshacer.`)) return
    setBusyId(doc.id)
    const result = await callPatientFolder({ action: 'delete-document', documentId: doc.id })
    setBusyId('')
    if (!result.success) return setError(result.message || 'No se pudo borrar.')
    onReload()
  }

  return (
    <section className="pp-card">
      <h2>Mi carpeta</h2>
      <input className="pp-search" type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Buscar estudio…" />
      <div className="pp-chips pp-chips-scroll">
        <button type="button" className={filter === 'todos' ? 'is-active' : ''} onClick={() => setFilter('todos')}>Todos ({documents.length})</button>
        {PATIENT_DOCUMENT_CATEGORIES.map((item) => {
          const count = documents.filter((doc) => doc.category === item.id).length
          return count ? (
            <button type="button" key={item.id} className={filter === item.id ? 'is-active' : ''} onClick={() => setFilter(item.id)}>
              {item.icon} {item.label} ({count})
            </button>
          ) : null
        })}
      </div>
      {error && <p className="pp-error" role="alert">{error}</p>}
      {loading && !documents.length ? <p className="pp-muted">Cargando tus estudios…</p> : null}
      {!loading && !visible.length ? (
        <p className="pp-empty">{documents.length ? 'No hay estudios con ese filtro.' : 'Todavía no subiste estudios. Empezá con el botón “Subir estudio”.'}</p>
      ) : null}
      <ul className="pp-docs">
        {visible.map((doc) => {
          const info = categoryInfo(doc.category)
          return (
            <li key={doc.id} className="pp-doc">
              <span className="pp-doc-icon" aria-hidden>{doc.mimeType === 'application/pdf' ? '📄' : info.icon}</span>
              <div className="pp-doc-body">
                <strong>{doc.title}</strong>
                <span>{info.label} · {formatDate(doc.studyDate)} · {formatBytes(doc.sizeBytes)}</span>
                {doc.notes && <em>{doc.notes}</em>}
              </div>
              <div className="pp-doc-actions">
                <button type="button" onClick={() => open(doc, false)} disabled={busyId === doc.id}>Ver</button>
                <button type="button" onClick={() => open(doc, true)} disabled={busyId === doc.id} aria-label="Descargar">⬇</button>
                <button type="button" className="is-danger" onClick={() => remove(doc)} disabled={busyId === doc.id} aria-label="Borrar">🗑</button>
              </div>
            </li>
          )
        })}
      </ul>
    </section>
  )
}

function AccountView({ patient, onUpdated, onLogout }: { patient: PatientProfile; onUpdated: (p: PatientProfile) => void; onLogout: () => void }) {
  const [fullName, setFullName] = useState(patient.fullName)
  const [phone, setPhone] = useState(patient.phone || '')
  const [birthDate, setBirthDate] = useState(patient.birthDate || '')
  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const usedPercent = Math.min(100, Math.round((patient.storageUsedBytes / Math.max(1, patient.storageQuotaBytes)) * 100))

  async function saveProfile(event: FormEvent) {
    event.preventDefault()
    setMessage('')
    setError('')
    const result = await callPatientFolder({ action: 'update-profile', fullName, phone, birthDate })
    if (!result.success || !result.patient) return setError(result.message || 'No se pudieron guardar los datos.')
    onUpdated(result.patient)
    setMessage('Datos guardados.')
  }

  async function savePassword(event: FormEvent) {
    event.preventDefault()
    setMessage('')
    setError('')
    const result = await callPatientFolder({ action: 'change-password', currentPassword, newPassword })
    if (!result.success) return setError(result.message || 'No se pudo cambiar la contraseña.')
    setCurrentPassword('')
    setNewPassword('')
    setMessage('Contraseña actualizada.')
  }

  return (
    <section className="pp-stack">
      <div className="pp-card">
        <h2>Mi espacio</h2>
        <div className="pp-meter" aria-label={`Usado ${usedPercent}%`}><span style={{ width: `${usedPercent}%` }} /></div>
        <p className="pp-muted">{formatBytes(patient.storageUsedBytes)} de {formatBytes(patient.storageQuotaBytes)} usados</p>
      </div>
      <form className="pp-card pp-form" onSubmit={saveProfile}>
        <h2>Mis datos</h2>
        <label>Nombre y apellido<input value={fullName} onChange={(e) => setFullName(e.target.value)} required maxLength={160} /></label>
        <label>DNI<input value={patient.dni} disabled /></label>
        <label>Email<input value={patient.email} disabled /></label>
        <label>Fecha de nacimiento<input type="date" value={birthDate} onChange={(e) => setBirthDate(e.target.value)} max={todayIso()} /></label>
        <label>Celular<input value={phone} onChange={(e) => setPhone(e.target.value)} inputMode="tel" maxLength={40} /></label>
        <button className="pp-primary" type="submit">Guardar datos</button>
      </form>
      <form className="pp-card pp-form" onSubmit={savePassword}>
        <h2>Cambiar contraseña</h2>
        <label>Contraseña actual<input type="password" value={currentPassword} onChange={(e) => setCurrentPassword(e.target.value)} autoComplete="current-password" required /></label>
        <label>Nueva contraseña<input type="password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} autoComplete="new-password" minLength={8} required /></label>
        <button className="pp-secondary" type="submit">Cambiar contraseña</button>
      </form>
      {message && <p className="pp-info">{message}</p>}
      {error && <p className="pp-error" role="alert">{error}</p>}
      <button type="button" className="pp-logout" onClick={onLogout}>Cerrar sesión</button>
    </section>
  )
}

export function PatientPortal() {
  const [patient, setPatient] = useState<PatientProfile | null>(null)
  const [checking, setChecking] = useState(() => Boolean(getPatientSessionToken()))
  const [view, setView] = useState<View>('home')
  const [documents, setDocuments] = useState<PatientDocument[]>([])
  const [loadingDocs, setLoadingDocs] = useState(false)
  const [toast, setToast] = useState('')

  useEffect(() => {
    document.title = 'Mi Carpeta de Salud | Dr Happy'
    if (!getPatientSessionToken()) return
    callPatientFolder({ action: 'me' }).then((result) => {
      if (result.success && result.patient) setPatient(result.patient)
      else setPatientSessionToken(null)
      setChecking(false)
    })
  }, [])

  const loadDocuments = useCallback(async () => {
    setLoadingDocs(true)
    const result = await callPatientFolder({ action: 'list-documents' })
    setLoadingDocs(false)
    if (result.success) {
      setDocuments(result.documents ?? [])
      if (result.patient) setPatient(result.patient)
    } else if (result.code === 'SESSION_EXPIRED') {
      setPatient(null)
    }
  }, [])

  useEffect(() => {
    if (patient?.id) void loadDocuments()
  }, [patient?.id, loadDocuments])

  useEffect(() => {
    if (!toast) return
    const timer = window.setTimeout(() => setToast(''), 3200)
    return () => window.clearTimeout(timer)
  }, [toast])

  async function logout() {
    await callPatientFolder({ action: 'logout' })
    setPatientSessionToken(null)
    setPatient(null)
    setDocuments([])
    setView('home')
  }

  if (checking) {
    return <main className="pp-auth"><Brand /><p className="pp-muted">Abriendo tu carpeta…</p></main>
  }
  if (!patient) return <AuthScreen onSession={(p) => { setPatient(p); setView('home') }} />

  const firstName = patient.fullName.split(' ')[0]
  const lastDoc = documents[0]

  return (
    <div className="pp-app">
      <header className="pp-header">
        {view === 'home'
          ? <Brand />
          : <button type="button" className="pp-back" onClick={() => setView('home')}>← Inicio</button>}
      </header>
      <main className="pp-main">
        {view === 'home' && (
          <>
            <section className="pp-hello">
              <h1>Hola, {firstName} 👋</h1>
              <p>{documents.length
                ? `Tenés ${documents.length} ${documents.length === 1 ? 'estudio guardado' : 'estudios guardados'}${lastDoc ? `. El último: ${lastDoc.title}.` : '.'}`
                : 'Tu carpeta está lista. Subí tu primer estudio.'}</p>
            </section>
            <nav className="pp-grid" aria-label="Menú principal">
              <button type="button" className="pp-tile is-folder" onClick={() => setView('folder')}><span aria-hidden>🗂️</span>Mi carpeta</button>
              <button type="button" className="pp-tile is-upload" onClick={() => setView('upload')}><span aria-hidden>📤</span>Subir estudio</button>
              <button type="button" className="pp-tile is-share" onClick={() => setView('share')}><span aria-hidden>🤝</span>Compartir con mi médico</button>
              <button type="button" className="pp-tile is-account" onClick={() => setView('account')}><span aria-hidden>👤</span>Mi cuenta</button>
            </nav>
          </>
        )}
        {view === 'folder' && <FolderView documents={documents} loading={loadingDocs} onReload={loadDocuments} />}
        {view === 'upload' && (
          <UploadView
            onCancel={() => setView('home')}
            onDone={() => { setToast('Estudio guardado en tu carpeta ✔'); void loadDocuments(); setView('folder') }}
          />
        )}
        {view === 'share' && (
          <section className="pp-card pp-soon">
            <span aria-hidden>🤝</span>
            <h2>Compartir con tu médico</h2>
            <p>Muy pronto vas a poder elegir estudios y compartirlos con tu médico mediante un enlace seguro o un código QR, por el tiempo que vos decidas.</p>
            <p className="pp-muted">Mientras tanto, podés abrir o descargar cualquier estudio desde “Mi carpeta”.</p>
            <button type="button" className="pp-primary" onClick={() => setView('folder')}>Ir a mi carpeta</button>
          </section>
        )}
        {view === 'account' && <AccountView patient={patient} onUpdated={setPatient} onLogout={logout} />}
      </main>
      {toast && <div className="pp-toast" role="status">{toast}</div>}
    </div>
  )
}

export default PatientPortal
