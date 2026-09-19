import { corsHeaders } from '../_shared/cors.ts'
import { createClient } from 'jsr:@supabase/supabase-js@2'
import { resolveProfessionalId } from '../_shared/professionalSession.ts'

interface AssistantMessage {
  role: 'user' | 'assistant'
  content: string
}

const tools = [
  {
    name: 'buscar_turnos',
    description: 'Busca turnos del profesional autenticado. Usala cuando el profesional pregunte por su agenda, turnos de una fecha o próximos turnos.',
    input_schema: {
      type: 'object',
      properties: {
        date: { type: 'string', description: 'Fecha YYYY-MM-DD opcional.' },
        upcoming: { type: 'boolean', description: 'Si es true, devuelve próximos turnos.' },
      },
    },
  },
  {
    name: 'consultar_calendario_ocupacion',
    description: 'Consulta la ocupación real de la agenda del profesional: cupo diario, días de atención, cantidad ocupada y lugares libres por fecha.',
    input_schema: { type: 'object', properties: { date: { type: 'string', description: 'Fecha YYYY-MM-DD opcional.' }, month: { type: 'string', description: 'Mes YYYY-MM opcional.' } } },
  },
  {
    name: 'consultar_turnera_publica',
    description: 'Consulta la turnera pública de solo lectura: si está activa, bloques liberados, modalidad, fechas y horarios disponibles. Nunca modifica ni reserva turnos públicos.',
    input_schema: { type: 'object', properties: { date: { type: 'string', description: 'Fecha YYYY-MM-DD opcional.' }, modality: { type: 'string', enum: ['coverage', 'private'], description: 'Filtra por obra social o particular.' } } },
  },
  {
    name: 'obtener_link_pago_profesional',
    description: 'Obtiene el link o alias de pago que el profesional tiene guardado en su perfil. Nunca inventes uno.',
    input_schema: { type: 'object', properties: {} },
  },
  {
    name: 'buscar_memorias_sofia',
    description: 'Busca preferencias y temas que el profesional pidió recordar. No incluye historias clínicas ni datos de pacientes.',
    input_schema: { type: 'object', properties: { query: { type: 'string', description: 'Tema o palabra clave opcional.' } } },
  },
  {
    name: 'guardar_memoria_sofia',
    description: 'Guarda una preferencia o tema de trabajo que el profesional pidió recordar. Nunca guardes datos clínicos de pacientes. Requiere confirmation=true.',
    input_schema: { type: 'object', properties: { topic: { type: 'string' }, content: { type: 'string' }, confirmation: { type: 'boolean' } }, required: ['topic', 'content', 'confirmation'] },
  },
  {
    name: 'buscar_pacientes',
    description: 'Busca pacientes del profesional autenticado por nombre, apellido o DNI. No devuelve historias clínicas completas.',
    input_schema: {
      type: 'object',
      properties: { query: { type: 'string', description: 'Nombre, apellido o DNI.' } },
      required: ['query'],
    },
  },
  {
    name: 'consultar_historia_paciente',
    description: 'Consulta la ficha e historial clínico de un paciente del profesional autenticado. Por defecto devuelve las últimas 10 evoluciones; si el profesional pregunta por algo antiguo, usa topic o dateFrom/dateTo para buscar hasta 50 evoluciones relevantes.',
    input_schema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Nombre, apellido o DNI del paciente.' },
        topic: { type: 'string', description: 'Tema clínico para buscar en todo el historial, por ejemplo anemia, cirugía o embarazo.' },
        dateFrom: { type: 'string', description: 'Fecha inicial YYYY-MM-DD opcional.' },
        dateTo: { type: 'string', description: 'Fecha final YYYY-MM-DD opcional.' },
        limit: { type: 'number', description: 'Máximo de evoluciones; entre 1 y 50. Por defecto 10 o 50 cuando se busca tema/fecha.' },
      },
      required: ['query'],
    },
  },
  {
    name: 'consultar_balance_pagos',
    description: 'Consulta el balance de pagos del profesional, con tratamientos, montos cobrados y saldos. Usala para preguntas administrativas sobre cobros.',
    input_schema: {
      type: 'object',
      properties: { query: { type: 'string', description: 'Nombre del paciente opcional.' } },
    },
  },
  {
    name: 'preparar_borrador_evolucion',
    description: 'Prepara un borrador de evolución clínica a partir de información que el profesional proporciona. Nunca lo guarda automáticamente.',
    input_schema: {
      type: 'object',
      properties: {
        patient: { type: 'string', description: 'Nombre o DNI del paciente.' },
        notes: { type: 'string', description: 'Notas o contenido de la consulta.' },
      },
      required: ['patient', 'notes'],
    },
  },
  {
    name: 'agendar_turno',
    description: 'Agenda directamente un turno solicitado por el profesional. Convertí hoy/mañana a una fecha YYYY-MM-DD usando la fecha actual del sistema. La hora es opcional: si no se indica, elegí el primer bloque libre de la jornada. No pidas confirmación adicional. Solo detente si el día no atiende, no hay cupo o el horario se superpone con otro turno.',
    input_schema: { type: 'object', properties: { patient: { type: 'string' }, date: { type: 'string', description: 'Fecha YYYY-MM-DD, nunca texto relativo.' }, time: { type: 'string', description: 'Hora HH:MM opcional; si falta se asigna el primer bloque libre.' }, reason: { type: 'string' }, durationMinutes: { type: 'number' }, location: { type: 'string' }, confirmation: { type: 'boolean' } }, required: ['patient', 'date', 'confirmation'] },
  },
  {
    name: 'crear_paciente_y_agendar_turno',
    description: 'Registra un paciente nuevo y agenda su primer turno. Antes de ejecutarla son obligatorios nombre, apellido, DNI y email válido. Fecha y hora son opcionales: si faltan, elegí el primer día habilitado con cupo y su primer bloque libre.',
    input_schema: { type: 'object', properties: { nombre: { type: 'string' }, apellido: { type: 'string' }, dni: { type: 'string', description: 'DNI obligatorio del paciente.' }, email: { type: 'string', description: 'Email válido obligatorio para enviar la confirmación.' }, phone: { type: 'string' }, obraSocial: { type: 'string' }, date: { type: 'string', description: 'Fecha YYYY-MM-DD opcional; si falta, se busca el próximo día disponible.' }, time: { type: 'string', description: 'Hora HH:MM opcional; si falta se asigna el primer bloque libre.' }, reason: { type: 'string' }, location: { type: 'string' }, confirmation: { type: 'boolean' } }, required: ['nombre', 'apellido', 'dni', 'email', 'confirmation'] },
  },
  {
    name: 'cancelar_turno',
    description: 'Cancela un turno y avisa por email al paciente si tiene email cargado. Siempre requiere confirmation=true; si es false, solo prepara una propuesta y no modifica datos.',
    input_schema: { type: 'object', properties: { patient: { type: 'string' }, date: { type: 'string' }, time: { type: 'string' }, confirmation: { type: 'boolean' } }, required: ['patient', 'confirmation'] },
  },
  {
    name: 'reprogramar_turno',
    description: 'Cambia un turno existente a otra fecha u horario, valida la agenda y avisa por email al paciente. Siempre requiere confirmation=true; si es false, solo prepara una propuesta.',
    input_schema: { type: 'object', properties: { patient: { type: 'string' }, date: { type: 'string' }, time: { type: 'string' }, newDate: { type: 'string' }, newTime: { type: 'string' }, confirmation: { type: 'boolean' } }, required: ['patient', 'newDate', 'confirmation'] },
  },
  {
    name: 'enviar_notificacion_paciente',
    description: 'Envía un email a un paciente. Siempre requiere confirmation=true; si es false, solo prepara una propuesta y no envía nada.',
    input_schema: { type: 'object', properties: { patient: { type: 'string' }, subject: { type: 'string' }, message: { type: 'string' }, confirmation: { type: 'boolean' } }, required: ['patient', 'subject', 'message', 'confirmation'] },
  },
  {
    name: 'completar_email_y_enviar_confirmacion',
    description: 'Guarda el email real de un paciente recién agendado y envía la confirmación de su próximo turno ya existente. No crea otro turno.',
    input_schema: { type: 'object', properties: { patient: { type: 'string' }, email: { type: 'string' } }, required: ['patient', 'email'] },
  },
  {
    name: 'buscar_vademecum',
    description: 'Busca medicamentos en el vademécum de Dr Happy. Devuelve coincidencias informativas; no reemplaza el criterio profesional.',
    input_schema: {
      type: 'object',
      properties: { query: { type: 'string', description: 'Medicamento, droga, marca o laboratorio.' } },
      required: ['query'],
    },
  },
]

