import { corsHeaders } from '../_shared/cors.ts'
import { createClient } from 'jsr:@supabase/supabase-js@2'

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
    name: 'obtener_link_pago_profesional',
    description: 'Obtiene el link o alias de pago que el profesional tiene guardado en su perfil. Nunca inventes uno.',
    input_schema: { type: 'object', properties: {} },
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
    description: 'Consulta la ficha e historial clínico resumido de un paciente del profesional autenticado. Usala sólo cuando el profesional pregunte por un paciente concreto o sus antecedentes.',
    input_schema: {
      type: 'object',
      properties: { query: { type: 'string', description: 'Nombre, apellido o DNI del paciente.' } },
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
    description: 'Agenda un turno. Antes de usarla consultá buscar_turnos para verificar disponibilidad. Convertí hoy/mañana a una fecha YYYY-MM-DD usando la fecha actual del sistema. Siempre requiere confirmation=true; si es false, solo prepara una propuesta y no modifica datos.',
    input_schema: { type: 'object', properties: { patient: { type: 'string' }, date: { type: 'string', description: 'Fecha YYYY-MM-DD, nunca texto relativo.' }, time: { type: 'string' }, reason: { type: 'string' }, durationMinutes: { type: 'number' }, location: { type: 'string' }, confirmation: { type: 'boolean' } }, required: ['patient', 'date', 'time', 'confirmation'] },
  },
  {
    name: 'crear_paciente_y_agendar_turno',
    description: 'Registra un paciente nuevo y agenda su primer turno. Requiere confirmation=true; sin confirmación solo prepara una propuesta.',
    input_schema: { type: 'object', properties: { nombre: { type: 'string' }, apellido: { type: 'string' }, dni: { type: 'string' }, email: { type: 'string' }, phone: { type: 'string' }, obraSocial: { type: 'string' }, date: { type: 'string', description: 'Fecha YYYY-MM-DD.' }, time: { type: 'string' }, reason: { type: 'string' }, location: { type: 'string' }, confirmation: { type: 'boolean' } }, required: ['nombre', 'apellido', 'dni', 'date', 'time', 'confirmation'] },
  },
  {
    name: 'cancelar_turno',
    description: 'Cancela un turno. Siempre requiere confirmation=true; si es false, solo prepara una propuesta y no modifica datos.',
    input_schema: { type: 'object', properties: { patient: { type: 'string' }, date: { type: 'string' }, time: { type: 'string' }, confirmation: { type: 'boolean' } }, required: ['patient', 'confirmation'] },
  },
  {
    name: 'enviar_notificacion_paciente',
    description: 'Envía un email a un paciente. Siempre requiere confirmation=true; si es false, solo prepara una propuesta y no envía nada.',
    input_schema: { type: 'object', properties: { patient: { type: 'string' }, subject: { type: 'string' }, message: { type: 'string' }, confirmation: { type: 'boolean' } }, required: ['patient', 'subject', 'message', 'confirmation'] },
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
    const requestedDate = typeof input.date === 'string' ? input.date : ''
    const requestedMonth = typeof input.month === 'string' ? input.month : ''
    const dates = appointments.map((item) => String(item.scheduledDate || '')).filter(Boolean)
    const uniqueDates = Array.from(new Set(dates)).filter((date) => (!requestedDate || date === requestedDate) && (!requestedMonth || date.startsWith(requestedMonth))).sort()
    const occupancy = uniqueDates.map((date) => {
      const count = appointments.filter((item) => item.scheduledDate === date && item.status !== 'cancelled').length
      return { date, occupied: count, available: Math.max(0, dailyLimit - count), limit: dailyLimit }
    })
    return { dailyLimit, appointmentDays: configuredDays, occupancy }
  }

  if (name === 'obtener_link_pago_profesional') {
    const { data } = await admin.from('user_workspaces').select('profile_json').eq('user_id', professionalId).maybeSingle()
    const profile = data?.profile_json && typeof data.profile_json === 'object' ? data.profile_json as Record<string, unknown> : {}
    return { paymentLink: typeof profile.paymentLink === 'string' ? profile.paymentLink : null }
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
          ? patient.consultations.slice(-10).map((consultation: Record<string, unknown>) => ({
            date: consultation.date,
            motivoConsulta: consultation.motivoConsulta,
            diagnostico: consultation.diagnostico,
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
    const { data } = await admin.from('user_workspaces').select('patients_json, appointments_json').eq('user_id', professionalId).maybeSingle()
    const patients = Array.isArray(data?.patients_json) ? data.patients_json as Array<Record<string, unknown>> : []
    const patient = patients.find((item) => normalizeSearch(`${item.nombre || ''} ${item.apellido || ''} ${item.dni || ''}`).includes(patientQuery))
    if (!patient) return { success: false, message: 'No encontré un paciente que coincida. Pedí nombre completo o DNI.' }
    const proposal = { patient: `${patient.apellido || ''}, ${patient.nombre || ''}`.trim(), patientId: patient.id, date: input.date, time: input.time, reason: input.reason || 'Consulta médica', durationMinutes: Number(input.durationMinutes) || 30, location: input.location || 'Consultorio médico' }
    if (input.confirmation !== true) return { requiresConfirmation: true, action: 'agendar_turno', proposal, message: 'Pedí confirmación explícita antes de agendar.' }
    const appointments = Array.isArray(data?.appointments_json) ? data.appointments_json as Array<Record<string, unknown>> : []
    const conflict = appointments.some((item) => item.status !== 'cancelled' && item.scheduledDate === input.date && item.scheduledTime === input.time)
    if (conflict) return { success: false, message: 'Ese horario ya está ocupado.' }
    const appointment = { id: crypto.randomUUID(), patientId: patient.id, patientName: proposal.patient, patientEmail: patient.email || '', patientDni: patient.dni || '', scheduledDate: input.date, scheduledTime: input.time, scheduledAt: `${input.date}T${input.time}:00`, durationMinutes: proposal.durationMinutes, reason: proposal.reason, location: proposal.location, status: 'confirmed', createdAt: new Date().toISOString(), createdByUserId: professionalId }
    const { error } = await admin.from('user_workspaces').upsert({ user_id: professionalId, appointments_json: [...appointments, appointment] }, { onConflict: 'user_id' })
    return error ? { success: false, message: error.message } : { success: true, message: `Turno agendado para ${proposal.patient} el ${input.date} a las ${input.time}.` }
  }

  if (name === 'crear_paciente_y_agendar_turno') {
    const nombre = String(input.nombre || '').trim()
    const apellido = String(input.apellido || '').trim()
    const dni = String(input.dni || '').trim()
    const date = String(input.date || '').trim()
    const time = String(input.time || '').trim()
    if (!nombre || !apellido || !dni || !date || !time) return { success: false, message: 'Faltan nombre, apellido, DNI, fecha u hora.' }
    const { data } = await admin.from('user_workspaces').select('patients_json, appointments_json').eq('user_id', professionalId).maybeSingle()
    const patients = Array.isArray(data?.patients_json) ? data.patients_json as Array<Record<string, unknown>> : []
    const appointments = Array.isArray(data?.appointments_json) ? data.appointments_json as Array<Record<string, unknown>> : []
    const existing = patients.find((patient) => String(patient.dni || '').trim() === dni)
    const patientId = existing?.id || crypto.randomUUID()
    const patientName = `${apellido}, ${nombre}`
    const proposal = { patientName, dni, email: input.email || '', date, time, reason: input.reason || 'Consulta médica', location: input.location || 'Consultorio médico' }
    if (input.confirmation !== true) return { requiresConfirmation: true, action: 'crear_paciente_y_agendar_turno', proposal, message: 'Pedí confirmación explícita antes de registrar al paciente y agendar.' }
    if (appointments.some((item) => item.status !== 'cancelled' && item.scheduledDate === date && item.scheduledTime === time)) return { success: false, message: 'Ese horario ya está ocupado.' }
    const patient = existing || { id: patientId, ownerUserId: professionalId, nombre, apellido, dni, email: input.email || '', obraSocial: input.obraSocial || '', numeroAfiliado: '', plan: '', birthDate: '', edad: 0, patologiasConocidas: '', patologiasCronicas: '', ultimaInternacion: '', cirugiasPrevias: '', direccion: '', documents: [], consultations: [], createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() }
    const appointment = { id: crypto.randomUUID(), patientId, patientName, patientEmail: input.email || '', patientDni: dni, scheduledDate: date, scheduledTime: time, scheduledAt: `${date}T${time}:00`, durationMinutes: 30, reason: proposal.reason, location: proposal.location, status: 'confirmed', createdAt: new Date().toISOString(), createdByUserId: professionalId }
    const { error } = await admin.from('user_workspaces').upsert({ user_id: professionalId, patients_json: existing ? patients : [...patients, patient], appointments_json: [...appointments, appointment] }, { onConflict: 'user_id' })
    return error ? { success: false, message: error.message } : { success: true, message: `Paciente ${patientName} registrado y turno agendado para ${date} a las ${time}.` }
  }

  if (name === 'cancelar_turno') {
    const query = normalizeSearch(input.patient)
    const { data } = await admin.from('user_workspaces').select('appointments_json').eq('user_id', professionalId).maybeSingle()
    const appointments = Array.isArray(data?.appointments_json) ? data.appointments_json as Array<Record<string, unknown>> : []
    const match = appointments.find((item) => item.status !== 'cancelled' && normalizeSearch(`${item.patientName || ''} ${item.patientDni || ''}`).includes(query) && (!input.date || item.scheduledDate === input.date) && (!input.time || item.scheduledTime === input.time))
    if (!match) return { success: false, message: 'No encontré ese turno.' }
    const proposal = { patient: match.patientName, date: match.scheduledDate, time: match.scheduledTime, reason: match.reason }
    if (input.confirmation !== true) return { requiresConfirmation: true, action: 'cancelar_turno', proposal, message: 'Pedí confirmación explícita antes de cancelar.' }
    const nextAppointments = appointments.map((item) => item.id === match.id ? { ...item, status: 'cancelled' } : item)
    const { error } = await admin.from('user_workspaces').upsert({ user_id: professionalId, appointments_json: nextAppointments }, { onConflict: 'user_id' })
    return error ? { success: false, message: error.message } : { success: true, message: `Turno cancelado para ${match.patientName} el ${match.scheduledDate} a las ${match.scheduledTime}.` }
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

  const professionalId = typeof payload.professionalId === 'string' ? payload.professionalId.trim() : ''
  const admin = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false } })
  if (!professionalId) return jsonResponse(401, { success: false, message: 'Sesión profesional requerida.' })
  const { data: professional } = await admin
    .from('professionals')
    .select('id, active')
    .eq('id', professionalId)
    .maybeSingle()
  if (!professional || professional.active === false) return jsonResponse(401, { success: false, message: 'Profesional no autorizado.' })

  const messages = cleanMessages(payload.messages)
  if (!messages.length || messages[messages.length - 1].role !== 'user') {
    return jsonResponse(400, { success: false, message: 'Sofía necesita una pregunta.' })
  }

  const professionalName = typeof payload.professionalName === 'string' ? payload.professionalName.trim() : 'profesional'
  const context = typeof payload.context === 'string' ? payload.context.trim().slice(0, 8000) : ''
  const now = new Date()
  const currentDate = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Argentina/Buenos_Aires', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now)
  const currentTime = new Intl.DateTimeFormat('es-AR', { timeZone: 'America/Argentina/Buenos_Aires', hour: '2-digit', minute: '2-digit' }).format(now)
  const system = [
    'Sos Sofía, la secretaria clínica inteligente de Dr Happy.',
    `Asistís de forma privada a ${professionalName}.`,
    'Respondé en español argentino, con tono profesional, cálido, breve y accionable.',
    'En esta primera versión no inventes datos clínicos ni afirmes haber consultado una historia que no recibiste.',
    'No diagnostiques ni indiques tratamientos autónomamente. Separá hechos, sugerencias y datos faltantes.',
    'Cuando el profesional pida una acción que todavía no está conectada, explicá que se incorporará como herramienta en la próxima etapa.',
    'Nunca ejecutes agendar_turno, cancelar_turno o enviar_notificacion_paciente sin confirmation=true. Primero presentá la propuesta y pedí confirmación explícita.',
    `Fecha y hora actual de Argentina: ${currentDate} ${currentTime}. Si el profesional dice hoy, mañana o pasado mañana, convertílo a YYYY-MM-DD sin preguntarle qué fecha es.`,
    'Si preguntan por turnos o agenda, usá siempre buscar_turnos antes de responder. Si piden agendar, primero consultá disponibilidad con buscar_turnos y luego pedí confirmación.',
    'Si preguntan por ocupación, cupos o disponibilidad diaria, usá consultar_calendario_ocupacion. Si piden un link de pago, usá obtener_link_pago_profesional.',
    'Para un paciente nuevo usá crear_paciente_y_agendar_turno; nunca registres ni agendes sin confirmation=true.',
    context ? `Contexto disponible de la sesión:\n${context}` : '',
  ].filter(Boolean).join('\n\n')

  let anthropicMessages: unknown[] = messages
  let reply = ''
  let inputTokens = 0
  let outputTokens = 0
  for (let iteration = 0; iteration < 4; iteration += 1) {
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
    for (const toolUse of toolUses) {
      const toolData = await runTool(toolUse.name, toolUse.input || {}, admin, professionalId)
      toolResults.push({ type: 'tool_result', tool_use_id: toolUse.id, content: JSON.stringify(toolData).slice(0, 12000) })
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

  return jsonResponse(200, { success: true, reply })
})