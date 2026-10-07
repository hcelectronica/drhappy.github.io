import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  declineVirtualConsult,
  draftVirtualConsult,
  getVirtualConsultAttachments,
  getVirtualConsultResponsePdf,
  getVirtualConsultSettings,
  listVirtualConsults,
  markVirtualConsultPaid,
  markVirtualConsultRecorded,
  publishVirtualConsult,
  saveVirtualConsultSettings,
} from './virtualConsultService'
import type { VirtualConsult, VirtualConsultAttachment, VirtualConsultSettings } from './virtualConsultService'

type Filter = 'pending' | 'answered' | 'other'

const STATUS_LABELS: Record<string, string> = {
  pending_payment: 'Esperando pago',
  pending_review: 'Para revisar',
  answered: 'Respondida',
  declined: 'Derivada a presencial',
  cancelled: 'Cancelada',
}
const dateLabel = (value: string | null) => value
  ? new Date(value).toLocaleString('es-AR', { timeZone: 'America/Argentina/Buenos_Aires', hourCycle: 'h23', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })
  : ''
const ageLabel = (birthDate: string | null) => {
  if (!birthDate) return ''
  const age = Math.floor((Date.now() - Date.parse(`${birthDate}T12:00:00`)) / (365.25 * 86_400_000))
  return Number.isFinite(age) && age >= 0 ? `${age} años` : ''
}

