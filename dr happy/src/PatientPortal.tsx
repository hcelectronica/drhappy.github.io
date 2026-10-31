import { Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import {
  PATIENT_DOCUMENT_CATEGORIES,
  callPatientFolder,
  formatBytes,
  formatDate,
  getPatientSessionToken,
  patientCategoryMeta,
  setPatientSessionToken,
  uploadPatientDocument,
} from './patientFolderService'
import type { PatientDocument, PatientDocumentCategory, PatientFolderResponse, PatientProfile, PatientShare } from './patientFolderService'
import './PatientPortal.css'
import PatientPressureView from './PatientPressureView'
import PatientGlucoseView from './PatientGlucoseView'
import { PatientEmailUnsubscribe } from './PatientEmailUnsubscribe'
import PatientLinkRequests from './PatientLinkRequests'
import { PATIENT_APP_URL, PATIENT_APP_WHATSAPP_URL, patientAppWhatsAppUrl } from './patientAppShare'
import { trackPatientActivity } from './patientActivity'

const MemoryWorkshop = lazy(() => import('./memory/MemoryWorkshop'))
import type { EncodeHintType as HintKey } from '@zxing/library'

type AuthMode = 'login' | 'register' | 'verify' | 'forgot' | 'reset'
type View = 'home' | 'folder' | 'upload' | 'pressure' | 'glucose' | 'memory' | 'share' | 'account'

const todayIso = () => new Date().toISOString().slice(0, 10)

const categoryInfo = patientCategoryMeta

function QrCanvas({ text, size = 200 }: { text: string; size?: number }) {
  const ref = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    let cancelled = false
    void import('@zxing/library').then(({ BarcodeFormat, EncodeHintType, QRCodeWriter }) => {
      const canvas = ref.current
      const context = canvas?.getContext('2d')
      if (cancelled || !canvas || !context) return
      const hints = new Map<HintKey, unknown>([[EncodeHintType.MARGIN, 1], [EncodeHintType.ERROR_CORRECTION, 'M']])
      const matrix = new QRCodeWriter().encode(text, BarcodeFormat.QR_CODE, 0, 0, hints as Map<HintKey, never>)
      const modules = matrix.getWidth()
      const cell = Math.max(1, Math.floor(size / modules))
      canvas.width = cell * modules
      canvas.height = cell * modules
      context.fillStyle = '#ffffff'
      context.fillRect(0, 0, canvas.width, canvas.height)
      context.fillStyle = '#0f172a'
      for (let row = 0; row < modules; row += 1) {
        for (let column = 0; column < modules; column += 1) {
          if (matrix.get(column, row)) context.fillRect(column * cell, row * cell, cell, cell)
        }
      }
    })
    return () => { cancelled = true }
  }, [text, size])
  return <canvas ref={ref} className="pp-qr" width={size} height={size} aria-label="Código QR del link" />
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
  const [firstName, setFirstName] = useState('')
  const [lastName, setLastName] = useState('')
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
        const result = await callPatientFolder({ action: 'register', email, password, firstName, lastName, dni, birthDate, phone, consent })
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
      <InstallPatientApp variant="compact" />
      {mode === 'login' && (
        <p className="pp-auth-pitch">Tus estudios médicos ordenados en un solo lugar, siempre a mano y listos para mostrarle a tu médico. <strong>Gratis.</strong></p>
      )}
      <form className="pp-card pp-form" onSubmit={submit}>
        <h1>{titles[mode]}</h1>
        {info && <p className="pp-info">{info}</p>}

        {mode === 'register' && (
          <>
            <label>Nombre<input value={firstName} onChange={(e) => setFirstName(e.target.value)} autoComplete="given-name" required maxLength={80} /></label>
            <label>Apellido<input value={lastName} onChange={(e) => setLastName(e.target.value)} autoComplete="family-name" required maxLength={80} /></label>
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

interface InstallPromptEvent extends Event {
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>
}
type PatientWindow = Window & { __patientInstallPrompt?: InstallPromptEvent }
const INSTALL_SNOOZE_KEY = 'drhappy-patient-install-snooze'

function isRunningInstalled(): boolean {
  return window.matchMedia('(display-mode: standalone), (display-mode: fullscreen), (display-mode: minimal-ui)').matches
    || (navigator as Navigator & { standalone?: boolean }).standalone === true
}

// Se ofrece una vez por sesión del navegador, salvo que ya se esté usando la app instalada.
function shouldOfferInstall(): boolean {
  if (isRunningInstalled()) return false
  try {
    if (sessionStorage.getItem('drhappy-patient-install-asked')) return false
    sessionStorage.setItem('drhappy-patient-install-asked', '1')
  } catch { /* sin storage: preguntar igual */ }
  return true
}

// Botón para instalar Mi Carpeta de Salud como app propia (ícono verde, separado del profesional).
function InstallPatientApp({ variant = 'card', onClose }: { variant?: 'card' | 'compact' | 'modal'; onClose?: () => void }) {
  const compact = variant === 'compact'
  const [promptEvent, setPromptEvent] = useState<InstallPromptEvent | null>(() => (window as PatientWindow).__patientInstallPrompt ?? null)
  const [installed, setInstalled] = useState(isRunningInstalled)
  const [showHelp, setShowHelp] = useState(false)
  const [snoozed, setSnoozed] = useState(() => Number(localStorage.getItem(INSTALL_SNOOZE_KEY) || 0) > Date.now())
  const userAgent = navigator.userAgent
  const isIos = /iphone|ipad|ipod/i.test(userAgent) || (/macintosh/i.test(userAgent) && navigator.maxTouchPoints > 1)
  const isAndroid = /android/i.test(userAgent)
  const isEdge = /edg\//i.test(userAgent)
  const isEmbedded = /electron|code\//i.test(userAgent)

  useEffect(() => {
    const onReady = () => setPromptEvent((window as PatientWindow).__patientInstallPrompt ?? null)
    const onInstalled = () => { setInstalled(true); setPromptEvent(null) }
    window.addEventListener('patient-install-ready', onReady)
    window.addEventListener('appinstalled', onInstalled)
    return () => {
      window.removeEventListener('patient-install-ready', onReady)
      window.removeEventListener('appinstalled', onInstalled)
    }
  }, [])

  const hidden = installed || (snoozed && variant !== 'modal')
  useEffect(() => { if (hidden && onClose) onClose() }, [hidden, onClose])
  if (hidden) return null

  async function install() {
    if (!promptEvent) { setShowHelp((current) => !current); return }
    await promptEvent.prompt()
    const choice = await promptEvent.userChoice
    ;(window as PatientWindow).__patientInstallPrompt = undefined
    setPromptEvent(null)
    if (choice.outcome === 'accepted') setInstalled(true)
    onClose?.()
  }

  function later() {
    localStorage.setItem(INSTALL_SNOOZE_KEY, String(Date.now() + 14 * 24 * 60 * 60 * 1000))
    setSnoozed(true)
  }

  const help = (showHelp || (variant === 'modal' && !promptEvent)) && (
    <p className="pp-install-help">
      {isEmbedded
        ? <>Este navegador no permite instalar apps. Abrí <strong>www.drhappy.com.ar/paciente</strong> en Chrome, Edge o Safari.</>
        : isIos
        ? <>En Safari tocá <strong>Compartir</strong> (el cuadrado con la flecha ⬆️) y elegí <strong>“Agregar a inicio”</strong>.</>
        : isAndroid
        ? <>Abrí el menú del navegador (<strong>⋮</strong>) y elegí <strong>“Instalar app”</strong> o <strong>“Agregar a pantalla de inicio”</strong>.</>
        : isEdge
        ? <>Abrí el menú <strong>…</strong> → <strong>Aplicaciones</strong> → <strong>“Instalar este sitio como aplicación”</strong>, o tocá el ícono de instalar en la barra de direcciones.</>
        : <>Tocá el ícono de instalar (<strong>⊕</strong>) a la derecha de la barra de direcciones, o el menú <strong>⋮</strong> → <strong>“Transmitir, guardar y compartir”</strong> → <strong>“Instalar página como app”</strong>.</>}
    </p>
  )

  if (variant === 'modal') {
    return (
      <div className="pp-install-overlay" role="dialog" aria-modal="true" aria-labelledby="pp-install-title">
        <div className="pp-install-modal">
          <img src="/patient-icon-192.png?v=p1" alt="Ícono de Mi Carpeta de Salud" width={88} height={88} />
          <h2 id="pp-install-title">¿Instalar Mi Carpeta de Salud?</h2>
          <p>Vas a tener este ícono en tu pantalla y se abre directo en tu carpeta, sin buscar la página.</p>
          {promptEvent
            ? <button type="button" className="pp-primary" onClick={() => void install()}>📲 Sí, instalar</button>
            : <strong className="pp-install-steps">Cómo instalarla:</strong>}
          {help}
          <button type="button" className="pp-link-btn" onClick={onClose}>{promptEvent ? 'Ahora no' : 'Entendido'}</button>
        </div>
      </div>
    )
  }

  return (
    <section className={`pp-install${compact ? ' is-compact' : ''}`} aria-label="Instalar Mi Carpeta de Salud">
      <img src="/patient-icon-192.png?v=p1" alt="" width={44} height={44} />
      <div>
        <strong>Instalá Mi Carpeta como app</strong>
        <small>Instalala como app: se abre con un toque, con su propio ícono.</small>
      </div>
      <button type="button" className="pp-primary" onClick={() => void install()}>📲 Instalar</button>
      {!compact && <button type="button" className="pp-link-btn" onClick={later}>Ahora no</button>}
      {help}

    </section>
  )
}

function UploadView({ onDone, onCancel, freeBytes }: { onDone: () => void; onCancel: () => void; freeBytes: number }) {
  const full = freeBytes <= 0
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
    if (selected.type === 'application/pdf' && selected.size > freeBytes) {
      setError(`No hay lugar para este archivo: te quedan  libres de 50 MB. Borrá estudios que ya no necesites.`)
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
      <p className={full ? 'pp-error' : 'pp-muted'}>{full
        ? 'Tu carpeta está llena (50 MB). Borrá estudios que ya no necesites para subir nuevos.'
        : `Espacio libre:  de 50 MB.`}</p>
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
        <button type="submit" className="pp-primary" disabled={!file || busy || full}>{busy ? 'Subiendo…' : 'Guardar en mi carpeta'}</button>
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

function ScopePicker({ documents, all, selected, onAll, onToggle, pressure, onPressure, glucose, onGlucose }: {
  documents: PatientDocument[]
  all: boolean
  selected: string[]
  onAll: (value: boolean) => void
  onToggle: (id: string) => void
  pressure: boolean
  onPressure: (value: boolean) => void
  glucose: boolean
  onGlucose: (value: boolean) => void
}) {
  return (
    <fieldset className="pp-scope">
      <legend>¿Qué querés compartir?</legend>
      <label className="pp-radio"><input type="radio" checked={all} onChange={() => onAll(true)} /> Toda mi carpeta <small>(incluye lo que subas después)</small></label>
      <label className="pp-radio"><input type="radio" checked={!all} onChange={() => onAll(false)} /> {documents.length ? 'Elegir estudios' : 'Solo controles (sin estudios)'}</label>
      {!all && (
        <ul className="pp-pick-list">
          {documents.map((doc) => (
            <li key={doc.id}>
              <label>
                <input type="checkbox" checked={selected.includes(doc.id)} onChange={() => onToggle(doc.id)} />
                <span>{categoryInfo(doc.category).icon} {doc.title} <small>{formatDate(doc.studyDate)}</small></span>
              </label>
            </li>
          ))}
        </ul>
      )}
      <label className="pp-check"><input type="checkbox" checked={pressure} onChange={(e) => onPressure(e.target.checked)} /> ❤️ Incluir mi registro de presión</label>
      <label className="pp-check"><input type="checkbox" checked={glucose} onChange={(e) => onGlucose(e.target.checked)} /> Incluir glucosa y tratamiento de diabetes (también futuras actualizaciones)</label>
    </fieldset>
  )
}

type ShareMode = 'menu' | 'doctor' | 'link'

function ShareView({ documents, patientName, onToast }: { documents: PatientDocument[]; patientName: string; onToast: (message: string) => void }) {
  const [mode, setMode] = useState<ShareMode>('menu')
  const [shares, setShares] = useState<PatientShare[]>([])
  const [loadingShares, setLoadingShares] = useState(true)
  const [all, setAll] = useState(true)
  const [selected, setSelected] = useState<string[]>([])
  const [pressure, setPressure] = useState(true)
  const [glucose, setGlucose] = useState(false)
  const [query, setQuery] = useState('')
  const [doctor, setDoctor] = useState<{ id: string; name: string; specialty: string } | null>(null)
  const [doctors, setDoctors] = useState<NonNullable<PatientFolderResponse['doctors']>>([])
  const [searching, setSearching] = useState(false)
  const [searched, setSearched] = useState(false)
  const [moreDoctors, setMoreDoctors] = useState(false)
  const [searchAttempt, setSearchAttempt] = useState(0)
  const [days, setDays] = useState(7)
  const [created, setCreated] = useState<{ url: string; code: string; expiresAt: string } | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const loadShares = useCallback(async () => {
    const result = await callPatientFolder({ action: 'list-shares' })
    setLoadingShares(false)
    if (result.success) setShares(result.shares ?? [])
  }, [])

  useEffect(() => { void loadShares() }, [loadShares])

  useEffect(() => {
    if (mode !== 'doctor' || doctor || query.trim().length < 2) return
    let cancelled = false
    const timer = window.setTimeout(async () => {
      setSearching(true)
      setError('')
      try {
        const result = await callPatientFolder({ action: 'search-doctors', query: query.trim() })
        if (cancelled) return
        if (!result.success) {
          setError(result.message || 'No se pudieron buscar profesionales. Intentá nuevamente.')
          return
        }
        setDoctors(result.doctors ?? [])
        setMoreDoctors(result.hasMoreDoctors === true)
        setSearched(true)
      } catch {
        if (!cancelled) setError('No se pudo conectar para buscar profesionales. Intentá nuevamente.')
      } finally {
        if (!cancelled) setSearching(false)
      }
    }, 350)
    return () => { cancelled = true; window.clearTimeout(timer) }
  }, [mode, doctor, query, searchAttempt])

  function reset(next: ShareMode) {
    setMode(next)
    setAll(true)
    setSelected([])
    setPressure(true)
    setGlucose(false)
    setQuery('')
    setDoctor(null)
    setDoctors([])
    setSearched(false)
    setSearching(false)
    setMoreDoctors(false)
    setCreated(null)
    setError('')
  }

  function toggle(id: string) {
    setSelected((current) => current.includes(id) ? current.filter((item) => item !== id) : [...current, id])
  }

  function findDoctor(event: FormEvent) {
    event.preventDefault()
    if (!busy && !searching) setSearchAttempt(value => value + 1)
  }

  async function shareWithDoctor() {
    if (!doctor || busy) return
    if (!all && !selected.length && !pressure && !glucose) return setError('Elegí al menos un estudio, presión o glucosa.')
    setBusy(true)
    setError('')
    const result = await callPatientFolder({ action: 'share-with-doctor', professionalId: doctor.id, allDocuments: all, documentIds: selected, includePressure: pressure, includeGlucose: glucose })
    setBusy(false)
    if (!result.success) return setError(result.message || 'No se pudo compartir.')
    onToast(result.updated ? 'Actualizaste lo que compartís con tu médico ✔' : `Listo, ${doctor.name || 'tu médico'} ya puede ver tus estudios ✔`)
    reset('menu')
    void loadShares()
  }

  async function createLink() {
    if (busy) return
    if (!all && !selected.length && !pressure && !glucose) return setError('Elegí al menos un estudio, presión o glucosa.')
    setBusy(true)
    setError('')
    const result = await callPatientFolder({ action: 'create-link-share', days, allDocuments: all, documentIds: selected, includePressure: pressure, includeGlucose: glucose }) as PatientFolderResponse & { code?: string }
    setBusy(false)
    if (!result.success || !result.url || !result.code || !result.expiresAt) return setError(result.message || 'No se pudo crear el link.')
    setCreated({ url: result.url, code: result.code, expiresAt: result.expiresAt })
    void loadShares()
  }

  async function revoke(share: PatientShare) {
    const question = share.kind === 'doctor'
      ? `¿Dejar de compartir tus estudios con ${share.doctorName || 'este médico'}? Ya no va a poder verlos.`
      : '¿Desactivar este link? Quien lo tenga ya no va a poder abrirlo.'
    if (!window.confirm(question)) return
    const result = await callPatientFolder({ action: 'revoke-share', shareId: share.id })
    if (!result.success) return setError(result.message || 'No se pudo desactivar.')
    onToast('Acceso desactivado ✔')
    void loadShares()
  }

  const shareText = created ? `Hola, te comparto mis estudios de Mi Carpeta de Salud (Dr Happy).\nLink: ${created.url}\nCódigo: ${created.code}` : ''

  async function copy(value: string) {
    try {
      await navigator.clipboard.writeText(value)
      onToast('Copiado ✔')
    } catch {
      window.prompt('Copiá este texto:', value)
    }
  }

  async function nativeShare() {
    if (!created) return
    if (typeof navigator.share === 'function') {
      try {
        await navigator.share({ title: `Estudios de ${patientName}`, text: shareText })
        return
      } catch (shareError) {
        if (shareError instanceof DOMException && shareError.name === 'AbortError') return
      }
    }
    await copy(shareText)
  }

  const doctorShares = shares.filter((share) => share.kind === 'doctor')
  const linkShares = shares.filter((share) => share.kind === 'link')

  return (
    <section className="pp-stack">
      {mode === 'menu' && (
        <div className="pp-card">
          <h2>Compartir con mi médico</h2>
          <p className="pp-muted">Vos decidís qué estudios compartir y podés dejar de hacerlo cuando quieras.</p>
          <div className="pp-share-options">
            <button type="button" className="pp-option" onClick={() => reset('doctor')}>
              <span aria-hidden>🩺</span>
              <strong>Mi médico usa Dr Happy</strong>
              <small>Tus estudios aparecen directo en tu ficha, en su app.</small>
            </button>
            <button type="button" className="pp-option" onClick={() => reset('link')}>
              <span aria-hidden>🔗</span>
              <strong>Otro médico</strong>
              <small>Link temporal + código. Lo abre desde cualquier celular o PC.</small>
            </button>
          </div>
        </div>
      )}

      {mode === 'doctor' && (
        <div className="pp-card pp-form">
          <h2>Mi médico usa Dr Happy</h2>
          <form className="pp-form" onSubmit={findDoctor}>
            <label>Apellido y nombre de tu médico
              <input type="search" autoComplete="off" value={query} disabled={busy} onChange={(e) => {
                setQuery(e.target.value); setDoctor(null); setDoctors([]); setSearched(false); setSearching(false); setMoreDoctors(false); setError('')
              }} placeholder="Ej: Góme, María o Gómez María" required minLength={2} maxLength={300} aria-describedby="pp-doctor-search-help" />
            </label>
            <small id="pp-doctor-search-help">Escribí al menos 2 letras. Podés buscar por parte del apellido o nombre, en cualquier orden y sin tildes. También podés pegar su email o link de registro.</small>
            {!doctor && <button type="submit" className="pp-secondary" disabled={busy || searching || query.trim().length < 2}>{searching ? 'Buscando…' : 'Buscar médico'}</button>}
          </form>
          {!doctor && searching && <p className="pp-muted" role="status">Buscando profesionales…</p>}
          {!doctor && searched && !searching && !doctors.length && <p className="pp-muted" role="status">No encontramos coincidencias. Probá con más letras o con el email de tu médico.</p>}
          {!doctor && doctors.length > 0 && <div className="pp-doctor-results" aria-label="Profesionales encontrados">
            <p className="pp-muted">Elegí a tu médico. Buscar o seleccionarlo todavía no comparte tus estudios.</p>
            <ul>{doctors.map(candidate => <li key={candidate.id}><button type="button" className="pp-secondary pp-doctor-result" onClick={() => {
              setDoctor(candidate); setDoctors([]); setSearching(false); setError('')
            }}><strong>{candidate.name || 'Profesional de Dr Happy'}</strong><small>{candidate.specialty || 'Profesional de salud'} · Seleccionar</small></button></li>)}</ul>
            {moreDoctors && <p className="pp-muted">Hay más coincidencias. Agregá letras del nombre o apellido para precisar la búsqueda.</p>}
          </div>}
          {doctor && (
            <>
              <div className="pp-doctor">
                <span aria-hidden>🩺</span>
                <div><strong>{doctor.name || 'Profesional de Dr Happy'}</strong>{doctor.specialty && <small>{doctor.specialty}</small>}</div>
              </div>
              <ScopePicker documents={documents} all={all} selected={selected} onAll={setAll} onToggle={toggle} pressure={pressure} onPressure={setPressure} glucose={glucose} onGlucose={setGlucose} />
              <p className="pp-muted">Si todavía no sos paciente de este médico en Dr Happy, se crea tu ficha con tu nombre, DNI y contacto.</p>
            </>
          )}
          {error && <p className="pp-error" role="alert">{error}</p>}
          <div className="pp-row">
            <button type="button" className="pp-secondary" onClick={() => reset('menu')} disabled={busy}>Volver</button>
            {doctor && <button type="button" className="pp-primary" onClick={shareWithDoctor} disabled={busy}>{busy ? 'Compartiendo…' : 'Compartir'}</button>}
          </div>
        </div>
      )}

      {mode === 'link' && !created && (
        <div className="pp-card pp-form">
          <h2>Link temporal</h2>
          <fieldset className="pp-chips">
            <legend>¿Por cuánto tiempo?</legend>
            {[[1, '24 horas'], [7, '7 días'], [30, '30 días']].map(([value, label]) => (
              <button type="button" key={value} className={days === value ? 'is-active' : ''} onClick={() => setDays(Number(value))}>{label}</button>
            ))}
          </fieldset>
          <ScopePicker documents={documents} all={all} selected={selected} onAll={setAll} onToggle={toggle} pressure={pressure} onPressure={setPressure} glucose={glucose} onGlucose={setGlucose} />
          {error && <p className="pp-error" role="alert">{error}</p>}
          <div className="pp-row">
            <button type="button" className="pp-secondary" onClick={() => reset('menu')} disabled={busy}>Volver</button>
            <button type="button" className="pp-primary" onClick={createLink} disabled={busy}>{busy ? 'Creando…' : 'Crear link'}</button>
          </div>
        </div>
      )}

      {mode === 'link' && created && (
        <div className="pp-card pp-created">
          <h2>¡Listo! Mostrale esto a tu médico</h2>
          <QrCanvas text={created.url} />
          <p className="pp-muted">Código de acceso</p>
          <div className="pp-share-code">{created.code}</div>
          <p className="pp-muted">Vence el {new Date(created.expiresAt).toLocaleDateString('es-AR')}. Guardá el código: por seguridad no lo volvemos a mostrar.</p>
          <div className="pp-row">
            <button type="button" className="pp-secondary" onClick={() => copy(shareText)}>Copiar</button>
            <a className="pp-primary pp-wa" href={`https://wa.me/?text=${encodeURIComponent(shareText)}`} target="_blank" rel="noreferrer">WhatsApp</a>
          </div>
          <button type="button" className="pp-link-btn" onClick={nativeShare}>Más opciones para compartir</button>
          <button type="button" className="pp-link-btn" onClick={() => reset('menu')}>Terminar</button>
        </div>
      )}

      {mode === 'menu' && (
        <div className="pp-card">
          <h2>Con quién compartís</h2>
          {loadingShares && <p className="pp-muted">Cargando…</p>}
          {!loadingShares && !shares.length && <p className="pp-empty">Todavía no compartiste tus estudios con nadie.</p>}
          <ul className="pp-shares">
            {doctorShares.map((share) => (
              <li key={share.id}>
                <span aria-hidden>🩺</span>
                <div>
                  <strong>{share.doctorName || 'Profesional de Dr Happy'}</strong>
                  <small>{share.doctorSpecialty ? `${share.doctorSpecialty} · ` : ''}{share.allDocuments ? 'Toda la carpeta' : `${share.documentCount} estudio${share.documentCount === 1 ? '' : 's'}`}{share.includePressure ? ' + presión' : ''}{share.includeGlucose ? ' + glucosa y tratamiento' : ''}{share.lastAccessedAt ? ` · Visto ${formatDate(share.lastAccessedAt)}` : ''}</small>
                </div>
                <button type="button" className="is-danger" onClick={() => revoke(share)}>Dejar de compartir</button>
              </li>
            ))}
            {linkShares.map((share) => (
              <li key={share.id}>
                <span aria-hidden>🔗</span>
                <div>
                  <strong>Link temporal</strong>
                  <small>Vence {share.expiresAt ? formatDate(share.expiresAt) : ''} · {share.allDocuments ? 'Toda la carpeta' : `${share.documentCount} estudio${share.documentCount === 1 ? '' : 's'}`}{share.includePressure ? ' + presión' : ''}{share.includeGlucose ? ' + glucosa y tratamiento' : ''} · Abierto {share.accessCount} {share.accessCount === 1 ? 'vez' : 'veces'}</small>
                </div>
                <button type="button" className="is-danger" onClick={() => revoke(share)}>Desactivar</button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  )
}

function AccountView({ patient, onUpdated, onLogout }: { patient: PatientProfile; onUpdated: (p: PatientProfile) => void; onLogout: () => void }) {
  const fallbackParts = patient.fullName.trim().split(/\s+/)
  const [firstName, setFirstName] = useState(patient.firstName || fallbackParts.slice(0, -1).join(' ') || fallbackParts[0] || '')
  const [lastName, setLastName] = useState(patient.lastName || (fallbackParts.length > 1 ? fallbackParts[fallbackParts.length - 1] : ''))
  const [phone, setPhone] = useState(patient.phone || '')
  const [healthInsurance, setHealthInsurance] = useState(patient.healthInsurance || '')
  const [insuranceMemberNumber, setInsuranceMemberNumber] = useState(patient.insuranceMemberNumber || '')
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
    const result = await callPatientFolder({ action: 'update-profile', firstName, lastName, phone, birthDate, healthInsurance, insuranceMemberNumber })
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
        <label>Nombre<input value={firstName} onChange={(e) => setFirstName(e.target.value)} required maxLength={80} /></label>
        <label>Apellido<input value={lastName} onChange={(e) => setLastName(e.target.value)} required maxLength={80} /></label>
        <label>DNI<input value={patient.dni} disabled /></label>
        <label>Email<input value={patient.email} disabled /></label>
        <label>Fecha de nacimiento<input type="date" value={birthDate} onChange={(e) => setBirthDate(e.target.value)} max={todayIso()} /></label>
        <label>Celular<input value={phone} onChange={(e) => setPhone(e.target.value)} inputMode="tel" maxLength={40} /></label>
        <label>Obra social o prepaga<input value={healthInsurance} onChange={(e) => setHealthInsurance(e.target.value)} maxLength={120} placeholder="Ej: OSDE, PAMI, IOMA…" /></label>
        <label>Número de afiliado<input value={insuranceMemberNumber} onChange={(e) => setInsuranceMemberNumber(e.target.value)} maxLength={80} placeholder="Como figura en tu credencial" /></label>
        <small className="pp-muted">Datos opcionales. Si no tenés cobertura, podés dejarlos vacíos.</small>
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
  const [askInstall, setAskInstall] = useState(false)
  const closeInstall = useCallback(() => setAskInstall(false), [])
  const [orientation, setOrientation] = useState<PatientFolderResponse['orientation']>(null)
  const [orientationError, setOrientationError] = useState('')
  const [orientationAttempt, setOrientationAttempt] = useState(0)
  const [orientationChecked, setOrientationChecked] = useState(false)
  const [referral] = useState(() => {
    const params = new URLSearchParams(window.location.search)
    const value = params.has('ref') ? `code:${params.get('ref')}` : params.get('prof')
    try {
      if (value !== null) localStorage.setItem('drhappy-pending-referral', value)
      return { value: value ?? localStorage.getItem('drhappy-pending-referral'), error: '' }
    } catch (error) {
      console.error('No se pudo conservar el enlace del profesional.', error)
      return { value, error: 'El navegador no permite conservar el enlace. Volvé a abrir el enlace de tu profesional si instalás la app antes de ingresar.' }
    }
  })
  const referringProfessional = referral.value

  useEffect(() => {
    setOrientation(null)
    setOrientationChecked(false)
    setOrientationError(referral.error)
    if (!patient?.id) return
    let cancelled = false
    callPatientFolder({ action: 'orientation', ...(referringProfessional !== null
      ? referringProfessional.startsWith('code:') ? { folderCode: referringProfessional.slice(5) } : { professionalId: referringProfessional }
      : {}) })
      .then(result => {
        if (cancelled) return
        if (!result.success) {
          setOrientationError(result.message || 'No se pudo cargar la orientación de tu profesional.')
          return
        }
        setOrientation(result.orientation ?? null)
        setOrientationChecked(true)
        try { localStorage.removeItem('drhappy-pending-referral') }
        catch (error) { console.error('No se pudo limpiar el enlace pendiente.', error); setOrientationError('No se pudo limpiar el enlace guardado en este navegador. Revisá su configuración de almacenamiento.') }
      })
    return () => { cancelled = true }
  }, [patient?.id, referringProfessional, referral.error, orientationAttempt])

  useEffect(() => {
    if (!patient?.id) return
    void trackPatientActivity('view', view)
  }, [patient?.id, view])

  useEffect(() => {
    if (!patient?.id) return
    const heartbeat = () => {
      if (document.visibilityState === 'visible') void trackPatientActivity('heartbeat')
    }
    heartbeat()
    const timer = window.setInterval(heartbeat, 60000)
    document.addEventListener('visibilitychange', heartbeat)
    return () => {
      window.clearInterval(timer)
      document.removeEventListener('visibilitychange', heartbeat)
    }
  }, [patient?.id])

  // Al entrar al login de Mi Carpeta se ofrece instalarla (una vez por sesión del navegador).
  useEffect(() => {
    if (patient || checking) return
    const timer = window.setTimeout(() => { if (shouldOfferInstall()) setAskInstall(true) }, 1200)
    return () => window.clearTimeout(timer)
  }, [patient, checking])

  useEffect(() => {
    document.title = 'Mi Carpeta de Salud | Dr Happy'
    if (!getPatientSessionToken()) return
    callPatientFolder({ action: 'me' }).then((result) => {
      if (result.success && result.patient) {
        setPatient(result.patient)
        if (shouldOfferInstall()) setAskInstall(true)
      }
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

  const unsubscribeToken = new URLSearchParams(window.location.search).get('unsubscribe')
  if (unsubscribeToken) return <PatientEmailUnsubscribe token={unsubscribeToken} />
  if (checking) {
    return <main className="pp-auth"><Brand /><p className="pp-muted">Abriendo tu carpeta…</p></main>
  }
  if (!patient) {
    return (
      <>
        <AuthScreen onSession={(p) => { setPatient(p); setView('home'); if (shouldOfferInstall()) setAskInstall(true) }} />
        {askInstall && <InstallPatientApp variant="modal" onClose={closeInstall} />}
      </>
    )
  }

  const firstName = patient.firstName || patient.fullName.split(' ')[0]
  const lastDoc = documents[0]
  const appShareUrl = orientation?.shareUrl
    ?? (referringProfessional !== null
      ? referringProfessional.startsWith('code:') ? `https://www.drhappy.com.ar/s/${encodeURIComponent(referringProfessional.slice(5))}` : `${PATIENT_APP_URL}?prof=${encodeURIComponent(referringProfessional)}`
      : null)

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
            <PatientLinkRequests onToast={setToast} />
            <nav className="pp-grid" aria-label="Menú principal">
              <button type="button" className="pp-tile is-folder" onClick={() => setView('folder')}><span aria-hidden>🗂️</span>Mi carpeta</button>
              <button type="button" className="pp-tile is-upload" onClick={() => setView('upload')}><span aria-hidden>📤</span>Subir estudio</button>
              {orientation?.url && <a className="pp-tile is-evaluation" href={orientation.url} target="_blank" rel="noopener noreferrer">
                <span aria-hidden>🔬</span>
                EVALUAR ESTUDIOS CON INTELIGENCIA ARTIFICIAL
                <small>{orientation.professionalName}</small>
                <small>Orientación virtual paga, revisada por un médico. No atiende urgencias.</small>
              </a>}
              <button type="button" className="pp-tile is-pressure" onClick={() => setView('pressure')}><span aria-hidden>❤️</span>Mi presión</button>
              <button type="button" className="pp-tile is-pressure" onClick={() => setView('glucose')}><span aria-hidden>🩸</span>Mi glucosa</button>
              <button type="button" className="pp-tile is-memory" onClick={() => setView('memory')}><span aria-hidden>🧠</span>Taller de memoria</button>
              <button type="button" className="pp-tile is-share" onClick={() => setView('share')}><span aria-hidden>🤝</span>Compartir con mi médico</button>
              {orientationChecked && <a className="pp-tile is-friend" href={appShareUrl ? patientAppWhatsAppUrl(appShareUrl) : PATIENT_APP_WHATSAPP_URL} target="_blank" rel="noopener noreferrer" onClick={() => { void trackPatientActivity('invite_clicked') }}>
                <span aria-hidden>💬</span>
                Compartir con un amigo
                <small>Por WhatsApp</small>
              </a>}
              <button type="button" className="pp-tile is-account" onClick={() => setView('account')}><span aria-hidden>👤</span>Mi cuenta</button>
            </nav>
            {orientation && !orientation.url && <p className="pp-info">{orientation.professionalName} no está recibiendo evaluaciones virtuales en este momento.</p>}
            {orientationError && <div className="pp-error" role="alert">{orientationError} <button type="button" className="pp-secondary" onClick={() => setOrientationAttempt(value => value + 1)}>Volver a intentar</button></div>}
            {!askInstall && <InstallPatientApp />}
          </>
        )}
        {view === 'folder' && <FolderView documents={documents} loading={loadingDocs} onReload={loadDocuments} />}
        {view === 'upload' && (
          <UploadView
            freeBytes={patient.storageQuotaBytes - patient.storageUsedBytes}
            onCancel={() => setView('home')}
            onDone={() => { setToast('Estudio guardado en tu carpeta ✔'); void loadDocuments(); setView('folder') }}
          />
        )}
        {view === 'pressure' && <PatientPressureView onToast={setToast} />}
        {view === 'glucose' && <PatientGlucoseView onToast={setToast} />}
        {view === 'memory' && (
          <Suspense fallback={<p className="pp-muted">Cargando juegos…</p>}>
            <MemoryWorkshop />
          </Suspense>
        )}
        {view === 'share' && <ShareView documents={documents} patientName={patient.fullName} onToast={setToast} />}
        {view === 'account' && <AccountView patient={patient} onUpdated={setPatient} onLogout={logout} />}
      </main>
      {askInstall && <InstallPatientApp variant="modal" onClose={closeInstall} />}
      {toast && <div className="pp-toast" role="status">{toast}</div>}
    </div>
  )
}

export default PatientPortal
