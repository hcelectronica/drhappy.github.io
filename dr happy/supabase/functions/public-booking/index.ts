import { serve } from 'https://deno.land/std@0.224.0/http/server.ts'
import { createClient } from 'jsr:@supabase/supabase-js@2'
import type { SupabaseClient } from 'jsr:@supabase/supabase-js@2'
import { corsHeaders } from '../_shared/cors.ts'
import { resolveProfessionalId } from '../_shared/professionalSession.ts'
import { getHolidayName } from '../_shared/argentineHolidays.ts'
import { notifyProfessionalRegistration } from '../_shared/professionalRegistrationEmail.ts'

type AdminClient = SupabaseClient

// Función NUEVA e independiente de la Turnera existente.
// Permite a un profesional generar un enlace público de "turnos libres"
// (con cupo y rango horario que él mismo regula) para compartir por
// WhatsApp con un paciente que todavía no está registrado. El paciente
// entra al enlace, ve los horarios disponibles, elige uno y completa sus
// datos básicos. Al confirmar, el turno se agrega automáticamente a la
// Turnera global del profesional (tabla user_workspaces.appointments_json),
// exactamente igual que si el profesional lo hubiese cargado a mano.
//
// Acciones (action):
// - create-link:   el profesional autenticado genera un nuevo enlace con
//                   fecha, rango horario, cantidad de turnos y lugar/motivo.
// - get-link:      público; devuelve datos del enlace y los horarios
//                   disponibles/ocupados (sin datos sensibles de otros
//                   pacientes).
// - book-slot:     público; el paciente elige un horario y envía sus datos.
//                   Crea el turno en user_workspaces.appointments_json.
// - list-links:    el profesional autenticado lista sus enlaces activos.
// - cancel-link:   el profesional autenticado cancela un enlace.

interface RequestBody {
  action:
    | 'create-link'
    | 'get-link'
    | 'book-slot'
    | 'list-links'
    | 'cancel-link'
    | 'cancel-appointment'
    | 'get-public-settings'
    | 'save-public-settings'
    | 'get-public-agenda'
    | 'book-public-slot'
  professionalId?: string
  professionalName?: string
  slotDate?: string
  startTime?: string
  endTime?: string
  slotCount?: number
  location?: string
  reason?: string
  intervalMinutes?: number
  token?: string
  slotTime?: string
  patientName?: string
  patientDni?: string
  patientEmail?: string
  patientPhone?: string
  amountToCharge?: number
  amountConcept?: 'sena' | 'consulta'
  paymentLink?: string
  linkId?: string
  appointmentId?: string
  appointmentDays?: number[]
  dailyPatientLimit?: number
  settings?: PublicBookingSettingsPayload
  slug?: string
  startDate?: string
  days?: number
  blockId?: string
  modality?: 'coverage' | 'private'
}

interface PublicBookingBlock {
  id: string
  label: string
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

interface PublicBookingSettingsPayload {
  professionalId?: string
  slug?: string
  enabled?: boolean
  professionalName?: string
  location?: string
  reason?: string
  horizonDays?: number
  blocks?: PublicBookingBlock[]
}

interface AppointmentLike {
  scheduledDate?: string
  scheduledTime?: string
  status?: string
  durationMinutes?: number
  publicBookingModality?: 'coverage' | 'private'
}

function jsonResponse(status: number, body: Record<string, unknown>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders,
      'Content-Type': 'application/json',
    },
  })
}

function decodeBase64(value: string): Uint8Array<ArrayBuffer> {
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (value.length % 4)) % 4)
  return Uint8Array.from(atob(normalized), (char) => char.charCodeAt(0))
}

async function decryptPaymentToken(value: string): Promise<string> {
  const keyValue = Deno.env.get('MP_TOKEN_ENCRYPTION_KEY')?.trim()
  if (!keyValue) throw new Error('Falta MP_TOKEN_ENCRYPTION_KEY.')
  const [ivPart, dataPart] = value.split('.')
  if (!ivPart || !dataPart) throw new Error('Token Mercado Pago inválido.')
  const key = await crypto.subtle.importKey('raw', decodeBase64(keyValue), 'AES-GCM', false, ['decrypt'])
  const decrypted = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: decodeBase64(ivPart) }, key, decodeBase64(dataPart))
  return new TextDecoder().decode(decrypted)
}

function generateToken(): string {
  const bytes = new Uint8Array(16)
  crypto.getRandomValues(bytes)
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')
}

function normalizeSlug(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
}

// Links generados por versiones anteriores: nombre + sufijo aleatorio (ej. alan-moodie-muc7bhne-3a3a28).
const LEGACY_SLUG_SUFFIX = /-[a-z0-9]{6,10}-[a-f0-9]{6}$/

async function resolveFixedSlug(admin: AdminClient, professionalId: string, currentSlug: string, professionalName: string): Promise<string> {
  if (currentSlug && !LEGACY_SLUG_SUFFIX.test(currentSlug)) return currentSlug
  const base = normalizeSlug(currentSlug.replace(LEGACY_SLUG_SUFFIX, '')) || normalizeSlug(professionalName) || currentSlug
  for (let attempt = 1; attempt <= 20; attempt += 1) {
    const candidate = attempt === 1 ? base : `${base}-${attempt}`
    const { data } = await admin
      .from('public_booking_profiles')
      .select('professional_id')
      .eq('slug', candidate)
      .maybeSingle()
    if (!data || data.professional_id === professionalId) return candidate
  }
  return currentSlug
}

async function findProfileBySlug(admin: AdminClient, slug: string) {
  const columns = 'professional_id, slug, enabled, professional_name, location, reason, horizon_days, availability_blocks'
  const exact = await admin.from('public_booking_profiles').select(columns).eq('slug', slug).maybeSingle()
  if (exact.error || exact.data || !LEGACY_SLUG_SUFFIX.test(slug)) return exact
  return await admin.from('public_booking_profiles').select(columns).eq('slug', slug.replace(LEGACY_SLUG_SUFFIX, '')).maybeSingle()
}