function normalizeSearch(value: unknown): string {
  return String(value || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim()
}

function matchesPatientQuery(patientName: unknown, patientDni: unknown, query: unknown): boolean {
  const normalizedQuery = normalizeSearch(query).replace(/[.,]/g, ' ')
  if (!normalizedQuery) return false
  const queryTokens = normalizedQuery.split(/\s+/).filter(Boolean)
  const patientTokens = normalizeSearch(`${patientName || ''} ${patientDni || ''}`).replace(/[.,]/g, ' ').split(/\s+/).filter(Boolean)
  return queryTokens.every((token) => patientTokens.includes(token))
}

function normalizeIdentity(value: unknown): string {
  return normalizeSearch(value).replace(/[^a-z0-9]/g, '')
}

function dateWeekday(date: string): number {
  return new Date(`${date}T12:00:00`).getDay()
}

function timeToMinutes(value: unknown): number {
  const [hours, minutes] = String(value || '').split(':').map(Number)
  return hours * 60 + minutes
}

function findFirstAvailableTime(appointments: Array<Record<string, unknown>>, durationMinutes: number, openingTime = '09:00', closingTime = '19:00'): string | null {
  const openingMinutes = timeToMinutes(openingTime)
  const closingMinutes = timeToMinutes(closingTime)
  if (!Number.isFinite(openingMinutes) || !Number.isFinite(closingMinutes) || openingMinutes >= closingMinutes) return null
  for (let start = openingMinutes; start + durationMinutes <= closingMinutes; start += 30) {
    const conflict = appointments.some((item) => {
      const currentStart = timeToMinutes(item.scheduledTime)
      const currentEnd = currentStart + (Number(item.durationMinutes) || 30)
      return start < currentEnd && start + durationMinutes > currentStart
    })
    if (!conflict) {
      return `${String(Math.floor(start / 60)).padStart(2, '0')}:${String(start % 60).padStart(2, '0')}`
    }
  }
  return null
}

function buildPublicSlotTimes(startTime: string, endTime: string, slotCount: number, durationMinutes: number): string[] {
  const startMinutes = timeToMinutes(startTime)
  const endMinutes = timeToMinutes(endTime)
  const step = durationMinutes > 0 ? durationMinutes : slotCount > 1 ? Math.floor((endMinutes - startMinutes) / slotCount) : endMinutes - startMinutes
  if (!Number.isFinite(startMinutes) || !Number.isFinite(endMinutes) || startMinutes >= endMinutes || step <= 0) return []
  const times: string[] = []
  for (let cursor = startMinutes; times.length < slotCount && cursor < endMinutes; cursor += step) {
    times.push(`${String(Math.floor(cursor / 60)).padStart(2, '0')}:${String(cursor % 60).padStart(2, '0')}`)
  }
  return times
}

async function sendAppointmentConfirmation(params: {
  supabaseUrl: string
  serviceRoleKey: string
  email?: string
  patientName: string
  professionalName: string
  date: string
  time: string
  location: string
  reason: string
  amountToCharge?: number
  amountConcept?: string
  paymentLink?: string
}): Promise<{ sent: boolean; message?: string }> {
  if (!params.email?.trim()) return { sent: false, message: 'El paciente no tiene email cargado.' }
  try {
    const response = await fetch(`${params.supabaseUrl}/functions/v1/send-email`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${params.serviceRoleKey}`, apikey: params.serviceRoleKey, 'Content-Type': 'application/json' },
      signal: AbortSignal.timeout(30000),
      body: JSON.stringify({
        to: params.email.trim(),
        subject: `Turno confirmado con ${params.professionalName} - ${params.date} ${params.time} hs`,
        type: 'appointment',
        templateData: {
          patientName: params.patientName,
          professionalName: params.professionalName,
          specialty: 'Consulta médica',
          date: params.date,
          time: params.time,
          location: params.location,
          notes: params.reason,
          amountToCharge: params.amountToCharge,
          amountConcept: params.amountConcept,
          paymentLink: params.paymentLink,
        },
      }),
    })
    const result = await response.json().catch(() => null)
    if (!response.ok || !result?.success) {
      return { sent: false, message: typeof result?.message === 'string' ? result.message : `send-email respondió HTTP ${response.status}.` }
    }
    return { sent: true }
  } catch (error) {
    console.error('No se pudo invocar send-email después de crear el turno', error)
    return { sent: false, message: error instanceof Error ? error.message : 'No se pudo conectar con el servicio de email.' }
  }
}

async function saveWorkspaceAndVerifyAppointment(
  admin: ReturnType<typeof createClient>,
  professionalId: string,
  update: Record<string, unknown>,
  appointmentId: string,
): Promise<{ success: boolean; message?: string }> {
  try {
    const { error } = await admin.from('user_workspaces').upsert({ user_id: professionalId, ...update }, { onConflict: 'user_id' })
    if (!error) return { success: true }
  } catch (error) {
    console.error('[ai-assistant] workspace upsert response failed', error)
  }
  const { data } = await admin.from('user_workspaces').select('appointments_json').eq('user_id', professionalId).maybeSingle()
  const appointments = Array.isArray(data?.appointments_json) ? data.appointments_json as Array<Record<string, unknown>> : []
  return appointments.some((appointment) => appointment.id === appointmentId)
    ? { success: true }
    : { success: false, message: 'No se pudo confirmar la persistencia del turno.' }
}

async function sendAppointmentNotice(params: {
  supabaseUrl: string
  serviceRoleKey: string
  email?: string
  subject: string
  message: string
}): Promise<{ sent: boolean; message?: string }> {
  if (!params.email?.trim()) return { sent: false, message: 'El paciente no tiene email cargado.' }
  try {
    const response = await fetch(`${params.supabaseUrl}/functions/v1/send-email`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${params.serviceRoleKey}`, apikey: params.serviceRoleKey, 'Content-Type': 'application/json' },
      signal: AbortSignal.timeout(8000),
      body: JSON.stringify({ to: params.email.trim(), subject: params.subject, type: 'custom', text: params.message, templateData: { message: params.message } }),
    })
    const result = await response.json().catch(() => null)
    if (!response.ok || !result?.success) return { sent: false, message: typeof result?.message === 'string' ? result.message : `send-email respondió HTTP ${response.status}.` }
    return { sent: true }
  } catch (error) {
    console.error('No se pudo enviar el aviso de turno', error)
    return { sent: false, message: error instanceof Error ? error.message : 'No se pudo conectar con el servicio de email.' }
  }
}

async function recoverPersistedAppointment(
  admin: ReturnType<typeof createClient>,
  professionalId: string,
  input: Record<string, unknown>,
): Promise<Record<string, unknown> | null> {
  const { data } = await admin.from('user_workspaces').select('appointments_json').eq('user_id', professionalId).maybeSingle()
  const appointments = Array.isArray(data?.appointments_json) ? data.appointments_json as Array<Record<string, unknown>> : []
  const requestedPatient = normalizeSearch(input.patient || `${input.apellido || ''} ${input.nombre || ''}`)
  const requestedDni = normalizeIdentity(input.dni)
  const requestedEmail = normalizeSearch(input.email)
  const requestedTokens = requestedPatient.split(/\s+/).filter(Boolean)
  const requestedDate = String(input.date || '').trim()
  const requestedTime = String(input.time || '').trim()
  const cutoff = Date.now() - 5 * 60 * 1000
  return appointments
    .filter((appointment) => {
      const appointmentName = normalizeSearch(appointment.patientName)
      const appointmentTokens = appointmentName.split(/\s+/).filter(Boolean)
      const patientMatches = !requestedPatient ||
        (requestedDni && normalizeIdentity(appointment.patientDni) === requestedDni) ||
        (requestedEmail && normalizeSearch(appointment.patientEmail) === requestedEmail) ||
        requestedTokens.every((token) => appointmentTokens.includes(token))
      const exactIdentity = (requestedDni && normalizeIdentity(appointment.patientDni) === requestedDni) || (requestedEmail && normalizeSearch(appointment.patientEmail) === requestedEmail)
      const recentEnough = Date.parse(String(appointment.createdAt || '')) >= cutoff
      return appointment.status !== 'cancelled' && patientMatches && (!requestedDate || appointment.scheduledDate === requestedDate) && (!requestedTime || appointment.scheduledTime === requestedTime) && (exactIdentity || recentEnough)
    })
    .sort((left, right) => String(right.createdAt || '').localeCompare(String(left.createdAt || '')))[0] || null
}

