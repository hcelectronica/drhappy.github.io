import { useEffect, useRef, useState } from 'react'
import { getPatientInviteLink } from './patientInviteService'
import { callReception, receptionTools, receptionUrl } from './patientReceptionService'
import type { ReceptionSettings, ReceptionTool } from './patientReceptionService'
import './patientReception.css'

export default function PatientReceptionSettings({ onClose }: { onClose: () => void }) {
  const [settings, setSettings] = useState<ReceptionSettings | null>(null)
  const [savedSlug, setSavedSlug] = useState('')
  const [available, setAvailable] = useState<Partial<Record<ReceptionTool, boolean>>>({})
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)
  const dialog = useRef<HTMLDialogElement>(null)
  useEffect(() => {
    dialog.current?.showModal()
    let cancelled = false
    async function load() {
      const invite = await getPatientInviteLink()
      if (!invite.success) throw new Error(invite.message || 'No se pudo preparar el enlace de registro.')
      const result = await callReception({ action: 'get-settings' })
      if (!result.success || !result.settings || !result.available) throw new Error(result.message || 'No se pudo cargar la recepción.')
      if (!cancelled) {
        setSettings(result.settings); setSavedSlug(result.settings.slug); setAvailable(result.available)
      }
    }
    load().catch(cause => { if (!cancelled) setError(cause instanceof Error ? cause.message : 'No se pudo cargar la recepción.') })
    return () => { cancelled = true }
  }, [])
  async function save(event: React.FormEvent) {
    event.preventDefault()
    if (!settings || busy) return
    setBusy(true); setError(''); setMessage('')
    try {
      const result = await callReception({ action: 'save-settings', settings })
      if (!result.success || !result.settings) throw new Error(result.message || 'No se pudo guardar.')
      setSettings(result.settings); setSavedSlug(result.settings.slug); setMessage('Recepción guardada. El enlace ya refleja tus opciones.')
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'No se pudo guardar la recepción.') }
    finally { setBusy(false) }
  }
  return <dialog className="reception-settings" ref={dialog} onCancel={event => { if (busy) event.preventDefault(); else onClose() }}>
    <div className="reception-settings-head"><h2>Mi recepción</h2><button type="button" disabled={busy} onClick={onClose} aria-label="Cerrar recepción">×</button></div>
    <p>Un solo enlace para tus pacientes. Los enlaces individuales siguen funcionando igual.</p>
    {error && <p role="alert" className="reception-error">{error}</p>}
    {message && <p role="status">{message}</p>}
    {!settings && !error && <p role="status">Cargando configuración…</p>}
    {settings && <form onSubmit={save}>
      <fieldset disabled={busy}>
        <label>Nombre visible<input required maxLength={80} value={settings.display_name} onChange={event => setSettings({ ...settings, display_name: event.target.value })} /></label>
        <label>Enlace corto<input required pattern="[a-z0-9]([a-z0-9-]{0,22}[a-z0-9])?" maxLength={24} placeholder="alan" value={settings.slug} onChange={event => setSettings({ ...settings, slug: event.target.value })} /></label>
        <small>Solo minúsculas, números o guiones. Cambiarlo deja de usar la dirección anterior.</small>
        <label className="reception-toggle"><input type="checkbox" checked={settings.enabled} onChange={event => setSettings({ ...settings, enabled: event.target.checked })} /> Recepción pública habilitada</label>
        {receptionTools.map(tool => <label className="reception-toggle" key={tool.key}>
          <input type="checkbox" disabled={!available[tool.key] && !settings[tool.key]} checked={settings[tool.key]} onChange={event => setSettings({ ...settings, [tool.key]: event.target.checked })} />
          <span><strong>{tool.title}</strong><small>{available[tool.key] ? tool.destination : 'No disponible: habilitá primero la herramienta y sus medios de pago, si corresponde.'}</small></span>
        </label>)}
      </fieldset>
      <p className="reception-video-note">Videoconsulta usa los horarios y el precio de tu turnera paga. El paciente paga primero; la agenda y los correos indican que solicitó atención virtual. Vos coordinás y enviás el enlace de la videollamada.</p>
      <button type="submit" disabled={busy}>{busy ? 'Guardando…' : 'Guardar recepción'}</button>
      {savedSlug && <div className="reception-share">
        <a href={receptionUrl(savedSlug)} target="_blank" rel="noopener noreferrer">{receptionUrl(savedSlug)}</a>
        <button type="button" onClick={async () => {
          try { await navigator.clipboard.writeText(receptionUrl(savedSlug)); setMessage('Enlace copiado.') }
          catch { setError('No se pudo copiar. Seleccioná el enlace y copialo manualmente.') }
        }}>Copiar enlace</button>
        <a href={`https://wa.me/?text=${encodeURIComponent(`Elegí cómo atenderte desde mi recepción: ${receptionUrl(savedSlug)}`)}`} target="_blank" rel="noopener noreferrer">Compartir por WhatsApp</a>
      </div>}
    </form>}
  </dialog>
}
