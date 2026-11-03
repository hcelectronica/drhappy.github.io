export interface PublicBookingBlock {
  id: string
  label: string
  enabled?: boolean
  modality: 'coverage' | 'private'
  days: number[]
  startTime: string
  endTime: string
  durationMinutes: number
  slotCount: number
  dailyQuota?: number
  location?: string
  reason?: string
  amountToCharge?: number
  amountConcept?: 'sena' | 'consulta'
  paymentLink?: string
}

function normalizeBlock(raw: unknown): PublicBookingBlock | null {
  if (!raw || typeof raw !== 'object') return null
  const block = raw as Partial<PublicBookingBlock>
  const id = typeof block.id === 'string' && block.id.trim() ? block.id.trim() : crypto.randomUUID()
  const label = typeof block.label === 'string' && block.label.trim() ? block.label.trim().slice(0, 80) : 'Turno disponible'
  const modality = block.modality === 'private' ? 'private' : 'coverage'
  const days = Array.isArray(block.days)
    ? Array.from(new Set(block.days.filter((day): day is number => Number.isInteger(day) && day >= 0 && day <= 6)))
    : []
  const startTime = typeof block.startTime === 'string' ? block.startTime.trim() : ''
  const endTime = typeof block.endTime === 'string' ? block.endTime.trim() : ''
  const durationMinutes = block.durationMinutes ?? 30
  const capacity = Math.floor((timeToMinutes(endTime) - timeToMinutes(startTime)) / durationMinutes)
  const slotCount = block.slotCount ?? capacity
  const dailyQuota = block.dailyQuota ?? slotCount
  const rawAmount = Number(block.amountToCharge)
  const hasAmount = modality === 'private' && Number.isFinite(rawAmount) && rawAmount > 0

  if (!Number.isInteger(durationMinutes) || durationMinutes < 5 || durationMinutes > 240
    || !Number.isInteger(slotCount) || !Number.isInteger(dailyQuota) || dailyQuota < 1 || dailyQuota > slotCount
    || (block.enabled !== undefined && typeof block.enabled !== 'boolean')
    || (block.amountToCharge !== undefined && block.amountToCharge !== null && (!Number.isFinite(rawAmount) || rawAmount <= 0 || rawAmount > 9999999999.99))
    || !days.length || !/^([01]\d|2[0-3]):[0-5]\d$/.test(startTime) || !/^([01]\d|2[0-3]):[0-5]\d$/.test(endTime) || startTime >= endTime || slotCount < 1 || slotCount > capacity) {
    return null
  }

  return {
    id,
    label,
    enabled: block.enabled !== false,
    modality,
    days,
    startTime,
    endTime,
    durationMinutes,
    slotCount,
    dailyQuota,
    location: typeof block.location === 'string' ? block.location.trim().slice(0, 160) : '',
    reason: typeof block.reason === 'string' ? block.reason.trim().slice(0, 160) : '',
    amountToCharge: hasAmount ? rawAmount : undefined,
    amountConcept: hasAmount ? (block.amountConcept === 'sena' ? 'sena' : 'consulta') : undefined,
    paymentLink: hasAmount && typeof block.paymentLink === 'string' ? block.paymentLink.trim().slice(0, 500) : undefined,
  }
}

// La modalidad conserva compatibilidad; cada turnera tiene identidad propia.
export function normalizeBlocks(raw: unknown): PublicBookingBlock[] {
  const list = Array.isArray(raw) ? raw : []
  return list.flatMap((entry) => {
    if (!entry || typeof entry !== 'object') return []
    const declared = entry.modality
    const modality = declared === 'coverage' ? 'coverage' : declared === 'private' || list.length === 1 ? 'private' : 'coverage'
    const block = normalizeBlock({ ...entry, modality })
    return block ? [block] : []
  })
}

export function pickBlock(blocks: PublicBookingBlock[], modality?: 'coverage' | 'private', blockId?: string): PublicBookingBlock | undefined {
  // Un enlace pausado nunca debe terminar mostrando otra turnera.
  const block = blockId ? blocks.find((entry) => entry.id === blockId)
    : modality ? blocks.find((entry) => entry.modality === modality)
      : blocks.find((entry) => entry.modality === 'private') ?? blocks[0]
  return block?.enabled !== false ? block : undefined
}

function timeToMinutes(value: string): number {
  const [hours, minutes] = value.split(':').map(Number)
  return hours * 60 + minutes
}