export function VirtualConsultInbox({ onClose, onRecordInChart, onPendingCountChange, onSyncLedger }: {
  onClose: () => void
  onRecordInChart: (consult: VirtualConsult, responseText: string, clinicalSummary: string) => Promise<boolean>
  onPendingCountChange: (count: number) => void
  onSyncLedger: (consults: VirtualConsult[]) => void
}) {
  const syncLedgerRef = useRef(onSyncLedger)
  syncLedgerRef.current = onSyncLedger
  const [settings, setSettings] = useState<VirtualConsultSettings | null>(null)
  const [priceInput, setPriceInput] = useState('')
  const [letterheadInput, setLetterheadInput] = useState('')
  const [logoDataUrl, setLogoDataUrl] = useState('')
  const [consults, setConsults] = useState<VirtualConsult[] | null>(null)
  const [filter, setFilter] = useState<Filter>('pending')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [attachments, setAttachments] = useState<VirtualConsultAttachment[]>([])
  const [responsePdfUrl, setResponsePdfUrl] = useState('')
  const [responseText, setResponseText] = useState('')
  const [declineReason, setDeclineReason] = useState('')
  const [declineOpen, setDeclineOpen] = useState(false)
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const panel = useRef<HTMLElement>(null)

  const selected = useMemo(() => consults?.find((item) => item.id === selectedId) ?? null, [consults, selectedId])

  const load = useCallback(async () => {
    const [settingsResult, listResult] = await Promise.all([getVirtualConsultSettings(), listVirtualConsults()])
    if (!settingsResult.success || !listResult.success) {
      setError(settingsResult.message || listResult.message || 'No se pudo cargar la consulta virtual.')
      return
    }
    if (settingsResult.settings) {
      setSettings(settingsResult.settings)
      setPriceInput(String(settingsResult.settings.price))
      setLetterheadInput(settingsResult.settings.letterhead)
      setLogoDataUrl(settingsResult.settings.logoDataUrl)
    }
    const list = listResult.consults ?? []
    setConsults(list)
    onPendingCountChange(list.filter((item) => item.status === 'pending_review').length)
    syncLedgerRef.current(list)
  }, [onPendingCountChange])

  useEffect(() => {
    const previous = document.activeElement
    panel.current?.focus()
    void load()
    return () => { if (previous instanceof HTMLElement) previous.focus() }
  }, [load])

  useEffect(() => {
    setAttachments([])
    setResponsePdfUrl('')
    setDeclineOpen(false)
    setDeclineReason('')
    if (!selected) return
    setResponseText(selected.response_text || selected.draft?.respuestaPaciente || '')
    let cancelled = false
    if (selected.attachmentCount) {
      void getVirtualConsultAttachments(selected.id).then((result) => {
        if (!cancelled && result.success) setAttachments(result.attachments ?? [])
      })
    }
    if (selected.status === 'answered') {
      void getVirtualConsultResponsePdf(selected.id).then((result) => {
        if (cancelled) return
        if (result.success && result.pdfUrl) setResponsePdfUrl(result.pdfUrl)
        else setError(result.message || 'No se pudo preparar el PDF de la devolución.')
      })
    }
    return () => { cancelled = true }
    // Solo se recarga al cambiar de consulta, no cuando se actualiza la lista.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId])

  function updateConsult(id: string, patch: Partial<VirtualConsult>): void {
    setConsults((current) => {
      const next = (current ?? []).map((item) => item.id === id ? { ...item, ...patch } : item)
      onPendingCountChange(next.filter((item) => item.status === 'pending_review').length)
      return next
    })
  }

  async function run(label: string, task: () => Promise<void>): Promise<void> {
    if (busy) return
    setBusy(label)
    setError(null)
    setNotice(null)
    try { await task() } finally { setBusy(null) }
  }

  const handleSaveSettings = (enabled: boolean) => run('settings', async () => {
    const price = Math.round(Number(priceInput.replace(/\D/g, '')))
    const result = await saveVirtualConsultSettings(enabled, price, letterheadInput.trim(), logoDataUrl)
    if (!result.success || !result.settings) { setError(result.message || 'No se pudo guardar.'); return }
    setSettings(result.settings)
    setPriceInput(String(result.settings.price))
    setLetterheadInput(result.settings.letterhead)
    setLogoDataUrl(result.settings.logoDataUrl)
    setNotice('Configuración de consultas virtuales guardada.')
  })

  const handleLogoChange = async (file?: File) => {
    if (!file) return
    if (!['image/png', 'image/jpeg'].includes(file.type)) {
      setError('El logo debe estar en formato PNG o JPG.')
      return
    }
    if (file.size > 300 * 1024) {
      setError('El logo no puede superar los 300 KB.')
      return
    }
    const dataUrl = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader()
      reader.onload = () => typeof reader.result === 'string' ? resolve(reader.result) : reject(new Error('No se pudo leer la imagen.'))
      reader.onerror = () => reject(reader.error ?? new Error('No se pudo leer la imagen.'))
      reader.readAsDataURL(file)
    }).catch((readError: unknown) => {
      setError(readError instanceof Error ? readError.message : 'No se pudo leer la imagen.')
      return ''
    })
    if (dataUrl) {
      setLogoDataUrl(dataUrl)
      setError(null)
      setNotice('Logo cargado. Guardá la configuración para aplicarlo a las próximas devoluciones.')
    }
  }

  const handleCopyLink = async () => {
    if (!settings) return
    try {
      await navigator.clipboard.writeText(settings.url)
      setNotice('Link copiado. Podés pegarlo en tu WhatsApp o redes.')
    } catch {
      setNotice(settings.url)
    }
  }

  const handleShareLink = async () => {
    if (!settings) return
    const text = 'Podés enviarme tu consulta virtual asistida (servicio pago y no obligatorio) desde este link:'
    if (navigator.share) {
      try { await navigator.share({ title: 'Consulta virtual', text, url: settings.url }); return } catch { /* cancelado */ }
    }
    window.open(`https://wa.me/?text=${encodeURIComponent(`${text} ${settings.url}`)}`, '_blank', 'noopener')
  }

  const handleDraft = (consult: VirtualConsult) => run('draft', async () => {
    const result = await draftVirtualConsult(consult.id)
    if (!result.success || !result.draft) { setError(result.message || 'Sofía no pudo preparar el borrador.'); return }
    updateConsult(consult.id, { draft: result.draft })
    setResponseText(result.draft.respuestaPaciente)
  })

  const recordInChart = async (consult: VirtualConsult, text: string): Promise<boolean> => {
    const ok = await onRecordInChart(consult, text, consult.draft?.resumenClinico || '')
    if (!ok) return false
    const result = await markVirtualConsultRecorded(consult.id)
    if (result.success) updateConsult(consult.id, { recorded_in_chart_at: new Date().toISOString() })
    return true
  }

  const handlePublish = (consult: VirtualConsult) => run('publish', async () => {
    const text = responseText.trim()
    if (text.length < 20) { setError('Escribí la devolución antes de visarla.'); return }
    if (!window.confirm(`¿Visar y enviar la devolución a ${consult.nombre} ${consult.apellido}? Se genera el PDF firmado y ya no se puede modificar.`)) return
    const result = await publishVirtualConsult(consult.id, text)
    if (!result.success) { setError(result.message || 'No se pudo enviar la devolución.'); return }
    const answeredConsult: VirtualConsult = {
      ...consult,
      status: 'answered',
      response_text: text,
      answered_at: result.answeredAt ?? new Date().toISOString(),
      signature_seal: result.signatureSeal ?? null,
    }
    updateConsult(consult.id, answeredConsult)
    const recorded = await recordInChart(answeredConsult, text)
    setNotice([
      result.emailSent ? 'Devolución visada y enviada por email al paciente.' : 'Devolución visada. No se pudo enviar el email: el paciente la puede descargar desde su link de seguimiento.',
      recorded ? 'Quedó registrada en la historia clínica.' : 'No se pudo registrar en la historia clínica: usá "Registrar en historia clínica".',
    ].join(' '))
  })

  const handleRecord = (consult: VirtualConsult) => run('record', async () => {
    const recorded = await recordInChart(consult, consult.response_text || '')
    setNotice(recorded ? 'Registrada en la historia clínica.' : null)
    if (!recorded) setError('No se pudo registrar en la historia clínica.')
  })

  const handleDecline = (consult: VirtualConsult) => run('decline', async () => {
    const reason = declineReason.trim()
    if (reason.length < 10) { setError('Explicale brevemente al paciente por qué necesita atención presencial.'); return }
    const result = await declineVirtualConsult(consult.id, reason)
    if (!result.success) { setError(result.message || 'No se pudo derivar la consulta.'); return }
    updateConsult(consult.id, { status: 'declined', decline_reason: reason, answered_at: new Date().toISOString() })
    setDeclineOpen(false)
    setNotice(`Consulta derivada a atención presencial. ${consult.status === 'pending_review' ? 'Recordá devolverle el pago desde Mercado Pago.' : ''}`)
  })

  const handleMarkPaid = (consult: VirtualConsult) => run('paid', async () => {
    if (!window.confirm('¿Confirmás que esta consulta ya está paga (por ejemplo, por transferencia)?')) return
    const result = await markVirtualConsultPaid(consult.id)
    if (!result.success) { setError(result.message || 'No se pudo actualizar.'); return }
    updateConsult(consult.id, { status: 'pending_review', payment_status: 'manual', paid_at: new Date().toISOString() })
  })

  const visible = (consults ?? []).filter((item) => filter === 'pending'
    ? item.status === 'pending_review'
    : filter === 'answered' ? item.status === 'answered' : item.status === 'pending_payment' || item.status === 'declined')
  const pendingCount = (consults ?? []).filter((item) => item.status === 'pending_review').length

  return (
    <div className="subscription-account-backdrop" onClick={onClose}>
      <section ref={panel} tabIndex={-1} className="subscription-account-modal virtual-consult-modal" role="dialog" aria-modal="true" aria-labelledby="virtual-consult-title"
        onClick={(event) => event.stopPropagation()} onKeyDown={(event) => { if (event.key === 'Escape') onClose() }}>
        <header>
          <h2 id="virtual-consult-title">💬 Consultas virtuales <small className="vc-pilot">Piloto</small></h2>
          <button type="button" className="ghost" onClick={onClose}>Cerrar</button>
        </header>
        {error ? <p className="error" role="alert">{error}</p> : null}
        {notice ? <p className="vc-notice" role="status">{notice}</p> : null}
        {!consults && !error ? <p role="status">Cargando consultas...</p> : null}

        {settings && !selected ? (
          <section className="vc-settings">
            <div className="vc-settings-row">
              <strong>{settings.enabled ? '🟢 Recibiendo consultas' : '⏸️ Pausada'}</strong>
              <label>Valor $ <input inputMode="numeric" value={priceInput} onChange={(event) => setPriceInput(event.target.value.replace(/\D/g, ''))} /></label>
              <button type="button" disabled={busy !== null} onClick={() => { void handleSaveSettings(!settings.enabled) }}>{settings.enabled ? 'Pausar' : 'Activar'}</button>
              {settings.enabled && String(settings.price) !== priceInput ? <button type="button" className="ghost" disabled={busy !== null} onClick={() => { void handleSaveSettings(true) }}>Guardar valor</button> : null}
            </div>
            <div className="vc-branding">
              <div>
                <strong>Identidad del PDF</strong>
                <p className="vc-hint">El membrete es opcional y no usa el domicilio del consultorio. Si lo dejás vacío, se identifica con tu nombre profesional.</p>
              </div>
              <label className="vc-branding-field">
                Nombre o membrete
                <input maxLength={100} value={letterheadInput} onChange={(event) => setLetterheadInput(event.target.value)} placeholder="Ej.: Dra. Ana Pérez · Salud integral" />
              </label>
              <div className="vc-branding-logo">
                {logoDataUrl ? <img src={logoDataUrl} alt="Vista previa del logo del membrete" /> : <span>Sin logo</span>}
                <div>
                  <label className="vc-file-label">
                    Elegir logo (PNG o JPG, hasta 300 KB)
                    <input type="file" accept="image/png,image/jpeg" onChange={(event) => { void handleLogoChange(event.target.files?.[0]); event.currentTarget.value = '' }} />
                  </label>
                  {logoDataUrl ? <button type="button" className="ghost" disabled={busy !== null} onClick={() => setLogoDataUrl('')}>Quitar logo</button> : null}
                </div>
              </div>
              <button type="button" className="ghost" disabled={busy !== null} onClick={() => { void handleSaveSettings(settings.enabled) }}>Guardar identidad del PDF</button>
            </div>
            {!settings.paymentReady ? <p className="error">Conectá tu cuenta de Mercado Pago en Perfil para poder cobrar las consultas.</p> : null}
            {settings.enabled ? (
              <div className="vc-settings-row">
                <code className="vc-link">{settings.url}</code>
                <button type="button" onClick={() => { void handleCopyLink() }}>Copiar link</button>
                <button type="button" className="ghost" onClick={() => { void handleShareLink() }}>Compartir</button>
              </div>
            ) : null}
            <p className="vc-hint">El paciente ve que es un servicio <strong>pago y no obligatorio</strong>, paga con Mercado Pago y su consulta te llega acá. Sofía prepara un borrador; vos lo revisás y lo visás.</p>
          </section>
        ) : null}

        {consults && !selected ? <>
          <div className="vc-tabs" role="tablist">
            {([['pending', `Para revisar${pendingCount ? ` (${pendingCount})` : ''}`], ['answered', 'Respondidas'], ['other', 'Otras']] as Array<[Filter, string]>).map(([key, label]) => (
              <button key={key} type="button" role="tab" aria-selected={filter === key} className={filter === key ? 'active' : ''} onClick={() => setFilter(key)}>{label}</button>
            ))}
          </div>
          {visible.length ? <ul className="vc-list">{visible.map((item) => (
            <li key={item.id}>
              <button type="button" onClick={() => { setSelectedId(item.id); setError(null); setNotice(null) }}>
                <span className="vc-list-top"><strong>{item.apellido}, {item.nombre}</strong><span className={`vc-status vc-${item.status}`}>{STATUS_LABELS[item.status]}</span></span>
                <span className="vc-list-question">{item.question}</span>
                <small>{dateLabel(item.paid_at || item.created_at)} · DNI {item.dni}{item.attachmentCount ? ` · 📎 ${item.attachmentCount}` : ''}{item.status === 'answered' && !item.recorded_in_chart_at ? ' · ⚠️ sin registrar en HC' : ''}</small>
              </button>
            </li>
          ))}</ul> : <p className="vc-hint">{filter === 'pending' ? 'No hay consultas para revisar.' : 'No hay consultas en esta sección.'}</p>}
        </> : null}

        {selected ? (
          <section className="vc-detail">
            <button type="button" className="ghost" onClick={() => setSelectedId(null)}>← Volver al listado</button>
            <div className="vc-patient">
              <strong>{selected.apellido}, {selected.nombre}</strong>
              <span>DNI {selected.dni}{ageLabel(selected.birth_date) ? ` · ${ageLabel(selected.birth_date)}` : ''}{selected.obra_social ? ` · ${selected.obra_social}` : ''}</span>
              <span>{selected.email}{selected.phone ? ` · ${selected.phone}` : ''}</span>
              <span className={`vc-status vc-${selected.status}`}>{STATUS_LABELS[selected.status]}{selected.payment_status === 'manual' ? ' · pago manual' : ''} · ${Number(selected.amount).toLocaleString('es-AR')}</span>
            </div>
            <h3>Consulta del paciente</h3>
            <p className="vc-question">{selected.question}</p>
            {attachments.length ? <div className="vc-attachments">{attachments.map((file) => (
              <a key={file.url} href={file.url} target="_blank" rel="noopener noreferrer">
                {file.type.startsWith('image/') ? <img src={file.url} alt={file.name} /> : <span>📄</span>}
                <small>{file.name}</small>
              </a>
            ))}</div> : selected.attachmentCount ? <p className="vc-hint">Cargando adjuntos...</p> : null}

            {selected.status === 'pending_payment' ? <>
              <p className="vc-hint">El paciente todavía no pagó. Si te pagó por otro medio, podés marcarla como paga.</p>
              <button type="button" disabled={busy !== null} onClick={() => { void handleMarkPaid(selected) }}>Marcar como pagada</button>
            </> : null}

            {selected.status === 'pending_review' ? <>
              {selected.draft?.alertas ? <p className="vc-alert">⚠️ {selected.draft.alertas}</p> : null}
              {selected.draft?.resumenClinico ? <><h3>Resumen clínico (para la HC)</h3><p className="vc-question">{selected.draft.resumenClinico}</p></> : null}
              <button type="button" className="vc-sofia" disabled={busy !== null} onClick={() => { void handleDraft(selected) }}>
                {busy === 'draft' ? 'Sofía está preparando el borrador...' : selected.draft ? '✨ Volver a preparar con Sofía' : '✨ Preparar respuesta con Sofía'}
              </button>
              <h3>Devolución para el paciente</h3>
              <textarea value={responseText} rows={10} maxLength={6000} onChange={(event) => setResponseText(event.target.value)}
                placeholder="Escribí o revisá la devolución. Se entrega en PDF con tu firma." />
              <p className="vc-hint">Al visar se genera el PDF "Devolución de orientación virtual asistida" con tu firma, se envía al paciente y se registra en su historia clínica.</p>
              <div className="vc-actions">
                <button type="button" disabled={busy !== null || responseText.trim().length < 20} onClick={() => { void handlePublish(selected) }}>
                  {busy === 'publish' ? 'Generando PDF...' : '✍️ Visar y enviar'}
                </button>
                <button type="button" className="ghost" disabled={busy !== null} onClick={() => setDeclineOpen((value) => !value)}>Derivar a presencial</button>
              </div>
            </> : null}

            {declineOpen && (selected.status === 'pending_review' || selected.status === 'pending_payment') ? (
              <div className="vc-decline">
                <textarea value={declineReason} rows={3} maxLength={1000} onChange={(event) => setDeclineReason(event.target.value)}
                  placeholder="Ej: Por lo que contás, necesito revisarte en el consultorio. Pedí un turno al ..." />
                <button type="button" disabled={busy !== null} onClick={() => { void handleDecline(selected) }}>Enviar derivación</button>
              </div>
            ) : null}

            {selected.status === 'answered' ? <>
              <h3>Devolución enviada · {dateLabel(selected.answered_at)}</h3>
              {responsePdfUrl
                ? <a className="vc-pdf-link" href={responsePdfUrl} target="_blank" rel="noopener noreferrer">📄 Abrir el PDF enviado al paciente</a>
                : <p className="vc-hint">Cargando el enlace seguro al PDF enviado...</p>}
              <p className="vc-question">{selected.response_text}</p>
              {selected.signature_seal ? (
                <p className="vc-hint">
                  🔏 Firma electrónica simple · {dateLabel(selected.signature_seal.signedAt)} · SHA-256 {selected.signature_seal.hashSha256.slice(0, 24)}…
                </p>
              ) : null}
              {!selected.recorded_in_chart_at ? <button type="button" disabled={busy !== null} onClick={() => { void handleRecord(selected) }}>Registrar en historia clínica</button> : <p className="vc-hint">✅ Registrada en la historia clínica.</p>}
            </> : null}
            {selected.status === 'declined' ? <><h3>Derivada a atención presencial</h3><p className="vc-question">{selected.decline_reason}</p></> : null}
          </section>
        ) : null}
      </section>
    </div>
  )
}