async function runTool(name: string, input: Record<string, unknown>, admin: ReturnType<typeof createClient>, professionalId: string): Promise<unknown> {
  if (name === 'buscar_turnos') {
    const { data } = await admin.from('user_workspaces').select('appointments_json').eq('user_id', professionalId).maybeSingle()
    const appointments = Array.isArray(data?.appointments_json) ? data.appointments_json as Array<Record<string, unknown>> : []
    const date = typeof input.date === 'string' ? input.date : ''
    const upcoming = input.upcoming === true
    const today = new Date().toISOString().slice(0, 10)
    const matches = appointments
      .filter((item) => item.status !== 'cancelled')
      .filter((item) => !date || item.scheduledDate === date)
      .filter((item) => !upcoming || String(item.scheduledDate || '') >= today)
      .sort((a, b) => `${a.scheduledDate}T${a.scheduledTime}`.localeCompare(`${b.scheduledDate}T${b.scheduledTime}`))
      .slice(0, 30)
      .map((item) => ({ date: item.scheduledDate, time: item.scheduledTime, patient: item.patientName, reason: item.reason, location: item.location, status: item.status, modality: item.publicBookingModality }))
    return { count: matches.length, appointments: matches }
  }

  if (name === 'consultar_calendario_ocupacion') {
    const [{ data: workspace }, { data: profile }] = await Promise.all([
      admin.from('user_workspaces').select('appointments_json, profile_json').eq('user_id', professionalId).maybeSingle(),
      admin.from('user_workspaces').select('profile_json').eq('user_id', professionalId).maybeSingle(),
    ])
    const appointments = Array.isArray(workspace?.appointments_json) ? workspace.appointments_json as Array<Record<string, unknown>> : []
    const profileData = (profile?.profile_json && typeof profile.profile_json === 'object' ? profile.profile_json : {}) as Record<string, unknown>
    const dailyLimit = Number(profileData.dailyPatientLimit) || 10
    const configuredDays = Array.isArray(profileData.appointmentDays) ? profileData.appointmentDays : [1, 2, 4]
    const openingTime = typeof profileData.appointmentStartTime === 'string' ? profileData.appointmentStartTime : '09:00'
    const closingTime = typeof profileData.appointmentEndTime === 'string' ? profileData.appointmentEndTime : '19:00'
    const requestedDate = typeof input.date === 'string' ? input.date : ''
    const requestedMonth = typeof input.month === 'string' ? input.month : ''
    const dates = appointments.map((item) => String(item.scheduledDate || '')).filter(Boolean)
    const uniqueDates = Array.from(new Set(dates)).filter((date) => (!requestedDate || date === requestedDate) && (!requestedMonth || date.startsWith(requestedMonth))).sort()
    const occupancy = uniqueDates.map((date) => {
      const count = appointments.filter((item) => item.scheduledDate === date && item.status !== 'cancelled').length
      return { date, occupied: count, available: Math.max(0, dailyLimit - count), limit: dailyLimit }
    })
    return { dailyLimit, appointmentDays: configuredDays, openingTime, closingTime, occupancy }
  }

  if (name === 'obtener_link_pago_profesional') {
    const { data } = await admin.from('user_workspaces').select('profile_json').eq('user_id', professionalId).maybeSingle()
    const profile = data?.profile_json && typeof data.profile_json === 'object' ? data.profile_json as Record<string, unknown> : {}
    return { paymentLink: typeof profile.paymentLink === 'string' ? profile.paymentLink : null }
  }

  if (name === 'consultar_turnera_publica') {
    const { data: publicProfile } = await admin.from('public_booking_profiles').select('slug, enabled, professional_name, location, reason, horizon_days, availability_blocks').eq('professional_id', professionalId).maybeSingle()
    if (!publicProfile) return { enabled: false, message: 'Todavía no hay una turnera pública configurada.' }
    if (publicProfile.enabled !== true) return { enabled: false, slug: publicProfile.slug, message: 'La turnera pública está configurada pero desactivada.' }
    const requestedDate = typeof input.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(input.date) ? input.date : ''
    const requestedModality = input.modality === 'private' || input.modality === 'coverage' ? input.modality : ''
    const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Argentina/Buenos_Aires' }).format(new Date())
    const blocks = Array.isArray(publicProfile.availability_blocks) ? publicProfile.availability_blocks as Array<Record<string, unknown>> : []
    const normalizedBlocks = blocks.filter((block) => (!requestedModality || block.modality === requestedModality) && Array.isArray(block.days) && typeof block.startTime === 'string' && typeof block.endTime === 'string')
    const { data: workspace } = await admin.from('user_workspaces').select('appointments_json').eq('user_id', professionalId).maybeSingle()
    const appointments = Array.isArray(workspace?.appointments_json) ? workspace.appointments_json as Array<Record<string, unknown>> : []
    const { data: reservations } = await admin.from('public_booking_reservations').select('slot_date, slot_time, status').eq('professional_id', professionalId).gte('slot_date', today)
    const occupied = new Set([
      ...appointments.filter((item) => item.status !== 'cancelled').map((item) => `${item.scheduledDate}|${item.scheduledTime}`),
      ...(reservations || []).filter((item) => item.status !== 'cancelled').map((item) => `${item.slot_date}|${item.slot_time}`),
    ])
    const dates = new Map<string, Array<Record<string, unknown>>>()
    const horizon = Math.min(Number(publicProfile.horizon_days) || 60, 60)
    for (let offset = 0; offset < horizon; offset += 1) {
      const date = new Date(`${today}T12:00:00`)
      date.setDate(date.getDate() + offset)
      const dateKey = date.toISOString().slice(0, 10)
      if (requestedDate && requestedDate !== dateKey) continue
      const weekday = date.getDay()
      const slots = normalizedBlocks.flatMap((block) => {
        const days = block.days as unknown[]
        if (!days.includes(weekday)) return []
        const duration = Number(block.durationMinutes) || 30
        return buildPublicSlotTimes(String(block.startTime), String(block.endTime), Number(block.slotCount) || 1, duration).map((time) => ({
          time,
          available: !occupied.has(`${dateKey}|${time}`),
          label: block.label || 'Turno disponible',
          modality: block.modality || 'coverage',
          durationMinutes: duration,
          location: block.location || publicProfile.location || '',
          reason: block.reason || publicProfile.reason || '',
        }))
      }).sort((left, right) => String(left.time).localeCompare(String(right.time)))
      if (slots.length) dates.set(dateKey, slots)
    }
    return { enabled: true, slug: publicProfile.slug, professionalName: publicProfile.professional_name, location: publicProfile.location, reason: publicProfile.reason, dates: Array.from(dates, ([date, slots]) => ({ date, slots })) }
  }

  if (name === 'buscar_memorias_sofia') {
    const { data } = await admin.from('user_workspaces').select('profile_json').eq('user_id', professionalId).maybeSingle()
    const profile = data?.profile_json && typeof data.profile_json === 'object' ? data.profile_json as Record<string, unknown> : {}
    const memories = Array.isArray(profile.sofiaMemory) ? profile.sofiaMemory as Array<Record<string, unknown>> : []
    const query = normalizeSearch(input.query)
    return { memories: memories.filter((memory) => !query || normalizeSearch(`${memory.topic || ''} ${memory.content || ''}`).includes(query)).slice(-30) }
  }

  if (name === 'guardar_memoria_sofia') {
    const topic = String(input.topic || '').trim().slice(0, 120)
    const content = String(input.content || '').trim().slice(0, 500)
    if (!topic || !content) return { success: false, message: 'La memoria necesita un tema y un contenido.' }
    const proposal = { topic, content }
    if (input.confirmation !== true) return { requiresConfirmation: true, action: 'guardar_memoria_sofia', proposal, message: 'Pedí confirmación antes de guardar esta memoria.' }
    const { data } = await admin.from('user_workspaces').select('profile_json').eq('user_id', professionalId).maybeSingle()
    const profile = data?.profile_json && typeof data.profile_json === 'object' ? data.profile_json as Record<string, unknown> : {}
    const memories = Array.isArray(profile.sofiaMemory) ? profile.sofiaMemory as Array<Record<string, unknown>> : []
    const nextMemory = { id: crypto.randomUUID(), topic, content, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() }
    const nextMemories = [...memories.filter((memory) => normalizeSearch(memory.topic) !== normalizeSearch(topic)), nextMemory].slice(-50)
    const { error } = await admin.from('user_workspaces').upsert({ user_id: professionalId, profile_json: { ...profile, sofiaMemory: nextMemories } }, { onConflict: 'user_id' })
    return error ? { success: false, message: error.message } : { success: true, message: `Recordaré el tema "${topic}".` }
  }

  if (name === 'buscar_pacientes') {
    const query = normalizeSearch(input.query)
    if (query.length < 2) return { count: 0, patients: [], message: 'La búsqueda necesita al menos 2 caracteres.' }
    const { data } = await admin.from('user_workspaces').select('patients_json').eq('user_id', professionalId).maybeSingle()
    const patients = Array.isArray(data?.patients_json) ? data.patients_json as Array<Record<string, unknown>> : []
    const matches = patients.filter((patient) => normalizeSearch(`${patient.nombre || ''} ${patient.apellido || ''} ${patient.dni || ''}`).includes(query)).slice(0, 20).map((patient) => ({ id: patient.id, name: `${patient.apellido || ''}, ${patient.nombre || ''}`.trim(), dni: patient.dni, email: patient.email, obraSocial: patient.obraSocial }))
    return { count: matches.length, patients: matches }
  }

  if (name === 'buscar_vademecum') {
    const query = normalizeSearch(input.query)
    if (query.length < 3) return { count: 0, medications: [], message: 'La búsqueda necesita al menos 3 caracteres.' }
    const response = await fetch('https://www.drhappy.com.ar/vademecum.json')
    if (!response.ok) return { count: 0, medications: [], message: 'El vademécum no está disponible ahora.' }
    const catalog = await response.json()
    const entries = Array.isArray(catalog) ? catalog : Array.isArray(catalog?.medications) ? catalog.medications : []
    const matches = entries.filter((entry: unknown) => normalizeSearch(JSON.stringify(entry)).includes(query)).slice(0, 12)
    return { count: matches.length, medications: matches }
  }

  if (name === 'consultar_historia_paciente') {
    const query = normalizeSearch(input.query)
    if (query.length < 2) return { matches: [], message: 'La búsqueda necesita al menos 2 caracteres.' }
    const { data } = await admin.from('user_workspaces').select('patients_json').eq('user_id', professionalId).maybeSingle()
    const patients = Array.isArray(data?.patients_json) ? data.patients_json as Array<Record<string, unknown>> : []
    const topic = normalizeSearch(input.topic)
    const dateFrom = typeof input.dateFrom === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(input.dateFrom) ? input.dateFrom : ''
    const dateTo = typeof input.dateTo === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(input.dateTo) ? input.dateTo : ''
    const requestedLimit = Number(input.limit)
    const historyLimit = Math.min(50, Math.max(1, Number.isFinite(requestedLimit) ? Math.floor(requestedLimit) : topic || dateFrom || dateTo ? 50 : 10))
    const matches = patients.filter((patient) => normalizeSearch(`${patient.nombre || ''} ${patient.apellido || ''} ${patient.dni || ''}`).includes(query)).slice(0, 5)
    return {
      count: matches.length,
      patients: matches.map((patient) => ({
        id: patient.id,
        name: `${patient.apellido || ''}, ${patient.nombre || ''}`.trim(),
        dni: patient.dni,
        email: patient.email,
        obraSocial: patient.obraSocial,
        numeroAfiliado: patient.numeroAfiliado,
        plan: patient.plan,
        birthDate: patient.birthDate,
        diagnosticoPrincipal: patient.diagnosticoPrincipal,
        patologiasConocidas: patient.patologiasConocidas,
        patologiasCronicas: patient.patologiasCronicas,
        consultations: Array.isArray(patient.consultations)
          ? patient.consultations
            .filter((consultation: Record<string, unknown>) => {
              const date = typeof consultation.date === 'string' ? consultation.date : ''
              const text = normalizeSearch(JSON.stringify(consultation))
              return (!dateFrom || date >= dateFrom) && (!dateTo || date <= dateTo) && (!topic || text.includes(topic))
            })
            .slice(-historyLimit)
            .map((consultation: Record<string, unknown>) => ({
            date: consultation.date,
            motivoConsulta: consultation.motivoConsulta,
            diagnostico: consultation.diagnostico,
            enfermedadActual: consultation.enfermedadActual,
            examenFisico: consultation.examenFisico,
            impresionDiagnostica: consultation.impresionDiagnostica,
            planManejo: consultation.planManejo,
            detalleAtencion: consultation.detalleAtencion,
            pensamientoMedico: consultation.pensamientoMedico,
          }))
          : [],
      })),
    }
  }

  if (name === 'consultar_balance_pagos') {
    const query = normalizeSearch(input.query)
    const { data } = await admin.from('user_workspaces').select('treatment_ledger_json').eq('user_id', professionalId).maybeSingle()
    const entries = Array.isArray(data?.treatment_ledger_json) ? data.treatment_ledger_json as Array<Record<string, unknown>> : []
    const matches = entries.filter((entry) => !query || normalizeSearch(`${entry.patientName || ''} ${entry.intervention || ''}`).includes(query)).slice(0, 50).map((entry) => ({ patient: entry.patientName, date: entry.date, intervention: entry.intervention, total: entry.totalAmount, paid: entry.paidAmount, pending: Number(entry.totalAmount || 0) - Number(entry.paidAmount || 0), notes: entry.notes }))
    return { count: matches.length, entries: matches }
  }

  if (name === 'preparar_borrador_evolucion') {
    return {
      draft: {
        patient: String(input.patient || ''),
        date: new Date().toISOString().slice(0, 10),
        content: String(input.notes || ''),
      },
      instruction: 'Presentá el borrador con secciones claras y pedí al profesional que lo revise antes de guardarlo. No lo guardes.',
    }
  }

  if (name === 'agendar_turno') {
    const patientQuery = normalizeSearch(input.patient)
    const { data } = await admin.from('user_workspaces').select('patients_json, appointments_json, profile_json').eq('user_id', professionalId).maybeSingle()
    const patients = Array.isArray(data?.patients_json) ? data.patients_json as Array<Record<string, unknown>> : []
    const patient = patients.find((item) => normalizeSearch(`${item.nombre || ''} ${item.apellido || ''} ${item.dni || ''}`).includes(patientQuery))
    if (!patient) return { success: false, message: 'No encontré un paciente que coincida. Pedí nombre completo o DNI.' }
    const missingPatientData = [
      !String(patient.nombre || '').trim() ? 'nombre' : '',
      !String(patient.apellido || '').trim() ? 'apellido' : '',
      !String(patient.dni || '').trim() ? 'DNI' : '',
      !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(patient.email || '').trim()) ? 'email válido' : '',
    ].filter(Boolean)
    if (missingPatientData.length > 0) return { success: false, message: `Antes de agendar necesito completar: ${missingPatientData.join(', ')}.` }
    const proposal = { patient: `${patient.apellido || ''}, ${patient.nombre || ''}`.trim(), patientId: patient.id, date: input.date, time: input.time, reason: input.reason || 'Consulta médica', durationMinutes: Number(input.durationMinutes) || 30, location: input.location || 'Consultorio médico' }
    const appointments = Array.isArray(data?.appointments_json) ? data.appointments_json as Array<Record<string, unknown>> : []
    const profileData = data?.profile_json && typeof data.profile_json === 'object' ? data.profile_json as Record<string, unknown> : {}
    const dailyLimit = Number(profileData.dailyPatientLimit) || 10
    const appointmentDays = Array.isArray(profileData.appointmentDays) ? profileData.appointmentDays : [1, 2, 4]
    const openingTime = typeof profileData.appointmentStartTime === 'string' ? profileData.appointmentStartTime : '09:00'
    const closingTime = typeof profileData.appointmentEndTime === 'string' ? profileData.appointmentEndTime : '19:00'
    if (!appointmentDays.includes(dateWeekday(String(input.date)))) return { success: false, message: 'Ese día no está habilitado en la agenda profesional.' }
    const activeOnDate = appointments.filter((item) => item.status !== 'cancelled' && item.scheduledDate === input.date)
    if (activeOnDate.length >= dailyLimit) return { success: false, message: `El cupo diario está completo (${dailyLimit} turnos).` }
    const selectedTime = typeof input.time === 'string' && /^\d{2}:\d{2}$/.test(input.time) ? input.time : findFirstAvailableTime(activeOnDate, proposal.durationMinutes, openingTime, closingTime)
    if (!selectedTime) return { success: false, message: 'No encontré un bloque libre en la jornada para ese día.' }
    if (timeToMinutes(selectedTime) < timeToMinutes(openingTime) || timeToMinutes(selectedTime) + proposal.durationMinutes > timeToMinutes(closingTime)) return { success: false, message: `El horario debe estar dentro de tu agenda: ${openingTime} a ${closingTime}.` }
    proposal.time = selectedTime
    const requestedStart = timeToMinutes(selectedTime)
    const requestedEnd = requestedStart + proposal.durationMinutes
    const conflict = activeOnDate.some((item) => { const start = timeToMinutes(item.scheduledTime); const end = start + (Number(item.durationMinutes) || 30); return requestedStart < end && requestedEnd > start })
    if (conflict) return { success: false, message: 'Ese horario ya está ocupado.' }
    const appointment = { id: crypto.randomUUID(), patientId: patient.id, patientName: proposal.patient, patientEmail: patient.email || '', patientDni: patient.dni || '', scheduledDate: input.date, scheduledTime: selectedTime, scheduledAt: `${input.date}T${selectedTime}:00`, durationMinutes: proposal.durationMinutes, reason: proposal.reason, location: proposal.location, status: 'confirmed', createdAt: new Date().toISOString(), createdByUserId: professionalId }
    const saved = await saveWorkspaceAndVerifyAppointment(admin, professionalId, { appointments_json: [...appointments, appointment] }, String(appointment.id))
    if (!saved.success) return saved
    const emailResult = await sendAppointmentConfirmation({ supabaseUrl, serviceRoleKey, email: String(patient.email || ''), patientName: proposal.patient, professionalName: String(profileData.fullName || 'Dr Happy'), date: String(input.date), time: selectedTime, location: proposal.location, reason: proposal.reason, paymentLink: typeof profileData.paymentLink === 'string' ? profileData.paymentLink : undefined })
    return { success: true, emailSent: emailResult.sent, emailMessage: emailResult.message, message: `Turno confirmado para ${proposal.patient} el ${input.date} a las ${selectedTime}.${emailResult.sent ? ' Confirmación enviada por email.' : ' El turno quedó guardado, pero no se envió email porque el paciente no tiene una dirección válida cargada.'}` }
  }

  if (name === 'crear_paciente_y_agendar_turno') {
    const nombre = String(input.nombre || '').trim()
    const apellido = String(input.apellido || '').trim()
    const dni = String(input.dni || '').trim()
    const email = String(input.email || '').trim().toLowerCase()
    let date = String(input.date || '').trim()
    const requestedTime = String(input.time || '').trim()
    const missingData = [!nombre ? 'nombre' : '', !apellido ? 'apellido' : '', !dni ? 'DNI' : '', !email ? 'email' : ''].filter(Boolean)
    if (missingData.length > 0) return { success: false, message: `Para dar un turno necesito nombre, apellido, DNI y email. Falta: ${missingData.join(', ')}.` }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return { success: false, message: 'El email no es válido. Necesito nombre, apellido, DNI y un email real antes de dar el turno.' }
    const { data } = await admin.from('user_workspaces').select('patients_json, appointments_json, profile_json').eq('user_id', professionalId).maybeSingle()
    const patients = Array.isArray(data?.patients_json) ? data.patients_json as Array<Record<string, unknown>> : []
    const appointments = Array.isArray(data?.appointments_json) ? data.appointments_json as Array<Record<string, unknown>> : []
    const profileData = data?.profile_json && typeof data.profile_json === 'object' ? data.profile_json as Record<string, unknown> : {}
    const dailyLimit = Number(profileData.dailyPatientLimit) || 10
    const appointmentDays = Array.isArray(profileData.appointmentDays) ? profileData.appointmentDays : [1, 2, 4]
    const openingTime = typeof profileData.appointmentStartTime === 'string' ? profileData.appointmentStartTime : '09:00'
    const closingTime = typeof profileData.appointmentEndTime === 'string' ? profileData.appointmentEndTime : '19:00'
    let automaticallySelectedTime = ''
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Argentina/Buenos_Aires' }).format(new Date())
      for (let offset = 0; offset < 60; offset += 1) {
        const candidate = new Date(`${today}T12:00:00`)
        candidate.setDate(candidate.getDate() + offset)
        const candidateDate = candidate.toISOString().slice(0, 10)
        if (!appointmentDays.includes(dateWeekday(candidateDate))) continue
        const candidateAppointments = appointments.filter((item) => item.status !== 'cancelled' && item.scheduledDate === candidateDate)
        if (candidateAppointments.length >= dailyLimit) continue
        const candidateTime = findFirstAvailableTime(candidateAppointments, 30, openingTime, closingTime)
        if (!candidateTime) continue
        date = candidateDate
        automaticallySelectedTime = candidateTime
        break
      }
      if (!date) return { success: false, message: 'No encontré disponibilidad en los próximos 60 días.' }
    }
    if (!appointmentDays.includes(dateWeekday(date))) return { success: false, message: 'Ese día no está habilitado en la agenda profesional.' }
    const activeOnDate = appointments.filter((item) => item.status !== 'cancelled' && item.scheduledDate === date)
    if (activeOnDate.length >= dailyLimit) return { success: false, message: `El cupo diario está completo (${dailyLimit} turnos).` }
    const durationMinutes = 30
    const selectedTime = /^\d{2}:\d{2}$/.test(requestedTime) ? requestedTime : automaticallySelectedTime || findFirstAvailableTime(activeOnDate, durationMinutes, openingTime, closingTime)
    if (!selectedTime) return { success: false, message: 'No encontré un bloque libre en la jornada para ese día.' }
    if (timeToMinutes(selectedTime) < timeToMinutes(openingTime) || timeToMinutes(selectedTime) + durationMinutes > timeToMinutes(closingTime)) return { success: false, message: `El horario debe estar dentro de tu agenda: ${openingTime} a ${closingTime}.` }
    const normalizedName = normalizeSearch(`${nombre} ${apellido}`)
    const existing = patients.find((patient) => {
      const exactDni = typeof patient.dni === 'string' && dni && String(patient.dni).trim() === dni
      const sameName = normalizeSearch(`${patient.nombre || ''} ${patient.apellido || ''}`) === normalizedName
      return exactDni || sameName
    })
    const patientId = existing?.id || crypto.randomUUID()
    const patientName = `${apellido}, ${nombre}`
    const proposal = { patientName, dni, email, date, time: selectedTime, reason: input.reason || 'Consulta médica', location: input.location || 'Consultorio médico' }
    const requestedStart = timeToMinutes(selectedTime)
    const requestedEnd = requestedStart + durationMinutes
    const conflict = activeOnDate.some((item) => {
      const start = timeToMinutes(item.scheduledTime)
      const end = start + (Number(item.durationMinutes) || 30)
      return requestedStart < end && requestedEnd > start
    })
    if (conflict) return { success: false, message: 'Ese horario ya está ocupado.' }
    const patient = existing
      ? { ...existing, nombre, apellido, dni, email, updatedAt: new Date().toISOString() }
      : { id: patientId, ownerUserId: professionalId, nombre, apellido, dni, email, obraSocial: input.obraSocial || '', numeroAfiliado: '', plan: '', birthDate: '', edad: 0, patologiasConocidas: '', patologiasCronicas: '', ultimaInternacion: '', cirugiasPrevias: '', direccion: '', documents: [], consultations: [], createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() }
    const appointment = { id: crypto.randomUUID(), patientId, patientName, patientEmail: email, patientDni: dni, scheduledDate: date, scheduledTime: selectedTime, scheduledAt: `${date}T${selectedTime}:00`, durationMinutes, reason: proposal.reason, location: proposal.location, status: 'confirmed', createdAt: new Date().toISOString(), createdByUserId: professionalId }
    const nextPatients = existing ? patients.map((item) => item.id === existing.id ? patient : item) : [...patients, patient]
    const saved = await saveWorkspaceAndVerifyAppointment(admin, professionalId, { patients_json: nextPatients, appointments_json: [...appointments, appointment] }, String(appointment.id))
    if (!saved.success) return saved
    const emailResult = await sendAppointmentConfirmation({ supabaseUrl, serviceRoleKey, email, patientName, professionalName: String(profileData.fullName || 'Dr Happy'), date, time: selectedTime, location: proposal.location, reason: proposal.reason })
    return { success: true, emailSent: emailResult.sent, emailMessage: emailResult.message, message: `Paciente ${patientName} registrado con DNI ${dni} y turno confirmado para ${date} a las ${selectedTime}.${emailResult.sent ? ` Confirmación enviada a ${email}.` : ` El turno quedó confirmado, pero no se pudo enviar el email: ${emailResult.message || 'error de envío'}.`}` }
  }

  if (name === 'cancelar_turno') {
    const query = normalizeSearch(input.patient)
    const { data } = await admin.from('user_workspaces').select('appointments_json, profile_json').eq('user_id', professionalId).maybeSingle()
    const appointments = Array.isArray(data?.appointments_json) ? data.appointments_json as Array<Record<string, unknown>> : []
    const match = appointments.find((item) => item.status !== 'cancelled' && matchesPatientQuery(item.patientName, item.patientDni, query) && (!input.date || item.scheduledDate === input.date) && (!input.time || item.scheduledTime === input.time))
    if (!match) return { success: false, message: 'No encontré ese turno.' }
    const proposal = { patient: match.patientName, date: match.scheduledDate, time: match.scheduledTime, reason: match.reason }
    if (input.confirmation !== true) return { requiresConfirmation: true, action: 'cancelar_turno', proposal, message: 'Pedí confirmación explícita antes de cancelar.' }
    const nextAppointments = appointments.map((item) => item.id === match.id ? { ...item, status: 'cancelled' } : item)
    const saved = await saveWorkspaceAndVerifyAppointment(admin, professionalId, { appointments_json: nextAppointments }, String(match.id))
    if (!saved.success) return saved
    const profile = data?.profile_json && typeof data.profile_json === 'object' ? data.profile_json as Record<string, unknown> : {}
    const emailResult = await sendAppointmentNotice({
      supabaseUrl,
      serviceRoleKey,
      email: String(match.patientEmail || ''),
      subject: `Turno cancelado con ${String(profile.fullName || 'Dr Happy')}`,
      message: `Hola ${String(match.patientName || 'Paciente')},\n\nTe informamos que tu turno con ${String(profile.fullName || 'Dr Happy')} del ${String(match.scheduledDate)} a las ${String(match.scheduledTime)} hs fue cancelado.\n\nPor favor comunicate con el profesional para coordinar una nueva fecha.`,
    })
    return { success: true, emailSent: emailResult.sent, emailMessage: emailResult.message, message: `Turno cancelado para ${match.patientName} el ${match.scheduledDate} a las ${match.scheduledTime}.${emailResult.sent ? ' Aviso enviado por email.' : ` No se pudo enviar el aviso: ${emailResult.message}`}` }
  }

  if (name === 'reprogramar_turno') {
    const query = normalizeSearch(input.patient)
    const newDate = String(input.newDate || '').trim()
    const requestedTime = String(input.newTime || '').trim()
    if (!/^\d{4}-\d{2}-\d{2}$/.test(newDate)) return { success: false, message: 'La nueva fecha debe tener formato YYYY-MM-DD.' }
    const { data } = await admin.from('user_workspaces').select('appointments_json, profile_json').eq('user_id', professionalId).maybeSingle()
    const appointments = Array.isArray(data?.appointments_json) ? data.appointments_json as Array<Record<string, unknown>> : []
    const match = appointments.find((item) => item.status !== 'cancelled' && matchesPatientQuery(item.patientName, item.patientDni, query) && (!input.date || item.scheduledDate === input.date) && (!input.time || item.scheduledTime === input.time))
    if (!match) return { success: false, message: 'No encontré ese turno.' }
    const profile = data?.profile_json && typeof data.profile_json === 'object' ? data.profile_json as Record<string, unknown> : {}
    const dailyLimit = Number(profile.dailyPatientLimit) || 10
    const appointmentDays = Array.isArray(profile.appointmentDays) ? profile.appointmentDays : [1, 2, 4]
    const openingTime = typeof profile.appointmentStartTime === 'string' ? profile.appointmentStartTime : '09:00'
    const closingTime = typeof profile.appointmentEndTime === 'string' ? profile.appointmentEndTime : '19:00'
    if (!appointmentDays.includes(dateWeekday(newDate))) return { success: false, message: 'La nueva fecha no está habilitada en la agenda profesional.' }
    const activeOnDate = appointments.filter((item) => item.id !== match.id && item.status !== 'cancelled' && item.scheduledDate === newDate)
    if (activeOnDate.length >= dailyLimit) return { success: false, message: `El cupo diario está completo (${dailyLimit} turnos).` }
    const durationMinutes = Number(match.durationMinutes) || 30
    const selectedTime = /^\d{2}:\d{2}$/.test(requestedTime) ? requestedTime : findFirstAvailableTime(activeOnDate, durationMinutes, openingTime, closingTime)
    if (!selectedTime) return { success: false, message: 'No encontré un bloque libre en la nueva fecha.' }
    const start = timeToMinutes(selectedTime)
    const end = start + durationMinutes
    if (start < timeToMinutes(openingTime) || end > timeToMinutes(closingTime)) return { success: false, message: `El horario debe estar dentro de tu agenda: ${openingTime} a ${closingTime}.` }
    if (activeOnDate.some((item) => { const itemStart = timeToMinutes(item.scheduledTime); const itemEnd = itemStart + (Number(item.durationMinutes) || 30); return start < itemEnd && end > itemStart })) return { success: false, message: 'Ese horario ya está ocupado.' }
    const proposal = { patient: match.patientName, fromDate: match.scheduledDate, fromTime: match.scheduledTime, toDate: newDate, toTime: selectedTime }
    if (input.confirmation !== true) return { requiresConfirmation: true, action: 'reprogramar_turno', proposal, message: 'Pedí confirmación antes de cambiar el turno.' }
    const rescheduledAt = new Date().toISOString()
    const cancelledAppointment = { ...match, status: 'cancelled', cancellationReason: 'Reprogramado por el profesional', cancelledAt: rescheduledAt, updatedAt: rescheduledAt }
    const newAppointment = { ...match, id: crypto.randomUUID(), scheduledDate: newDate, scheduledTime: selectedTime, scheduledAt: `${newDate}T${selectedTime}:00`, status: 'confirmed', previousAppointmentId: match.id, rescheduledAt, updatedAt: rescheduledAt }
    const nextAppointments = appointments.flatMap((item) => item.id === match.id ? [cancelledAppointment, newAppointment] : [item])
    const saved = await saveWorkspaceAndVerifyAppointment(admin, professionalId, { appointments_json: nextAppointments }, String(newAppointment.id))
    if (!saved.success) return saved
    const emailResult = await sendAppointmentNotice({
      supabaseUrl,
      serviceRoleKey,
      email: String(match.patientEmail || ''),
      subject: `Turno reprogramado con ${String(profile.fullName || 'Dr Happy')}`,
      message: `Hola ${String(match.patientName || 'Paciente')},\n\nTu turno con ${String(profile.fullName || 'Dr Happy')} fue reprogramado.\n\nFecha anterior: ${String(match.scheduledDate)} a las ${String(match.scheduledTime)} hs\nNueva fecha: ${newDate} a las ${selectedTime} hs\n\nSi necesitás modificarlo nuevamente, comunicate con el profesional.`,
    })
    return { success: true, emailSent: emailResult.sent, emailMessage: emailResult.message, message: `Turno reprogramado para ${match.patientName}: ${newDate} a las ${selectedTime}.${emailResult.sent ? ' Aviso enviado por email.' : ` No se pudo enviar el aviso: ${emailResult.message}`}` }
  }

  if (name === 'enviar_notificacion_paciente') {
    const query = normalizeSearch(input.patient)
    const { data } = await admin.from('user_workspaces').select('patients_json').eq('user_id', professionalId).maybeSingle()
    const patients = Array.isArray(data?.patients_json) ? data.patients_json as Array<Record<string, unknown>> : []
    const patient = patients.find((item) => normalizeSearch(`${item.nombre || ''} ${item.apellido || ''} ${item.dni || ''}`).includes(query))
    if (!patient || typeof patient.email !== 'string' || !patient.email.trim()) return { success: false, message: 'No encontré un paciente con email cargado.' }
    const proposal = { patient: `${patient.apellido || ''}, ${patient.nombre || ''}`.trim(), email: patient.email, subject: input.subject, message: input.message }
    if (input.confirmation !== true) return { requiresConfirmation: true, action: 'enviar_notificacion_paciente', proposal, message: 'Pedí confirmación explícita antes de enviar.' }
    const emailResponse = await fetch(`${supabaseUrl}/functions/v1/send-email`, { method: 'POST', headers: { Authorization: `Bearer ${serviceRoleKey}`, apikey: serviceRoleKey, 'Content-Type': 'application/json' }, body: JSON.stringify({ to: patient.email, subject: input.subject, type: 'custom', text: input.message }) })
    return emailResponse.ok ? { success: true, message: `Email enviado a ${proposal.patient}.` } : { success: false, message: 'No se pudo enviar el email.' }
  }

  if (name === 'completar_email_y_enviar_confirmacion') {
    const query = normalizeSearch(input.patient)
    const email = String(input.email || '').trim().toLowerCase()
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return { success: false, message: 'Necesito un email válido para enviar la confirmación.' }
    const { data } = await admin.from('user_workspaces').select('patients_json, appointments_json, profile_json').eq('user_id', professionalId).maybeSingle()
    const patients = Array.isArray(data?.patients_json) ? data.patients_json as Array<Record<string, unknown>> : []
    const appointments = Array.isArray(data?.appointments_json) ? data.appointments_json as Array<Record<string, unknown>> : []
    const patient = patients.find((item) => normalizeSearch(`${item.nombre || ''} ${item.apellido || ''} ${item.dni || ''}`).includes(query))
    if (!patient) return { success: false, message: 'No encontré al paciente para completar el email.' }
    const appointment = appointments
      .filter((item) => item.patientId === patient.id && item.status !== 'cancelled')
      .sort((left, right) => String(left.scheduledAt || '').localeCompare(String(right.scheduledAt || '')))[0]
    if (!appointment) return { success: false, message: 'El paciente quedó guardado, pero no encontré un turno vigente para confirmar.' }
    const nextPatients = patients.map((item) => item.id === patient.id ? { ...item, email, updatedAt: new Date().toISOString() } : item)
    const nextAppointments = appointments.map((item) => item.id === appointment.id ? { ...item, patientEmail: email } : item)
    const saved = await saveWorkspaceAndVerifyAppointment(admin, professionalId, { patients_json: nextPatients, appointments_json: nextAppointments }, String(appointment.id))
    if (!saved.success) return saved
    const profile = data?.profile_json && typeof data.profile_json === 'object' ? data.profile_json as Record<string, unknown> : {}
    const patientName = String(appointment.patientName || `${patient.apellido || ''}, ${patient.nombre || ''}`).trim()
    const emailResult = await sendAppointmentConfirmation({ supabaseUrl, serviceRoleKey, email, patientName, professionalName: String(profile.fullName || 'Dr Happy'), date: String(appointment.scheduledDate || ''), time: String(appointment.scheduledTime || ''), location: String(appointment.location || 'Consultorio médico'), reason: String(appointment.reason || 'Consulta médica'), paymentLink: typeof profile.paymentLink === 'string' ? profile.paymentLink : undefined })
    return emailResult.sent
      ? { success: true, message: `Email guardado para ${patientName}. Confirmación enviada a ${email}. El turno sigue agendado para ${appointment.scheduledDate} a las ${appointment.scheduledTime}.` }
      : { success: false, message: `El email quedó guardado, pero no se pudo enviar la confirmación: ${emailResult.message || 'error de envío'}.` }
  }

  return { error: 'Herramienta no disponible.' }
}

