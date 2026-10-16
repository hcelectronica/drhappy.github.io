import { useEffect, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import { COMMUNICATION_TEMPLATES } from '../supabase/functions/_shared/patientCommunications'
import type { CommunicationAudience, CommunicationContact, CommunicationTemplate } from '../supabase/functions/_shared/patientCommunications'
import { callPatientCommunications } from './patientCommunicationsService'
import type { PatientCampaign } from './patientCommunicationsService'
import './patientCommunications.css'

function CampaignCounts({ campaign }: { campaign: PatientCampaign }) {
  return <div className="patient-mail-counts">
    <span>Total: {campaign.total}</span><span>Aceptados por correo: {campaign.counts.sent}</span>
    <span>Pendientes: {campaign.counts.pending}</span><span>Omitidos por baja o no habilitados: {campaign.counts.skipped}</span>
    <span>Fallidos: {campaign.counts.failed}</span><span>Sin confirmar: {campaign.counts.uncertain + campaign.counts.sending}</span>
  </div>
}
export function AdminPatientCommunications({ initialAudience = 'own' }: { initialAudience?: CommunicationAudience }) {
  const [audience, setAudience] = useState<CommunicationAudience>(initialAudience)
  const [template, setTemplate] = useState<CommunicationTemplate>('folder')
  const [contacts, setContacts] = useState<CommunicationContact[]>([])
  const [virtualReady, setVirtualReady] = useState(false)
  const [all, setAll] = useState(false)
  const [selected, setSelected] = useState<string[]>([])
  const [search, setSearch] = useState('')
  const [subject, setSubject] = useState<string>(COMMUNICATION_TEMPLATES.folder.subject)
  const [message, setMessage] = useState<string>(COMMUNICATION_TEMPLATES.folder.message)
  const [permission, setPermission] = useState(false)
  const [campaign, setCampaign] = useState<PatientCampaign | null>(null)
  const [history, setHistory] = useState<PatientCampaign[]>([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const stop = useRef(false)
  const sendLock = useRef(false)
  useEffect(() => () => { stop.current = true }, [])
  useEffect(() => {
    let cancelled = false
    void callPatientCommunications({ action: 'contacts', audience }).then(result => {
      if (cancelled) return
      setLoading(false)
      if (!result.success) { setError(result.message || 'No se pudieron cargar los destinatarios.'); return }
      setContacts(result.contacts ?? []); setVirtualReady(result.virtualReady === true)
    })
    return () => { cancelled = true }
  }, [audience])
  async function loadHistory() {
    const result = await callPatientCommunications({ action: 'history' })
    if (!result.success) { setError(result.message || 'No se pudo cargar el historial.'); return }
    setHistory(result.campaigns ?? [])
  }
  const eligible = contacts.filter(row => row.eligible)
  const recipients = all ? eligible : eligible.filter(row => selected.includes(row.id))
  const displayed = contacts.filter(row => `${row.name} ${row.email}`.toLocaleLowerCase().includes(search.toLocaleLowerCase()))
  function chooseTemplate(next: CommunicationTemplate) {
    setTemplate(next); setSubject(COMMUNICATION_TEMPLATES[next].subject); setMessage(COMMUNICATION_TEMPLATES[next].message)
  }
  async function preview(event: FormEvent) {
    event.preventDefault()
    if (busy) return
    setBusy(true); setError(''); setNotice('')
    const result = await callPatientCommunications({ action: 'preview', audience, template, all, contactIds: selected,
      subject, message, permissionConfirmed: permission, campaignId: crypto.randomUUID() })
    setBusy(false)
    if (!result.success || !result.campaign) { setError(result.message || 'No se pudo preparar el envío.'); return }
    setCampaign(result.campaign)
  }
  async function send() {
    if (!campaign || sendLock.current || !window.confirm(`¿Enviar «${campaign.subject}» a ${campaign.counts.pending} destinatarios pendientes? Cada persona recibirá un correo individual.`)) return
    sendLock.current = true; stop.current = false; setBusy(true); setError(''); setNotice('')
    let current = campaign
    try {
      while (current.counts.pending > 0 && !stop.current) {
        const result = await callPatientCommunications({ action: 'send-batch', campaignId: current.id, confirm: true })
        if (!result.success || !result.campaign) { setError(result.message || 'Envío interrumpido. Consultá el estado antes de reanudar.'); return }
        current = result.campaign
        setCampaign(current)
      }
      setNotice(stop.current ? 'Pausado. Podés reanudar los pendientes desde el historial.' : 'Lote procesado. Revisá los contadores: aceptación por el servidor no garantiza llegada a la bandeja de entrada.')
    } finally {
      sendLock.current = false; setBusy(false)
    }
  }
  async function refresh() {
    if (!campaign) return
    const result = await callPatientCommunications({ action: 'status', campaignId: campaign.id })
    if (!result.success || !result.campaign) { setError(result.message || 'No se pudo consultar el estado.'); return }
    setCampaign(result.campaign)
  }
  return <section className="patient-mail panel" aria-label="Comunicación con pacientes">
    <h2>Comunicación con pacientes</h2>
    <p>Exclusivo de tu cuenta administradora. Enviá invitaciones individuales o a una audiencia completa; no se incluyen datos clínicos ni se muestran direcciones de otras personas.</p>
    {error && <p className="access-note" role="alert">{error}</p>}
    {notice && <p role="status">{notice}</p>}
    {!campaign ? <form onSubmit={preview}>
      <label>Destinatarios<select value={audience} disabled={busy} onChange={e => {
        setAudience(e.target.value as CommunicationAudience); setContacts([]); setSelected([]); setAll(false); setLoading(true); setPermission(false); setError('')
      }}><option value="own">Mis pacientes del consultorio</option><option value="folder">Registrados en Mi Carpeta de Salud</option></select></label>
      <p>{audience === 'folder' ? 'Incluye cuentas activas con email verificado. Solo se envía a quienes aceptaron novedades. Instalar la app no equivale a autorizar correos.' : 'Se usan los emails guardados en tus fichas, sin incluir pacientes de otros profesionales. Confirmá que tenés permiso para estas comunicaciones.'}</p>
      <label>Herramienta a compartir<select value={template} disabled={busy} onChange={e => chooseTemplate(e.target.value as CommunicationTemplate)}>
        <option value="folder">Mi Carpeta de Salud (gratuita)</option><option value="virtual" disabled={!virtualReady}>Orientación virtual asincrónica{!virtualReady ? ' — activala primero' : ''}</option>
      </select></label>
      <label>Asunto<input value={subject} onChange={e => setSubject(e.target.value)} maxLength={150} required /></label>
      <label>Mensaje<textarea rows={6} value={message} onChange={e => setMessage(e.target.value)} maxLength={3000} required /></label>
      <p>El botón y enlace de la herramienta se agregan automáticamente. No escribas diagnósticos ni otra información de salud en este comunicado.</p>
      {loading ? <p>Cargando destinatarios…</p> : <>
        <p>{eligible.length} emails habilitados · {contacts.length - eligible.length} excluidos por baja o falta de autorización. Los emails repetidos se unifican.</p>
        <label className="patient-mail-check"><input type="checkbox" checked={all} onChange={e => setAll(e.target.checked)} /> Todos los habilitados ({eligible.length})</label>
        {!all && <>
          <label>Buscar paciente o email<input value={search} onChange={e => setSearch(e.target.value)} /></label>
          <div className="patient-mail-recipients">{displayed.map(row => <label key={row.id} className="patient-mail-check">
            <input type="checkbox" disabled={!row.eligible} checked={selected.includes(row.id)} onChange={e => setSelected(current => e.target.checked ? [...current, row.id] : current.filter(id => id !== row.id))} />
            <span>{row.name}<small>{row.email}{row.reason ? ` · ${row.reason}` : ''}</small></span>
          </label>)}</div>
        </>}
      </>}
      <label className="patient-mail-check"><input type="checkbox" checked={permission} onChange={e => setPermission(e.target.checked)} required /> Confirmo que estos destinatarios autorizaron recibir estas invitaciones y que respetaré sus bajas.</label>
      <button type="submit" disabled={busy || loading || !permission || !recipients.length}>{busy ? 'Preparando…' : `Revisar envío a ${recipients.length} personas`}</button>
    </form> : <section aria-label="Vista previa del correo">
      <h3>Vista previa · {campaign.audience === 'own' ? 'Mis pacientes' : 'Mi Carpeta de Salud'}</h3>
      <article className="patient-mail-preview"><small>Dr Happy · {COMMUNICATION_TEMPLATES[campaign.template].title}</small><h3>{campaign.subject}</h3>
        <p>Hola [nombre del paciente],</p><p className="patient-mail-message">{campaign.message}</p>
        <a href={campaign.link} target="_blank" rel="noopener noreferrer">{COMMUNICATION_TEMPLATES[campaign.template].button}</a>
        <p>{campaign.link}</p><small>Incluye identificación del remitente y enlace personal de baja, sin afectar la atención ni la cuenta.</small>
      </article>
      <CampaignCounts campaign={campaign} />
      <p>Los «sin confirmar» no se reenvían automáticamente para evitar duplicados. Si cerrás esta pantalla se detiene el procesamiento después del lote actual; podés continuar desde el historial.</p>
      <div className="patient-mail-actions">
        <button type="button" disabled={busy || !campaign.counts.pending} onClick={() => void send()}>{busy ? 'Enviando…' : campaign.status === 'draft' ? 'Confirmar y enviar' : 'Continuar pendientes'}</button>
        {busy && <button type="button" onClick={() => { stop.current = true }}>Pausar después de este lote</button>}
        <button type="button" disabled={busy} onClick={() => void refresh()}>Actualizar estado</button>
        <button type="button" disabled={busy} onClick={() => { setCampaign(null); setNotice(''); setPermission(false) }}>Preparar otro envío</button>
      </div>
    </section>}
    <section><h3>Historial y envíos pendientes</h3><button type="button" disabled={busy} onClick={() => void loadHistory()}>Consultar historial</button>
      {history.map(row => <article key={row.id} className="patient-mail-history">
        <strong>{row.subject}</strong><small>{new Date(row.created_at).toLocaleString('es-AR')} · {row.audience === 'own' ? 'Mis pacientes' : 'Mi Carpeta de Salud'}</small>
        <CampaignCounts campaign={row} /><button type="button" disabled={busy} onClick={() => { setCampaign(row); setError(''); setNotice('') }}>Ver / continuar pendientes</button>
      </article>)}
    </section>
  </section>
}
