import { serve } from 'https://deno.land/std@0.224.0/http/server.ts'
import { createClient } from 'jsr:@supabase/supabase-js@2'
import { corsHeaders } from '../_shared/cors.ts'

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
  linkId?: string
  appointmentDays?: number[]
  dailyPatientLimit?: number
  settings?: PublicBookingSettingsPayload
  slug?: string
  startDate?: string
  days?: number
  blockId?: string
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

function todayISO(): string {
  return new Date().toISOString().slice(0, 10)
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
    location: typeof block.location === 'string' ? block.location.trim().slice(0, 160) : '',
    reason: typeof block.reason === 'string' ? block.reason.trim().slice(0, 160) : '',
    amountToCharge: hasAmount ? rawAmount : undefined,
    amountConcept: hasAmount ? (block.amountConcept === 'sena' ? 'sena' : 'consulta') : undefined,
    paymentLink: hasAmount && typeof block.paymentLink === 'string' ? block.paymentLink.trim().slice(0, 500) : undefined,
  }
}

function normalizeSettings(raw: PublicBookingSettingsPayload | undefined): PublicBookingSettingsPayload & { blocks: PublicBookingBlock[]; slug: string; professionalId: string; professionalName: string; horizonDays: number; enabled: boolean } | null {
  const professionalId = raw?.professionalId?.trim() ?? ''
  const professionalName = raw?.professionalName?.trim() ?? ''
  const slug = normalizeSlug(raw?.slug ?? professionalName)
  const horizonDays = Math.max(7, Math.min(180, Math.round(Number(raw?.horizonDays) || 60)))
  const blocks = (raw?.blocks ?? []).map(normalizeBlock).filter((block): block is PublicBookingBlock => Boolean(block))

  if (!professionalId || !professionalName || !slug || !blocks.length) {
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
      case 'create-link': {
        const professionalId = body.professionalId?.trim()
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
        const professionalId = body.professionalId?.trim()
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
        const professionalId = body.professionalId?.trim()
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
        const professionalId = body.professionalId?.trim()
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

        const { data: saved, error } = await admin
          .from('public_booking_profiles')
          .upsert({
            professional_id: settings.professionalId,
            slug: settings.slug,
            enabled: settings.enabled,
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

        const { data: settings, error } = await admin
          .from('public_booking_profiles')
          .select('professional_id, slug, enabled, professional_name, location, reason, horizon_days, availability_blocks')
          .eq('slug', slug)
          .maybeSingle()
        if (error) {
          return jsonResponse(500, { success: false, message: error.message })
        }
        if (!settings || !settings.enabled) {
          return jsonResponse(404, { success: false, message: 'Esta turnera pública no está disponible.' })
        }

        const blocks = (Array.isArray(settings.availability_blocks) ? settings.availability_blocks : [])
          .map(normalizeBlock)
          .filter((block): block is PublicBookingBlock => Boolean(block))
        const horizonDays = Math.max(7, Math.min(180, Number(settings.horizon_days) || 60))
        const startDate = body.startDate && body.startDate >= todayISO() ? body.startDate : todayISO()
        const requestedDays = Math.max(1, Math.min(35, Number(body.days) || 21))
        const maxDate = addDays(todayISO(), horizonDays - 1)
        const endDate = addDays(startDate, requestedDays - 1) > maxDate ? maxDate : addDays(startDate, requestedDays - 1)

        const { data: workspace } = await admin
          .from('user_workspaces')
          .select('appointments_json')
          .eq('user_id', settings.professional_id)
          .maybeSingle()
        const currentAppointments = Array.isArray(workspace?.appointments_json) ? workspace.appointments_json as AppointmentLike[] : []
        const bookedAppointments = new Set(
          currentAppointments
            .filter((appointment) => appointment.status !== 'cancelled' && appointment.scheduledDate && appointment.scheduledTime)
            .map((appointment) => `${appointment.scheduledDate}|${appointment.scheduledTime}`),
        )

        const { data: reservations } = await admin
          .from('public_booking_reservations')
          .select('slot_date, slot_time, status')
          .eq('professional_id', settings.professional_id)
          .gte('slot_date', startDate)
          .lte('slot_date', endDate)
        const bookedReservations = new Set(
          (reservations ?? [])
            .filter((reservation) => reservation.status !== 'cancelled')
            .map((reservation) => `${reservation.slot_date}|${reservation.slot_time}`),
        )

        const days: Array<{ date: string; slots: Array<Record<string, unknown>> }> = []
        for (let offset = 0; offset < requestedDays; offset += 1) {
          const date = addDays(startDate, offset)
          if (date > maxDate) break
          const weekday = dateDay(date)
          const slots = blocks.flatMap((block) => {
            if (!block.days.includes(weekday)) return []
            return buildBlockSlotTimes(block).map((time) => {
              const key = `${date}|${time}`
              const amount = block.modality === 'private' ? block.amountToCharge ?? null : null
              return {
                id: `${block.id}-${date}-${time}`,
                blockId: block.id,
                time,
                available: !bookedAppointments.has(key) && !bookedReservations.has(key),
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
          days.push({ date, slots })
        }

        return jsonResponse(200, {
          success: true,
          profile: {
            slug: settings.slug,
            professionalName: settings.professional_name,
            location: settings.location,
            reason: settings.reason,
            horizonDays,
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
        const patientDni = body.patientDni?.trim() ?? ''
        const patientEmail = body.patientEmail?.trim() ?? ''
        const patientPhone = body.patientPhone?.trim() ?? ''

        if (!slug || !slotDate || !slotTime || !blockId || !patientName || !patientDni) {
          return jsonResponse(400, { success: false, message: 'Completa nombre, DNI y horario para reservar.' })
        }

        const { data: settings, error } = await admin
          .from('public_booking_profiles')
          .select('professional_id, slug, enabled, professional_name, location, reason, horizon_days, availability_blocks')
          .eq('slug', slug)
          .maybeSingle()
        if (error) {
          return jsonResponse(500, { success: false, message: error.message })
        }
        if (!settings || !settings.enabled) {
          return jsonResponse(404, { success: false, message: 'Esta turnera pública no está disponible.' })
        }
        if (slotDate < todayISO() || slotDate > addDays(todayISO(), Math.max(7, Math.min(180, Number(settings.horizon_days) || 60)) - 1)) {
          return jsonResponse(409, { success: false, message: 'La fecha elegida está fuera del rango habilitado.' })
        }

        const blocks = (Array.isArray(settings.availability_blocks) ? settings.availability_blocks : [])
          .map(normalizeBlock)
          .filter((block): block is PublicBookingBlock => Boolean(block))
        const block = blocks.find((entry) => entry.id === blockId)
        if (!block || !block.days.includes(dateDay(slotDate)) || !buildBlockSlotTimes(block).includes(slotTime)) {
          return jsonResponse(409, { success: false, message: 'Ese horario ya no está habilitado.' })
        }

        const { data: workspace } = await admin
          .from('user_workspaces')
          .select('appointments_json')
          .eq('user_id', settings.professional_id)
          .maybeSingle()
        const currentAppointments = Array.isArray(workspace?.appointments_json) ? workspace.appointments_json : []
        const alreadyBooked = currentAppointments.some((appointment: AppointmentLike) =>
          appointment.status !== 'cancelled' && appointment.scheduledDate === slotDate && appointment.scheduledTime === slotTime,
        )
        if (alreadyBooked) {
          return jsonResponse(409, { success: false, message: 'Ese horario ya fue reservado. Elegí otro disponible.' })
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
            `Reservado desde turnera pública (${block.modality === 'private' ? 'particular' : 'cobertura'}).`,
            patientPhone ? `Teléfono de contacto: ${patientPhone}` : '',
            amount ? 'Pago informado al paciente.' : '',
          ].filter(Boolean).join(' '),
          location: block.location || settings.location || 'Consultorio médico',
          status: amount ? 'pending' : 'confirmed',
          createdAt: new Date().toISOString(),
          createdByUserId: settings.professional_id,
          ...(amount ? { amountToCharge: amount, amountConcept: block.amountConcept || 'consulta' } : {}),
        }

        const { error: upsertError } = await admin.from('user_workspaces').upsert(
          { user_id: settings.professional_id, appointments_json: [...currentAppointments, newAppointment] },
          { onConflict: 'user_id' },
        )
        if (upsertError) {
          await admin.from('public_booking_reservations').update({ status: 'cancelled' }).eq('appointment_id', appointmentId)
          return jsonResponse(500, { success: false, message: `No se pudo agendar el turno: ${upsertError.message}` })
        }

        return jsonResponse(200, {
          success: true,
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
        const patientDni = body.patientDni?.trim()
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

        return jsonResponse(200, {
          success: true,
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
