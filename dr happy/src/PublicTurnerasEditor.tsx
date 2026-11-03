import { buildFixedPublicBookingUrl, buildWhatsAppShareUrl } from './publicBookingService'
import type { PublicBookingAvailabilityBlock, PublicBookingSettings } from './publicBookingService'

interface Props {
  settings: PublicBookingSettings
  defaultSchedule: Pick<PublicBookingAvailabilityBlock, 'days' | 'startTime' | 'endTime' | 'durationMinutes'>
  saving: boolean
  mercadoPagoConnected: boolean
  error: string | null
  notice: string | null
  onChange: (settings: PublicBookingSettings) => void
  onSave: (settings: PublicBookingSettings) => Promise<boolean>
  onCopy: (url: string) => Promise<void>
}
const days = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb']
function capacity(block: Pick<PublicBookingAvailabilityBlock, 'startTime' | 'endTime' | 'durationMinutes'>): number {
  const minutes = (time: string) => { const [h, m] = time.split(':').map(Number); return h * 60 + m }
  return Math.max(0, Math.floor((minutes(block.endTime) - minutes(block.startTime)) / block.durationMinutes)) || 0
}
export default function PublicTurnerasEditor({ settings, defaultSchedule, saving, mercadoPagoConnected, error, notice, onChange, onSave, onCopy }: Props) {
  function update(id: string, patch: Partial<PublicBookingAvailabilityBlock>): void {
    onChange({ ...settings, blocks: settings.blocks.map(block => {
      if (block.id !== id) return block
      const next = { ...block, ...patch }
      if (patch.startTime !== undefined || patch.endTime !== undefined || patch.durationMinutes !== undefined) {
        next.slotCount = capacity(next)
        if (next.slotCount > 0) next.dailyQuota = Math.min(next.dailyQuota ?? next.slotCount, next.slotCount)
      }
      return next
    }) })
  }
  function add(): void {
    const block: PublicBookingAvailabilityBlock = {
      ...defaultSchedule, id: crypto.randomUUID(), label: 'Nueva turnera', enabled: false,
      modality: 'coverage', slotCount: capacity(defaultSchedule), location: '', reason: 'Consulta médica',
    }
    onChange({ ...settings, blocks: [...settings.blocks, block] })
  }
  function save(id: string, enabled: boolean): void {
    const blocks = settings.blocks.map(block => block.id === id ? { ...block, enabled } : block)
    void onSave({ ...settings, enabled: blocks.some(block => block.enabled !== false), blocks })
  }
  function remove(block: PublicBookingAvailabilityBlock): void {
    if (saving || !window.confirm(`¿Eliminar la turnera "${block.label || 'Nueva turnera'}"? Su enlace dejará de aceptar reservas y ya no aparecerá en recepción. Los turnos ya reservados y los pagos pendientes se conservarán.`)) return
    const blocks = settings.blocks.filter(item => item.id !== block.id)
    void onSave({ ...settings, enabled: settings.enabled && blocks.some(item => item.enabled !== false), blocks })
  }
  return <section aria-label="Mis turneras">
    <h3>Mis turneras</h3>
    <p className="flow-hint">Creá las turneras que necesites: IOMA, PAMI, particular u otras. Todas comparten la ocupación de tu agenda. Las habilitadas aparecen en tu recepción si tenés activada la opción Turneras.</p>
    <button type="button" className="screen-action" onClick={add} disabled={saving}>Crear turnera</button>
    {error ? <p className="error" role="alert">{error}</p> : null}
    {notice ? <p className="payment-info-note ok" role="status">{notice}</p> : null}
    {settings.blocks.map(block => {
      const total = capacity(block)
      const active = settings.enabled && block.enabled !== false
      const url = buildFixedPublicBookingUrl(settings.slug, undefined, block.id)
      return <details key={block.id} className={`public-turnera-section ${block.modality === 'private' ? 'is-private' : 'is-free'}`} open={settings.blocks.length === 1 ? true : undefined}>
        <summary><span>{block.label || 'Nueva turnera'}</span><small>{active ? 'Habilitada' : 'Pausada / sin publicar'} · hasta {block.dailyQuota ?? block.slotCount} turnos por día</small></summary>
        <div className="public-turnera-body">
          <fieldset disabled={saving} style={{ border: 0, padding: 0, margin: 0 }}>
            <div className="public-turnera-fields">
              <label>Nombre de la turnera<input type="text" maxLength={80} value={block.label} onChange={event => update(block.id, { label: event.target.value })} placeholder="Ej: IOMA, PAMI, Particular" /></label>
              <label>Cobro al reservar<select value={block.modality} onChange={event => update(block.id, { modality: event.target.value === 'private' ? 'private' : 'coverage', amountToCharge: undefined, amountConcept: 'consulta' })}>
                <option value="coverage">Sin pago online</option><option value="private">Con Mercado Pago</option>
              </select></label>
            </div>
            <div className="capacity-controls">
              <label>Desde<input type="time" value={block.startTime} onChange={event => update(block.id, { startTime: event.target.value })} /></label>
              <label>Hasta<input type="time" value={block.endTime} onChange={event => update(block.id, { endTime: event.target.value })} /></label>
              <label>Duración del turno<select value={block.durationMinutes} onChange={event => update(block.id, { durationMinutes: Number(event.target.value) })}>
                {Array.from(new Set([15, 20, 30, 45, 60, 90, block.durationMinutes])).sort((a, b) => a - b).map(minutes => <option key={minutes} value={minutes}>{minutes} minutos</option>)}
              </select></label>
              <div className="capacity-calculated"><strong>{total}</strong><span>turnos posibles por día</span></div>
              <div className="capacity-days"><span>Días de atención</span><div>
                {days.map((label, day) => <label key={day} className="capacity-day-option"><input type="checkbox" checked={block.days.includes(day)} onChange={() => update(block.id, { days: block.days.includes(day) ? block.days.filter(value => value !== day) : [...block.days, day].sort() })} /><span>{label}</span></label>)}
              </div></div>
            </div>
            <div className="public-turnera-fields">
              <label className="public-turnera-location">Lugar de atención<input type="text" maxLength={160} value={block.location || ''} onChange={event => update(block.id, { location: event.target.value })} /></label>
              <label>Motivo del turno<input type="text" maxLength={160} value={block.reason || ''} onChange={event => update(block.id, { reason: event.target.value })} /></label>
              <label>Cupo diario (máx. {total})<input type="number" min={1} max={total} step={1} value={block.dailyQuota ?? block.slotCount} onChange={event => update(block.id, { dailyQuota: Number(event.target.value) })} /></label>
              {block.modality === 'private' ? <>
                <label>Monto a cobrar<input type="number" min="0.01" max="9999999999.99" step="0.01" value={block.amountToCharge ?? ''} onChange={event => update(block.id, { amountToCharge: Number(event.target.value) || undefined })} /></label>
                <label>Concepto<select value={block.amountConcept || 'consulta'} onChange={event => update(block.id, { amountConcept: event.target.value === 'sena' ? 'sena' : 'consulta' })}><option value="sena">Reserva / seña</option><option value="consulta">Turno completo</option></select></label>
              </> : null}
            </div>
            {block.modality === 'private' && !mercadoPagoConnected ? <p className="flow-hint">Conectá Mercado Pago antes de habilitar esta turnera.</p> : null}
            <p className="flow-hint">Una reserva bloquea su intervalo completo en las demás turneras. Pausar no elimina las reservas ni cambia el enlace.</p>
            <div className="public-turnera-actions">
              <button type="button" className="screen-action primary" onClick={() => save(block.id, true)}>{saving ? 'Guardando...' : active ? 'Guardar cambios' : 'Guardar y habilitar'}</button>
              {active ? <button type="button" className="ghost compact" onClick={() => save(block.id, false)}>Pausar</button> : null}
              <button type="button" className="ghost compact" onClick={() => remove(block)}>Eliminar turnera</button>
            </div>
            <div className="capacity-generated-link"><strong>Enlace propio</strong><span>{url}</span>
              <button type="button" className="ghost compact" onClick={() => { void onCopy(url) }}>Copiar link</button>
              <button type="button" className="ghost compact" onClick={() => window.open(buildWhatsAppShareUrl(url, settings.professionalName), '_blank', 'noopener,noreferrer')}>WhatsApp</button>
            </div>
          </fieldset>
        </div>
      </details>
    })}
  </section>
}