function jsonResponse(status: number, body: Record<string, unknown>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

function cleanMessages(value: unknown): AssistantMessage[] {
  if (!Array.isArray(value)) return []
  return value
    .filter((message): message is AssistantMessage => (
      Boolean(message) &&
      typeof message === 'object' &&
      ((message as AssistantMessage).role === 'user' || (message as AssistantMessage).role === 'assistant') &&
      typeof (message as AssistantMessage).content === 'string'
    ))
    .slice(-20)
    .map((message) => ({
      role: message.role,
      content: message.content.trim().slice(0, 6000),
    }))
    .filter((message) => message.content.length > 0)
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (request.method !== 'POST') return jsonResponse(405, { success: false, message: 'Método no permitido.' })

  const anthropicKey = Deno.env.get('ANTHROPIC_API_KEY')?.trim()
  const model = Deno.env.get('ANTHROPIC_MODEL')?.trim() || 'claude-sonnet-4-5'
  if (!anthropicKey) {
    return jsonResponse(503, {
      success: false,
      message: 'Sofía está preparada, pero falta configurar ANTHROPIC_API_KEY en Supabase.',
    })
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL')
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  if (!supabaseUrl || !serviceRoleKey) return jsonResponse(500, { success: false, message: 'Falta configuración de Supabase.' })

  let payload: { action?: string; messages?: unknown; professionalId?: string; professionalName?: string; context?: string }
  try {
    payload = await request.json()
  } catch {
    return jsonResponse(400, { success: false, message: 'Cuerpo JSON inválido.' })
  }

  if (payload.action !== 'chat') {
    return jsonResponse(400, { success: false, message: 'Acción no soportada.' })
  }

  const admin = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false } })
  const professionalId = await resolveProfessionalId(request, admin)
  if (!professionalId) return jsonResponse(401, { success: false, message: 'Sesión profesional requerida.' })
  const { data: professional } = await admin
    .from('professionals')
    .select('id, active, is_admin, trial_started_at, subscription_status, subscription_expires_at')
    .eq('id', professionalId)
    .maybeSingle()
  if (!professional || professional.active === false) return jsonResponse(401, { success: false, message: 'Profesional no autorizado.' })

  const now = new Date()
  const subscriptionExpiresAt = typeof professional.subscription_expires_at === 'string' ? new Date(professional.subscription_expires_at) : null
  const subscriptionExpired = subscriptionExpiresAt && !Number.isNaN(subscriptionExpiresAt.getTime()) && subscriptionExpiresAt.getTime() <= now.getTime()
  if (!professional.is_admin && (professional.subscription_status === 'cancelled' || professional.subscription_status === 'expired' || subscriptionExpired)) {
    return jsonResponse(402, { success: false, message: 'El acceso de Sofía requiere una suscripción activa.' })
  }
  const trialStartedAt = typeof professional.trial_started_at === 'string' ? new Date(professional.trial_started_at) : null
  const trialStart = trialStartedAt && !Number.isNaN(trialStartedAt.getTime()) ? trialStartedAt.toISOString() : null
  const usageSince = professional.subscription_status === 'active'
    ? new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString()
    : trialStart
  let usageQuery = admin
    .from('ai_usage_events')
    .select('id', { count: 'exact', head: true })
    .eq('professional_id', professionalId)
  if (usageSince) usageQuery = usageQuery.gte('created_at', usageSince)
  const { count: monthlyUsage } = await usageQuery
  const usageLimit = professional.is_admin ? 5000 : professional.subscription_status === 'active' ? 500 : 3
  if (!professional.is_admin && (monthlyUsage || 0) >= usageLimit) {
    const limitDescription = professional.subscription_status === 'active' ? 'mensual' : 'de prueba'
    if (professional.subscription_status !== 'active') {
      return jsonResponse(429, {
        success: false,
        message: 'Tus 3 preguntas gratuitas de Sofía ya terminaron. Activá una suscripción para seguir usando a la asistente.',
        monthlyUsage,
        monthlyLimit: usageLimit,
      })
    }
    return jsonResponse(429, { success: false, message: `Alcanzaste el límite ${limitDescription} de Sofía (${usageLimit} consultas).`, monthlyUsage, monthlyLimit: usageLimit })
  }

  const messages = cleanMessages(payload.messages)
  if (!messages.length || messages[messages.length - 1].role !== 'user') {
    return jsonResponse(400, { success: false, message: 'Sofía necesita una pregunta.' })
  }

  const professionalName = typeof payload.professionalName === 'string' ? payload.professionalName.trim() : 'profesional'
  const context = typeof payload.context === 'string' ? payload.context.trim().slice(0, 8000) : ''
  const currentDate = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Argentina/Buenos_Aires', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now)
  const currentTime = new Intl.DateTimeFormat('es-AR', { timeZone: 'America/Argentina/Buenos_Aires', hour: '2-digit', minute: '2-digit' }).format(now)
  const system = [
    'Sos Sofía, la secretaria clínica inteligente de Dr Happy.',
    `Asistís de forma privada a ${professionalName}.`,
    'Respondé en español argentino, con tono profesional, cálido, breve y accionable.',
    'Catálogo actual de Dr Happy: historia clínica y evolución de pacientes; búsqueda y alta de pacientes; turnera manual y calendario de ocupación; turnera pública por obra social y particular; Modo Ambulancia para atención prehospitalaria y traslados; protocolos clínicos; vademécum farmacológico; patologías y CIE-10; comunidad entre profesionales; balance de pagos; perfil, firma digital y documentos; notificaciones push; emails y recordatorios automáticos; administración de usuarios y suscripciones.',
    'Si el profesional pregunta si existe una función incluida en ese catálogo, respondé que sí y explicá brevemente cómo se accede. No niegues una función de Dr Happy por no tener todavía una herramienta específica conectada: distinguí entre "la app lo tiene" y "yo todavía no puedo ejecutarlo directamente".',
    'En esta primera versión no inventes datos clínicos ni afirmes haber consultado una historia que no recibiste.',
    'No diagnostiques ni indiques tratamientos autónomamente. Separá hechos, sugerencias y datos faltantes.',
    'Cuando el profesional pida una acción que todavía no está conectada, explicá que se incorporará como herramienta en la próxima etapa.',
    'Para agendar un turno solicitado directamente por el profesional, ejecutá la acción sin pedir confirmación adicional. Solo informá y detenete si no hay cupo, el día no está habilitado o existe una superposición. Cancelaciones, notificaciones y memorias sí requieren confirmación.',
    'Si el profesional pide cambiar, mover o pasar un turno a otra fecha, usá reprogramar_turno. No lo canceles ni crees otro turno separado: la herramienta cancela el registro anterior, crea un único turno nuevo y avisa al paciente.',
    'No digas que una acción ocurrió si la herramienta no devolvió success=true. Si una operación falla o requiere confirmación, informalo claramente y no lo presentes como realizado.',
    `Fecha y hora actual de Argentina: ${currentDate} ${currentTime}. Si el profesional dice hoy, mañana o pasado mañana, convertílo a YYYY-MM-DD sin preguntarle qué fecha es.`,
    'Si preguntan por turnos o agenda, consultá buscar_turnos cuando necesites informar datos. Si piden agendar, usá directamente la herramienta de agendamiento; no hagas una consulta previa ni pidas confirmación adicional.',
    'Para una pregunta histórica específica sobre un paciente, usá consultar_historia_paciente con topic o dateFrom/dateTo. Por defecto usa las últimas evoluciones; si piden algo antiguo, buscá explícitamente en todo el historial permitido y aclarà qué encontraste.',
    'Si preguntan por los turnos liberados al público, la turnera pública o qué horarios puede elegir un paciente, usá consultar_turnera_publica. Es una herramienta de solo lectura: nunca intentes modificarla ni reservar desde Sofía.',
    'Si preguntan por ocupación, cupos o disponibilidad diaria, usá consultar_calendario_ocupacion. Si piden un link de pago, usá obtener_link_pago_profesional.',
    'PROTOCOLO OBLIGATORIO DE TURNOS: antes de crear un paciente o asignar cualquier turno debés tener nombre, apellido, DNI y email válido. Si falta cualquiera, pedí todos los datos faltantes juntos y no llames a ninguna herramienta de agendamiento. Recién cuando estén los cuatro datos, usá crear_paciente_y_agendar_turno. Para pacientes existentes, agendar_turno verificará que su ficha tenga esos cuatro datos; si falta alguno, pedí completarlo antes de reintentar. Fecha y hora pueden omitirse para elegir el primer turno disponible.',
    'Si el profesional dice que recuerdes una preferencia o tema de trabajo, proponé guardar_memoria_sofia y pedí confirmación. Nunca guardes datos clínicos de pacientes en esa memoria. Si pregunta por algo que podría haber recordado, usá buscar_memorias_sofia.',
    context ? `Contexto disponible de la sesión:\n${context}` : '',
  ].filter(Boolean).join('\n\n')

  let anthropicMessages: unknown[] = messages
  let reply = ''
  let pendingConfirmation: { action: string; proposal: Record<string, unknown> } | undefined
  let inputTokens = 0
  let outputTokens = 0
  for (let iteration = 0; iteration < 10; iteration += 1) {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'x-api-key': anthropicKey, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      body: JSON.stringify({ model, max_tokens: 900, system, tools, messages: anthropicMessages }),
    })
    const result = await response.json().catch(() => null)
    if (!response.ok) {
      console.error('Anthropic request failed', response.status, result)
      const providerMessage = typeof result?.error?.message === 'string' ? result.error.message : 'Respuesta no disponible.'
      return jsonResponse(502, { success: false, message: `Claude rechazó la solicitud (${response.status}): ${providerMessage}` })
    }
    const content = Array.isArray(result?.content) ? result.content : []
    inputTokens += Number(result?.usage?.input_tokens || 0)
    outputTokens += Number(result?.usage?.output_tokens || 0)
    const toolUses = content.filter((item: { type?: string }) => item.type === 'tool_use')
    const text = content.filter((item: { type?: string }) => item.type === 'text').map((item: { text?: string }) => item.text || '').join('\n').trim()
    if (!toolUses.length) { reply = text; break }
    anthropicMessages = [...anthropicMessages, { role: 'assistant', content }]
    const toolResults = []
    let directSchedulingReply = ''
    for (const toolUse of toolUses) {
      let toolData: unknown
      try {
        toolData = await runTool(toolUse.name, toolUse.input || {}, admin, professionalId)
      } catch (error) {
        console.error('[ai-assistant] tool failed', { tool: toolUse.name, message: error instanceof Error ? error.message : String(error) })
        const schedulingTool = toolUse.name === 'agendar_turno' || toolUse.name === 'crear_paciente_y_agendar_turno'
        const recovered = schedulingTool ? await recoverPersistedAppointment(admin, professionalId, toolUse.input || {}) : null
        if (recovered) {
          const recoveredEmail = String(recovered.patientEmail || toolUse.input?.email || '').trim()
          const emailResult = recoveredEmail
            ? await sendAppointmentConfirmation({
              supabaseUrl,
              serviceRoleKey,
              email: recoveredEmail,
              patientName: String(recovered.patientName || 'Paciente'),
              professionalName: 'Dr Happy',
              date: String(recovered.scheduledDate || ''),
              time: String(recovered.scheduledTime || ''),
              location: String(recovered.location || 'Consultorio médico'),
              reason: String(recovered.reason || 'Consulta médica'),
            })
            : { sent: false, message: 'No hay email válido cargado.' }
          toolData = {
            success: true,
            message: `Turno confirmado para ${recovered.patientName} el ${recovered.scheduledDate} a las ${recovered.scheduledTime}.${emailResult.sent ? ` Confirmación enviada a ${recoveredEmail}.` : ` El turno quedó guardado, pero no se pudo enviar el email: ${emailResult.message || 'error de envío'}.`}`,
          }
        } else {
          toolData = { success: false, message: schedulingTool ? 'No pude confirmar el turno. No se encontró una reserva nueva en la agenda.' : 'No pude completar esa acción por un error interno.' }
        }
      }
      const toolRecord = toolData && typeof toolData === 'object' ? toolData as Record<string, unknown> : null
      if (toolRecord?.requiresConfirmation === true && typeof toolRecord.action === 'string' && toolRecord.proposal && typeof toolRecord.proposal === 'object') {
        pendingConfirmation = { action: toolRecord.action, proposal: toolRecord.proposal as Record<string, unknown> }
      }
      if ((toolUse.name === 'agendar_turno' || toolUse.name === 'crear_paciente_y_agendar_turno') && toolRecord && typeof toolRecord.message === 'string') {
        directSchedulingReply = toolRecord.message
        if (toolRecord.success === true) break
      }
      toolResults.push({ type: 'tool_result', tool_use_id: toolUse.id, content: JSON.stringify(toolData).slice(0, 12000) })
    }
    if (directSchedulingReply) {
      reply = directSchedulingReply
      break
    }
    anthropicMessages = [...anthropicMessages, { role: 'user', content: toolResults }]
  }
  if (!reply) return jsonResponse(502, { success: false, message: 'Sofía recibió una respuesta vacía.' })

  const totalTokens = inputTokens + outputTokens
  const estimatedCostUsd = (inputTokens * 3 + outputTokens * 15) / 1_000_000
  await admin.from('ai_usage_events').insert({
    professional_id: professionalId,
    model,
    input_tokens: inputTokens,
    output_tokens: outputTokens,
    total_tokens: totalTokens,
    estimated_cost_usd: estimatedCostUsd,
    request_type: 'chat',
  })

  return jsonResponse(200, { success: true, reply, pendingConfirmation })
})