function todayISO(): string {
  return new Date().toISOString().slice(0, 10)
}

function pendingReservationCutoff(): string {
  return new Date(Date.now() - 15 * 60 * 1000).toISOString()
}

function addDays(dateStr: string, days: number): string {
  const [year, month, day] = dateStr.split('-').map(Number)
  const date = new Date(Date.UTC(year, month - 1, day + days, 12, 0, 0))
  return date.toISOString().slice(0, 10)
}

function dateDay(dateStr: string): number {
  return new Date(`${dateStr}T12:00:00`).getDay()
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
  const durationMinutes = Math.max(5, Math.min(240, Math.round(Number(block.durationMinutes) || 30)))
  const slotCount = Math.max(1, Math.min(50, Math.round(Number(block.slotCount) || 1)))
  const dailyQuota = Math.max(1, Math.min(slotCount, Math.round(Number(block.dailyQuota) || slotCount)))
  const rawAmount = Number(block.amountToCharge)
  const hasAmount = modality === 'private' && Number.isFinite(rawAmount) && rawAmount > 0

  if (!days.length || !/^\d{2}:\d{2}$/.test(startTime) || !/^\d{2}:\d{2}$/.test(endTime) || startTime >= endTime) {
    return null
  }

  return {
    id,
    label,
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

// Una turnera particular (Mercado Pago) y una gratuita como máximo; comparten horario y cada una tiene su cupo diario.
function normalizeBlocks(raw: unknown): PublicBookingBlock[] {
  const list = Array.isArray(raw) ? raw : []
  const blocks: PublicBookingBlock[] = []
  for (const entry of list) {
    const block = normalizeBlock(entry)
    if (!block) continue
    // Las turneras guardadas antes de existir la gratuita no tienen modalidad: eran particulares.
    const declared = (entry as { modality?: string })?.modality
    const modality = declared === 'coverage' ? 'coverage' : declared === 'private' || list.length === 1 ? 'private' : 'coverage'
    if (blocks.some((existing) => existing.modality === modality)) continue
    blocks.push({ ...block, modality, label: modality === 'private' ? 'Turno particular' : 'Turno sin cargo' })
  }
  return blocks
}

function pickBlock(blocks: PublicBookingBlock[], modality?: 'coverage' | 'private'): PublicBookingBlock | undefined {
  if (modality) return blocks.find((block) => block.modality === modality)
  return blocks.find((block) => block.modality === 'private') ?? blocks[0]
}

function requestedModality(value: unknown): 'coverage' | 'private' | undefined {
  return value === 'coverage' ? 'coverage' : value === 'private' ? 'private' : undefined
}

function timeToMinutes(value: string): number {
  const [hours, minutes] = value.split(':').map(Number)
  return hours * 60 + minutes
}

// Intervalos ocupados por fecha (turnos y reservas de ambas turneras), para que no se superpongan horarios con distinta duración.
async function loadBusyIntervals(admin: AdminClient, professionalId: string, appointments: AppointmentLike[], blocks: PublicBookingBlock[], startDate: string, endDate: string): Promise<Map<string, Array<[number, number]>>> {
  const busy = new Map<string, Array<[number, number]>>()
  const add = (date: string | undefined, time: string | undefined, duration: number) => {
    if (!date || !time || !/^\d{2}:\d{2}$/.test(time)) return
    const start = timeToMinutes(time)
    const list = busy.get(date) ?? []
    list.push([start, start + Math.max(5, duration)])
    busy.set(date, list)
  }
  for (const appointment of appointments) {
    if (appointment.status === 'cancelled') continue
    add(appointment.scheduledDate, appointment.scheduledTime, Number(appointment.durationMinutes) || 30)
  }
  const { data: reservations } = await admin
    .from('public_booking_reservations')
    .select('slot_date, slot_time, status, block_id')
    .eq('professional_id', professionalId)
    .gte('slot_date', startDate)
    .lte('slot_date', endDate)
  for (const reservation of reservations ?? []) {
    if (reservation.status === 'cancelled') continue
    const duration = blocks.find((block) => block.id === reservation.block_id)?.durationMinutes ?? 30
    add(reservation.slot_date, reservation.slot_time, duration)
  }
  return busy
}

function overlapsBusy(busy: Map<string, Array<[number, number]>>, date: string, time: string, duration: number): boolean {
  const start = timeToMinutes(time)
  const end = start + duration
  return (busy.get(date) ?? []).some(([busyStart, busyEnd]) => start < busyEnd && busyStart < end)
}

// Turnos ya tomados por cada turnera, por fecha, para controlar el cupo diario.
async function loadModalityUsage(admin: AdminClient, professionalId: string, appointments: AppointmentLike[], startDate: string, endDate: string): Promise<Map<string, Set<string>>> {
  const usage = new Map<string, Set<string>>()
  const add = (modality: string | undefined, date: string | undefined, time: string | undefined) => {
    if (!modality || !date || !time) return
    const key = `${modality}|${date}`
    const times = usage.get(key) ?? new Set<string>()
    times.add(time)
    usage.set(key, times)
  }
  for (const appointment of appointments) {
    if (appointment.status === 'cancelled') continue
    add(appointment.publicBookingModality, appointment.scheduledDate, appointment.scheduledTime)
  }
  const { data: reservations } = await admin
    .from('public_booking_reservations')
    .select('slot_date, slot_time, status, modality')
    .eq('professional_id', professionalId)
    .gte('slot_date', startDate)
    .lte('slot_date', endDate)
  for (const reservation of reservations ?? []) {
    if (reservation.status === 'cancelled') continue
    add(reservation.modality, reservation.slot_date, reservation.slot_time)
  }
  return usage
}

function normalizeSettings(raw: PublicBookingSettingsPayload | undefined): PublicBookingSettingsPayload & { blocks: PublicBookingBlock[]; slug: string; professionalId: string; professionalName: string; horizonDays: number; enabled: boolean } | null {
  const professionalId = raw?.professionalId?.trim() ?? ''
  const professionalName = raw?.professionalName?.trim() ?? ''
  const slug = normalizeSlug(raw?.slug ?? professionalName)
  const horizonDays = 60
  const blocks = normalizeBlocks(raw?.blocks)

  if (!professionalId || !professionalName || !slug) {
    return null
  }

  return {
    professionalId,
    professionalName,
    slug,
    enabled: Boolean(raw?.enabled),
    location: raw?.location?.trim() ?? '',
    reason: raw?.reason?.trim() ?? '',
    horizonDays,
    blocks,
  }
}

// Genera horarios distribuidos uniformemente entre startTime y endTime,
// tantos como slotCount indique (o cada intervalMinutes si se especifica).
function buildSlotTimes(startTime: string, endTime: string, slotCount: number, intervalMinutes?: number): string[] {
  const [startH, startM] = startTime.split(':').map(Number)
  const [endH, endM] = endTime.split(':').map(Number)
  const startMinutes = startH * 60 + startM
  const endMinutes = endH * 60 + endM
  const totalRange = Math.max(endMinutes - startMinutes, 0)

  const step = intervalMinutes && intervalMinutes > 0
    ? intervalMinutes
    : slotCount > 1
      ? Math.floor(totalRange / slotCount)
      : totalRange

  const times: string[] = []
  let cursor = startMinutes
  while (times.length < slotCount && cursor < endMinutes) {
    const h = Math.floor(cursor / 60)
    const m = cursor % 60
    times.push(`${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`)
    cursor += step > 0 ? step : 1
  }
  return times
}

function buildBlockSlotTimes(block: PublicBookingBlock): string[] {
  return buildSlotTimes(block.startTime, block.endTime, block.slotCount, block.durationMinutes)
}

function publicSettingsResponse(row: Record<string, unknown>) {
  return {
    professionalId: row.professional_id,
    slug: row.slug,
    enabled: row.enabled,
    professionalName: row.professional_name,
    location: row.location ?? '',
    reason: row.reason ?? '',
    horizonDays: row.horizon_days,
    blocks: row.availability_blocks ?? [],
    updatedAt: row.updated_at,
  }
}

serve(async (request) => {
  if (request.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }
  if (request.method !== 'POST') {
    return jsonResponse(405, { success: false, message: 'Método no permitido.' })
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL')
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  if (!supabaseUrl || !serviceRoleKey) {
    return jsonResponse(500, {
      success: false,
      message: 'Falta configurar SUPABASE_SERVICE_ROLE_KEY en los secrets de la función.',
    })
  }
  const admin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false },
  })

  let body: RequestBody
  try {
    body = await request.json()
  } catch {
    return jsonResponse(400, { success: false, message: 'Cuerpo JSON inválido.' })
  }

  try {
    switch (body.action) {
      case 'cancel-appointment': {
        const professionalId = await resolveProfessionalId(request, admin)
        const appointmentId = body.appointmentId?.trim()
        if (!professionalId) return jsonResponse(401, { success: false, message: 'Sesión profesional requerida.' })
        if (!appointmentId) return jsonResponse(400, { success: false, message: 'Falta el turno a cancelar.' })
        const { data: cancelled, error } = await admin.rpc('cancel_public_booking_appointment', {
          p_professional_id: professionalId,
          p_appointment_id: appointmentId,
        })
        if (error) return jsonResponse(500, { success: false, message: `No se pudo cancelar el turno: ${error.message}` })
        if (!cancelled) return jsonResponse(404, { success: false, message: 'El turno ya no está en tu agenda. Actualizá la pantalla.' })
        return jsonResponse(200, { success: true })
      }
      case 'create-link': {
        const professionalId = await resolveProfessionalId(request, admin)
        const slotDate = body.slotDate?.trim()
        const startTime = body.startTime?.trim()
        const endTime = body.endTime?.trim()
        const slotCount = Number(body.slotCount)
        const appointmentDays = Array.isArray(body.appointmentDays)
          ? body.appointmentDays.filter((day) => Number.isInteger(day) && day >= 0 && day <= 6)
          : [1, 2, 4]
        const dailyPatientLimit = Math.max(1, Math.min(100, Number(body.dailyPatientLimit) || 10))

        if (!professionalId || !slotDate || !startTime || !endTime || !slotCount) {
          return jsonResponse(400, {
            success: false,
            message: 'Faltan datos para crear el enlace (fecha, horario o cantidad de turnos).',
          })
        }
        if (slotCount < 1 || slotCount > 50) {
          return jsonResponse(400, { success: false, message: 'La cantidad de turnos debe ser entre 1 y 50.' })
        }
        if (startTime >= endTime) {
          return jsonResponse(400, { success: false, message: 'El horario de inicio debe ser anterior al de fin.' })
        }
        if (!appointmentDays.includes(new Date(`${slotDate}T12:00:00`).getDay())) {
          return jsonResponse(409, { success: false, message: 'Ese día no está habilitado para recibir turnos.' })
        }

        const token = generateToken()
        const rawAmount = Number(body.amountToCharge)
        const hasAmount = Number.isFinite(rawAmount) && rawAmount > 0
        const { data: link, error: linkError } = await admin
          .from('public_booking_links')
          .insert({
            token,
            professional_id: professionalId,
            professional_name: body.professionalName?.trim() ?? null,
            slot_date: slotDate,
            start_time: startTime,
            end_time: endTime,
            slot_count: slotCount,
            location: body.location?.trim() ?? null,
            reason: body.reason?.trim() ?? null,
            amount_to_charge: hasAmount ? rawAmount : null,
            amount_concept: hasAmount ? (body.amountConcept === 'sena' ? 'sena' : 'consulta') : null,
            payment_link: hasAmount ? (body.paymentLink?.trim() || null) : null,
            status: 'active',
            appointment_days: appointmentDays,
            daily_patient_limit: dailyPatientLimit,
          })
          .select('id, token')
          .single()

        if (linkError || !link) {
          return jsonResponse(500, { success: false, message: `No se pudo crear el enlace: ${linkError?.message}` })
        }

        const slotTimes = buildSlotTimes(startTime, endTime, slotCount, body.intervalMinutes)
        const slotsToInsert = slotTimes.map((slotTime) => ({
          link_id: link.id,
          slot_time: slotTime,
          is_booked: false,
        }))

        const { error: slotsError } = await admin.from('public_booking_slots').insert(slotsToInsert)
        if (slotsError) {
          await admin.from('public_booking_links').delete().eq('id', link.id)
          return jsonResponse(500, { success: false, message: `No se pudieron crear los turnos: ${slotsError.message}` })
        }

        return jsonResponse(200, { success: true, token: link.token, slotCount: slotsToInsert.length })
      }

      case 'list-links': {
        const professionalId = await resolveProfessionalId(request, admin)
        if (!professionalId) {
          return jsonResponse(400, { success: false, message: 'Falta el identificador del profesional.' })
        }
        const { data: links, error } = await admin
          .from('public_booking_links')
          .select('id, token, slot_date, start_time, end_time, slot_count, location, reason, status, created_at')
          .eq('professional_id', professionalId)
          .order('created_at', { ascending: false })
          .limit(50)
        if (error) {
          return jsonResponse(500, { success: false, message: error.message })
        }

        const linkIds = (links ?? []).map((l) => l.id)
        let slotsByLink: Record<string, { total: number; booked: number }> = {}
        if (linkIds.length > 0) {
          const { data: slots } = await admin
            .from('public_booking_slots')
            .select('link_id, is_booked')
            .in('link_id', linkIds)
          slotsByLink = (slots ?? []).reduce((acc: Record<string, { total: number; booked: number }>, s) => {
            const entry = acc[s.link_id] ?? { total: 0, booked: 0 }
            entry.total += 1
            if (s.is_booked) entry.booked += 1
            acc[s.link_id] = entry
            return acc
          }, {})
        }

        const enriched = (links ?? []).map((l) => ({
          ...l,
          totalSlots: slotsByLink[l.id]?.total ?? l.slot_count,
          bookedSlots: slotsByLink[l.id]?.booked ?? 0,
        }))

        return jsonResponse(200, { success: true, links: enriched })
      }

      case 'cancel-link': {
        const linkId = body.linkId?.trim()
        const professionalId = await resolveProfessionalId(request, admin)
        if (!linkId || !professionalId) {
          return jsonResponse(400, { success: false, message: 'Faltan datos para cancelar el enlace.' })
        }
        const { error } = await admin
          .from('public_booking_links')
          .update({ status: 'cancelled' })
          .eq('id', linkId)
          .eq('professional_id', professionalId)
        if (error) {
          return jsonResponse(500, { success: false, message: error.message })
        }
        return jsonResponse(200, { success: true })
      }

      case 'get-public-settings': {
        const professionalId = await resolveProfessionalId(request, admin)
        if (!professionalId) {
          return jsonResponse(400, { success: false, message: 'Falta el identificador del profesional.' })
        }
        const { data: settings, error } = await admin
          .from('public_booking_profiles')
          .select('professional_id, slug, enabled, professional_name, location, reason, horizon_days, availability_blocks, updated_at')
          .eq('professional_id', professionalId)
          .maybeSingle()
        if (error) {
          return jsonResponse(500, { success: false, message: error.message })
        }
        return jsonResponse(200, {
          success: true,
          settings: settings ? publicSettingsResponse(settings) : null,
        })
      }

      case 'save-public-settings': {
        const settings = normalizeSettings(body.settings)
        if (!settings) {
          return jsonResponse(400, {
            success: false,
            message: 'Configurá nombre, link público y al menos un bloque horario válido.',
          })
        }
        const professionalId = await resolveProfessionalId(request, admin)
        if (!professionalId) return jsonResponse(401, { success: false, message: 'Sesión profesional requerida.' })
        settings.professionalId = professionalId
        settings.slug = await resolveFixedSlug(admin, professionalId, settings.slug, settings.professionalName)
        const { data: saved, error } = await admin
          .from('public_booking_profiles')
          .upsert({
            professional_id: settings.professionalId,
            slug: settings.slug,
            enabled: settings.blocks.length > 0,
            professional_name: settings.professionalName,
            location: settings.location || null,
            reason: settings.reason || null,
            horizon_days: settings.horizonDays,
            availability_blocks: settings.blocks,
            updated_at: new Date().toISOString(),
          }, { onConflict: 'professional_id' })
          .select('professional_id, slug, enabled, professional_name, location, reason, horizon_days, availability_blocks, updated_at')
          .single()

        if (error || !saved) {
          const isDuplicateSlug = error?.message?.toLowerCase().includes('duplicate') || error?.code === '23505'
          return jsonResponse(isDuplicateSlug ? 409 : 500, {
            success: false,
            message: isDuplicateSlug
              ? 'Ese link público ya está en uso. Elegí otro nombre corto.'
              : `No se pudo guardar la turnera pública: ${error?.message}`,
          })
        }

        return jsonResponse(200, { success: true, settings: publicSettingsResponse(saved) })
      }

      case 'get-public-agenda': {
        const slug = normalizeSlug(body.slug ?? '')
        if (!slug) {
          return jsonResponse(400, { success: false, message: 'Falta el link público del profesional.' })
        }

        const { data: settings, error } = await findProfileBySlug(admin, slug)
        if (error) {
          return jsonResponse(500, { success: false, message: error.message })
        }
        if (!settings || !settings.enabled) {
          return jsonResponse(404, { success: false, message: 'Esta turnera pública no está disponible.' })
        }

        const allAgendaBlocks = normalizeBlocks(settings.availability_blocks)
        const agendaBlock = pickBlock(allAgendaBlocks, requestedModality(body.modality))
        if (!agendaBlock) {
          return jsonResponse(404, { success: false, message: 'Esta turnera pública no está disponible.' })
        }
        const blocks = [agendaBlock]
        const horizonDays = 60
        const startDate = body.startDate && body.startDate >= todayISO() ? body.startDate : todayISO()
        const requestedDays = Math.max(1, Math.min(35, Number(body.days) || 21))
        const maxDate = addDays(todayISO(), horizonDays - 1)
        const endDate = addDays(startDate, requestedDays - 1) > maxDate ? maxDate : addDays(startDate, requestedDays - 1)

        const { data: workspace } = await admin
          .from('user_workspaces')
          .select('appointments_json')
          .eq('user_id', settings.professional_id)
          .maybeSingle()
        await admin
          .from('public_booking_reservations')
          .update({ status: 'cancelled', payment_status: 'expired' })
          .eq('professional_id', settings.professional_id)
          .eq('status', 'pending_payment')
          .lt('created_at', pendingReservationCutoff())
        const currentAppointments = Array.isArray(workspace?.appointments_json) ? workspace.appointments_json as AppointmentLike[] : []
        const busyIntervals = await loadBusyIntervals(admin, settings.professional_id, currentAppointments, allAgendaBlocks, startDate, endDate)
        const modalityUsage = await loadModalityUsage(admin, settings.professional_id, currentAppointments, startDate, endDate)

        const days: Array<{ date: string; slots: Array<Record<string, unknown>>; holiday?: string }> = []
        for (let offset = 0; offset < requestedDays; offset += 1) {
          const date = addDays(startDate, offset)
          if (date > maxDate) break
          const weekday = dateDay(date)
          const holiday = getHolidayName(date)
          const slots = holiday ? [] : blocks.flatMap((block) => {
            if (!block.days.includes(weekday)) return []
            const quotaReached = (modalityUsage.get(`${block.modality}|${date}`)?.size ?? 0) >= (block.dailyQuota ?? block.slotCount)
            return buildBlockSlotTimes(block).map((time) => {
              const amount = block.modality === 'private' ? block.amountToCharge ?? null : null
              return {
                id: `${block.id}-${date}-${time}`,
                blockId: block.id,
                time,
                available: !quotaReached && !overlapsBusy(busyIntervals, date, time, block.durationMinutes),
                label: block.label,
                modality: block.modality,
                durationMinutes: block.durationMinutes,
                location: block.location || settings.location || '',
                reason: block.reason || settings.reason || '',
                amountToCharge: amount,
                amountConcept: amount ? block.amountConcept || 'consulta' : null,
                paymentLink: amount ? block.paymentLink || null : null,
              }
            })
          }).sort((left, right) => String(left.time).localeCompare(String(right.time)))
          days.push(holiday ? { date, slots, holiday } : { date, slots })
        }

        return jsonResponse(200, {
          success: true,
          profile: {
            slug: settings.slug,
            professionalName: settings.professional_name,
            location: settings.location,
            reason: settings.reason,
            horizonDays,
            modality: agendaBlock.modality,
          },
          days,
        })
      }

      case 'book-public-slot': {
        const slug = normalizeSlug(body.slug ?? '')
        const slotDate = body.slotDate?.trim() ?? ''
        const slotTime = body.slotTime?.trim() ?? ''
        const blockId = body.blockId?.trim() ?? ''
        const patientName = body.patientName?.trim() ?? ''
        const patientDni = (body.patientDni ?? '').replace(/\D/g, '')
        const patientEmail = body.patientEmail?.trim() ?? ''
        const patientPhone = body.patientPhone?.trim() ?? ''

        if (!slug || !slotDate || !slotTime || !blockId || !patientName || !patientDni) {
          return jsonResponse(400, { success: false, message: 'Completa nombre, DNI y horario para reservar.' })
        }

        const { data: settings, error } = await findProfileBySlug(admin, slug)
        if (error) {
          return jsonResponse(500, { success: false, message: error.message })
        }
        if (!settings || !settings.enabled) {
          return jsonResponse(404, { success: false, message: 'Esta turnera pública no está disponible.' })
        }
        await admin
          .from('public_booking_reservations')
          .update({ status: 'cancelled', payment_status: 'expired' })
          .eq('professional_id', settings.professional_id)
          .eq('status', 'pending_payment')
          .lt('created_at', pendingReservationCutoff())
        if (slotDate < todayISO() || slotDate > addDays(todayISO(), 59)) {
          return jsonResponse(409, { success: false, message: 'La fecha elegida está fuera del rango habilitado.' })
        }
        const slotHoliday = getHolidayName(slotDate)
        if (slotHoliday) {
          return jsonResponse(409, { success: false, message: `Ese día es feriado nacional (${slotHoliday}). Elegí otra fecha.` })
        }

        const block = normalizeBlocks(settings.availability_blocks).find((entry) => entry.id === blockId)
        if (!block || !block.days.includes(dateDay(slotDate)) || !buildBlockSlotTimes(block).includes(slotTime)) {
          return jsonResponse(409, { success: false, message: 'Ese horario ya no está habilitado.' })
        }
        if (block.modality === 'private' && (!block.amountToCharge || block.amountToCharge <= 0)) {
          return jsonResponse(409, { success: false, message: 'Este turno particular todavía no tiene un monto configurado para pagar por Mercado Pago.' })
        }
        if (block.modality === 'private' && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(patientEmail)) {
          return jsonResponse(400, { success: false, message: 'Para pagar con Mercado Pago necesitás ingresar un email válido.' })
        }
        if (block.modality === 'coverage' && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(patientEmail)) {
          return jsonResponse(400, { success: false, message: 'Ingresá un email válido para recibir la confirmación del turno.' })
        }

        const { data: workspace } = await admin
          .from('user_workspaces')
          .select('appointments_json')
          .eq('user_id', settings.professional_id)
          .maybeSingle()
        const currentAppointments = Array.isArray(workspace?.appointments_json) ? workspace.appointments_json : []
        const busyForDay = await loadBusyIntervals(admin, settings.professional_id, currentAppointments as AppointmentLike[], normalizeBlocks(settings.availability_blocks), slotDate, slotDate)
        if (overlapsBusy(busyForDay, slotDate, slotTime, block.durationMinutes)) {
          return jsonResponse(409, { success: false, message: 'Ese horario ya fue reservado. Elegí otro disponible.' })
        }
        const usageForDay = await loadModalityUsage(admin, settings.professional_id, currentAppointments as AppointmentLike[], slotDate, slotDate)
        if ((usageForDay.get(`${block.modality}|${slotDate}`)?.size ?? 0) >= (block.dailyQuota ?? block.slotCount)) {
          return jsonResponse(409, { success: false, message: 'Ya no quedan turnos disponibles para ese día. Elegí otra fecha.' })
        }

        const appointmentId = crypto.randomUUID()
        const amount = block.modality === 'private' && block.amountToCharge ? Number(block.amountToCharge) : null
        const status = amount ? 'pending_payment' : 'confirmed'
        const { error: reservationError } = await admin.from('public_booking_reservations').insert({
          professional_id: settings.professional_id,
          slug: settings.slug,
          slot_date: slotDate,
          slot_time: slotTime,
          block_id: block.id,
          modality: block.modality,
          patient_name: patientName,
          patient_dni: patientDni,
          patient_email: patientEmail || null,
          patient_phone: patientPhone || null,
          appointment_id: appointmentId,
          status,
          amount_to_charge: amount,
          amount_concept: amount ? block.amountConcept || 'consulta' : null,
          payment_link: amount ? block.paymentLink || null : null,
        })
        if (reservationError) {
          return jsonResponse(409, { success: false, message: 'Ese horario ya fue reservado. Elegí otro disponible.' })
        }

        let paymentPreferenceId: string | null = null
        let paymentInitPoint: string | null = null
        if (amount && block.modality === 'private') {
          const { data: paymentAccount } = await admin
            .from('professional_payment_accounts')
            .select('access_token_encrypted, status')
            .eq('professional_id', settings.professional_id)
            .eq('provider', 'mercadopago')
            .maybeSingle()
          if (paymentAccount?.status === 'connected') {
            try {
              const accessToken = await decryptPaymentToken(paymentAccount.access_token_encrypted)
              const preferenceResponse = await fetch('https://api.mercadopago.com/checkout/preferences', {
                method: 'POST',
                headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json', 'X-Idempotency-Key': crypto.randomUUID() },
                body: JSON.stringify({
                  items: [{ id: appointmentId, title: block.reason || settings.reason || 'Consulta médica', quantity: 1, currency_id: 'ARS', unit_price: amount }],
                  payer: { email: patientEmail, name: patientName },
                  external_reference: appointmentId,
                  back_urls: {
                    success: `${Deno.env.get('APP_BASE_URL') || 'https://drhappy.com.ar'}/turnos/`,
                    pending: `${Deno.env.get('APP_BASE_URL') || 'https://drhappy.com.ar'}/turnos/`,
                    failure: `${Deno.env.get('APP_BASE_URL') || 'https://drhappy.com.ar'}/turnos/`,
                  },
                  auto_return: 'approved',
                  notification_url: `${supabaseUrl}/functions/v1/mercadopago-patient-webhook?professional_id=${encodeURIComponent(settings.professional_id)}`,
                }),
              })
              const preference = await preferenceResponse.json().catch(() => null)
              if (preferenceResponse.ok && preference?.id && preference?.init_point) {
                paymentPreferenceId = String(preference.id)
                paymentInitPoint = String(preference.init_point)
                await admin.from('public_booking_reservations').update({ payment_preference_id: paymentPreferenceId, payment_init_point: paymentInitPoint, payment_status: 'pending' }).eq('appointment_id', appointmentId)
              }
            } catch (paymentError) {
              console.error('[public-booking] No se pudo crear checkout del profesional:', paymentError)
            }
          } else {
            await admin.from('public_booking_reservations').update({ status: 'cancelled', payment_status: 'account_not_connected' }).eq('appointment_id', appointmentId)
            return jsonResponse(503, { success: false, message: 'El profesional todavía no conectó Mercado Pago. El turno no quedó reservado.' })
          }
        }
        if (amount && !paymentInitPoint) {
          await admin.from('public_booking_reservations').update({ status: 'cancelled', payment_status: 'error' }).eq('appointment_id', appointmentId)
          return jsonResponse(503, { success: false, message: 'Mercado Pago no pudo preparar el checkout. El turno no quedó reservado; intentá nuevamente.' })
        }

        const newAppointment = {
          id: appointmentId,
          patientId: crypto.randomUUID(),
          patientName,
          patientEmail,
          patientDni,
          scheduledDate: slotDate,
          scheduledTime: slotTime,
          scheduledAt: `${slotDate}T${slotTime}:00`,
          durationMinutes: block.durationMinutes,
          reason: block.reason || settings.reason || block.label || 'Turno reservado por turnera pública',
          notes: [
            `Reservado desde turnera pública (${block.modality === 'private' ? 'particular' : 'gratuita'}).`,
            patientPhone ? `Teléfono de contacto: ${patientPhone}` : '',
            amount ? 'Pago informado al paciente.' : '',
          ].filter(Boolean).join(' '),
          location: block.location || settings.location || 'Consultorio médico',
          status: amount ? 'pending' : 'confirmed',
          createdAt: new Date().toISOString(),
          createdByUserId: settings.professional_id,
          publicBookingModality: block.modality,
          ...(amount ? { amountToCharge: amount, amountConcept: block.amountConcept || 'consulta' } : {}),
        }

        if (!amount) {
          const { error: upsertError } = await admin.from('user_workspaces').upsert(
            { user_id: settings.professional_id, appointments_json: [...currentAppointments, newAppointment] },
            { onConflict: 'user_id' },
          )
          if (upsertError) {
            await admin.from('public_booking_reservations').update({ status: 'cancelled' }).eq('appointment_id', appointmentId)
            return jsonResponse(500, { success: false, message: `No se pudo agendar el turno: ${upsertError.message}` })
          }
        }

        const professionalEmailSent = await notifyProfessionalRegistration({
          admin, url: supabaseUrl, key: serviceRoleKey, professionalId: newAppointment.createdByUserId, eventId: appointmentId,
          event: {
            source: 'booking', patientName, patientEmail, patientPhone,
            date: slotDate, time: slotTime, location: newAppointment.location,
            status: amount ? 'pending_payment' : 'confirmed',
          },
        })
        let emailSent = false
        if (patientEmail) {
          try {
            const emailResponse = await fetch(`${supabaseUrl}/functions/v1/send-email`, {
              method: 'POST',
              headers: {
                Authorization: `Bearer ${serviceRoleKey}`,
                apikey: serviceRoleKey,
                'Content-Type': 'application/json',
              },
              body: JSON.stringify({
                to: patientEmail,
                subject: amount
                  ? `Completá el pago para confirmar tu turno con ${settings.professional_name}`
                  : `Turno confirmado con ${settings.professional_name} - ${slotDate} ${slotTime} hs`,
                type: 'appointment',
                templateData: {
                  patientName,
                  professionalName: settings.professional_name,
                  specialty: 'Consulta médica',
                  date: slotDate,
                  time: slotTime,
                  location: newAppointment.location,
                  notes: amount ? 'Tu turno quedará confirmado cuando Mercado Pago apruebe el pago.' : newAppointment.notes,
                  amountToCharge: amount,
                  amountConcept: amount ? block.amountConcept || 'consulta' : undefined,
                  paymentLink: amount ? paymentInitPoint || block.paymentLink || undefined : undefined,
                },
              }),
            })
            const emailResult: unknown = await emailResponse.json()
            emailSent = emailResponse.ok && Boolean(emailResult && typeof emailResult === 'object' && 'success' in emailResult && emailResult.success === true)
            if (!emailSent) console.error('[public-booking] Confirmación al paciente no enviada', { appointmentId, status: emailResponse.status })
          } catch (error) {
            console.error('[public-booking] Confirmación al paciente no enviada; reserva conservada', { appointmentId, message: error instanceof Error ? error.message : String(error) })
          }
        }

        return jsonResponse(200, {
          success: true,
          paymentRequired: Boolean(amount),
          paymentUrl: paymentInitPoint,
          paymentPreferenceId,
          appointment: {
            date: slotDate,
            time: slotTime,
            professionalName: settings.professional_name,
            location: newAppointment.location,
            modality: block.modality,
            amountToCharge: amount,
            amountConcept: amount ? block.amountConcept || 'consulta' : null,
            paymentLink: amount ? block.paymentLink || null : null,
          },
          emailSent,
          professionalEmailSent,
        })
      }

      case 'get-link': {
        const token = body.token?.trim()
        if (!token) {
          return jsonResponse(400, { success: false, message: 'Falta el token del enlace.' })
        }
        const { data: link, error } = await admin
          .from('public_booking_links')
          .select('id, professional_name, slot_date, start_time, end_time, location, reason, status, amount_to_charge, amount_concept, payment_link')
          .eq('token', token)
          .maybeSingle()
        if (error) {
          return jsonResponse(500, { success: false, message: error.message })
        }
        if (!link || link.status !== 'active') {
          return jsonResponse(404, { success: false, message: 'Este enlace de turnos ya no está disponible.' })
        }

        const { data: slots, error: slotsError } = await admin
          .from('public_booking_slots')
          .select('id, slot_time, is_booked')
          .eq('link_id', link.id)
          .order('slot_time', { ascending: true })
        if (slotsError) {
          return jsonResponse(500, { success: false, message: slotsError.message })
        }

        return jsonResponse(200, {
          success: true,
          link: {
            professionalName: link.professional_name,
            slotDate: link.slot_date,
            location: link.location,
            reason: link.reason,
            amountToCharge: link.amount_to_charge,
            amountConcept: link.amount_concept,
            paymentLink: link.payment_link,
          },
          slots: (slots ?? []).map((s) => ({ id: s.id, time: s.slot_time, available: !s.is_booked })),
        })
      }

      case 'book-slot': {
        const token = body.token?.trim()
        const slotTime = body.slotTime?.trim()
        const patientName = body.patientName?.trim()
        const patientDni = (body.patientDni ?? '').replace(/\D/g, '')
        const patientEmail = body.patientEmail?.trim() ?? ''
        const patientPhone = body.patientPhone?.trim() ?? ''

        if (!token || !slotTime || !patientName || !patientDni) {
          return jsonResponse(400, {
            success: false,
            message: 'Completa nombre, DNI y elige un horario para confirmar el turno.',
          })
        }

        const { data: link, error: linkError } = await admin
          .from('public_booking_links')
          .select('id, professional_id, slot_date, location, reason, status, amount_to_charge, amount_concept, payment_link, appointment_days, daily_patient_limit')
          .eq('token', token)
          .maybeSingle()
        if (linkError) {
          return jsonResponse(500, { success: false, message: linkError.message })
        }
        if (!link || link.status !== 'active') {
          return jsonResponse(404, { success: false, message: 'Este enlace de turnos ya no está disponible.' })
        }

        const configuredDays = Array.isArray(link.appointment_days) ? link.appointment_days : [1, 2, 4]
        if (!configuredDays.includes(new Date(`${link.slot_date}T12:00:00`).getDay())) {
          return jsonResponse(409, { success: false, message: 'Ese día ya no está habilitado para recibir turnos.' })
        }
        const { data: capacityWorkspace } = await admin
          .from('user_workspaces')
          .select('appointments_json')
          .eq('user_id', link.professional_id)
          .maybeSingle()
        const appointmentsForDate = Array.isArray(capacityWorkspace?.appointments_json)
          ? capacityWorkspace.appointments_json.filter((appointment: { scheduledDate?: string; status?: string }) => appointment.scheduledDate === link.slot_date && appointment.status !== 'cancelled').length
          : 0
        if (appointmentsForDate >= Number(link.daily_patient_limit ?? 10)) {
          return jsonResponse(409, { success: false, message: 'No quedan turnos disponibles para ese día.' })
        }

        const { data: slot, error: slotError } = await admin
          .from('public_booking_slots')
          .select('id, is_booked')
          .eq('link_id', link.id)
          .eq('slot_time', slotTime)
          .maybeSingle()
        if (slotError || !slot) {
          return jsonResponse(404, { success: false, message: 'El horario elegido no existe.' })
        }
        if (slot.is_booked) {
          return jsonResponse(409, { success: false, message: 'Ese horario ya fue reservado por otro paciente. Elegí otro disponible.' })
        }

        const appointmentId = crypto.randomUUID()
        const nowIso = new Date().toISOString()

        // Marca el slot como reservado (condición atómica: sólo si seguía libre).
        const { data: updatedSlot, error: updateError } = await admin
          .from('public_booking_slots')
          .update({
            is_booked: true,
            patient_name: patientName,
            patient_dni: patientDni,
            patient_email: patientEmail || null,
            patient_phone: patientPhone || null,
            appointment_id: appointmentId,
            booked_at: nowIso,
          })
          .eq('id', slot.id)
          .eq('is_booked', false)
          .select('id')
          .maybeSingle()

        if (updateError || !updatedSlot) {
          return jsonResponse(409, { success: false, message: 'Ese horario ya fue reservado por otro paciente. Elegí otro disponible.' })
        }

        // Inserta el turno directamente en la Turnera global del profesional
        // (misma estructura que usa la app: user_workspaces.appointments_json).
        const { data: workspace, error: workspaceError } = await admin
          .from('user_workspaces')
          .select('user_id, appointments_json')
          .eq('user_id', link.professional_id)
          .maybeSingle()
        if (workspaceError) {
          return jsonResponse(500, { success: false, message: `No se pudo acceder a la agenda del profesional: ${workspaceError.message}` })
        }

        const currentAppointments = Array.isArray(workspace?.appointments_json) ? workspace!.appointments_json : []
        const newAppointment = {
          id: appointmentId,
          patientId: crypto.randomUUID(),
          patientName,
          patientEmail,
          patientDni,
          scheduledDate: link.slot_date,
          scheduledTime: slotTime,
          scheduledAt: `${link.slot_date}T${slotTime}:00`,
          durationMinutes: 30,
          reason: link.reason || 'Turno reservado por el paciente (turnos libres)',
          notes: patientPhone ? `Teléfono de contacto: ${patientPhone}` : '',
          location: link.location || 'Consultorio médico',
          status: 'pending',
          createdAt: nowIso,
          createdByUserId: link.professional_id,
          ...(link.amount_to_charge
            ? {
                amountToCharge: Number(link.amount_to_charge),
                amountConcept: link.amount_concept === 'sena' ? 'sena' : 'consulta',
              }
            : {}),
        }

        const nextAppointments = [...currentAppointments, newAppointment]

        const { error: upsertError } = await admin.from('user_workspaces').upsert(
          { user_id: link.professional_id, appointments_json: nextAppointments },
          { onConflict: 'user_id' },
        )
        if (upsertError) {
          return jsonResponse(500, { success: false, message: `No se pudo agendar el turno: ${upsertError.message}` })
        }

        const professionalEmailSent = await notifyProfessionalRegistration({
          admin, url: supabaseUrl, key: serviceRoleKey, professionalId: link.professional_id, eventId: appointmentId,
          event: {
            source: 'booking', patientName, patientEmail, patientPhone,
            date: link.slot_date, time: slotTime, location: newAppointment.location, status: 'pending',
          },
        })
        return jsonResponse(200, {
          success: true,
          professionalEmailSent,
          appointment: {
            date: link.slot_date,
            time: slotTime,
            location: link.location,
            amountToCharge: link.amount_to_charge ? Number(link.amount_to_charge) : null,
            amountConcept: link.amount_concept ?? null,
            paymentLink: link.payment_link ?? null,
          },
        })
      }

      default:
        return jsonResponse(400, { success: false, message: 'Acción no soportada.' })
    }
  } catch (error) {
    return jsonResponse(500, {
      success: false,
      message: error instanceof Error ? error.message : 'Error inesperado en el servidor.',
    })
  }
})
