import { serve } from 'https://deno.land/std@0.224.0/http/server.ts'
import { createClient } from 'jsr:@supabase/supabase-js@2'
import { resolveProfessionalId } from '../_shared/professionalSession.ts'
import { corsHeaders } from '../_shared/cors.ts'

const reply = (status: number, body: Record<string, unknown>) => new Response(JSON.stringify(body), {
  status, headers: { ...corsHeaders, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
})
const validId = (value: unknown): value is string => typeof value === 'string' && /^[a-zA-Z0-9_-]{1,160}$/.test(value)
async function hash(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('')
}
type Entry = Record<string, unknown>
function entries(value: unknown): Entry[] {
  if (!Array.isArray(value) || value.some(item => !item || typeof item !== 'object' || Array.isArray(item))) {
    throw new Error('Invalid workspace collection')
  }
  return value
}
serve(async request => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (request.method !== 'POST') return reply(405, { error: 'Metodo no permitido.' })
  let body: Entry
  try {
    const value: unknown = await request.json()
    if (!value || typeof value !== 'object' || Array.isArray(value)) return reply(400, { error: 'Solicitud invalida.' })
    body = value as Entry
  } catch { return reply(400, { error: 'Solicitud JSON invalida.' }) }
  const url = Deno.env.get('SUPABASE_URL')
  const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  if (!url || !key) return reply(503, { error: 'Servicio no configurado.' })
  try {
    const admin = createClient(url, key, { auth: { persistSession: false } })
    if (body.action === 'event') {
      if (typeof body.lifecycleToken !== 'string' || !/^[a-f0-9]{64}$/.test(body.lifecycleToken)
        || !['start', 'completed', 'expired', 'interrupted', 'rejected'].includes(String(body.event))) {
        return reply(400, { error: 'Evento de videoconsulta invalido.' })
      }
      const { data, error } = await admin.rpc('advance_video_consultation', {
        p_lifecycle_hash: await hash(body.lifecycleToken), p_event: body.event,
      })
      if (error) throw error
      if (data !== true) return reply(409, { error: 'El registro de videoconsulta no esta disponible.' })
      return reply(200, { ok: true })
    }
    const id = await resolveProfessionalId(request, admin)
    if (!id) return reply(401, { error: 'Volve a iniciar sesion en Dr Happy.' })
    const { data: professional, error: professionalError } = await admin.from('professionals').select('is_admin,active').eq('id', id).maybeSingle()
    if (professionalError) throw professionalError
    if (professional?.is_admin !== true || professional.active === false) return reply(403, { error: 'La videoconsulta esta habilitada para administradores.' })
    const { data: workspace, error: workspaceError } = await admin.from('user_workspaces').select('patients_json,appointments_json').eq('user_id', id).maybeSingle()
    if (workspaceError) throw workspaceError
    const { data: archives, error: archiveError } = await admin.from('dental_patient_archives').select('patient_id').eq('professional_id', id).neq('state', 'active')
    if (archiveError) throw archiveError
    const hiddenIds = new Set(entries(archives ?? []).map(entry => entry.patient_id))
    const patients = entries(workspace?.patients_json ?? []).filter(patient => validId(patient.id) && patient.ownerUserId === id && !hiddenIds.has(patient.id))
    const patientIds = new Set(patients.map(patient => patient.id))
    const appointments = entries(workspace?.appointments_json ?? []).filter(appointment =>
      validId(appointment.id) && patientIds.has(appointment.patientId) && appointment.status !== 'cancelled')
    if (body.action === 'list') {
      const { error: reconcileError } = await admin.rpc('reconcile_video_consultations', { p_professional_id: id })
      if (reconcileError) throw reconcileError
      return reply(200, {
        patients: patients.map(patient => ({ id: patient.id, name: `${String(patient.apellido ?? '')}, ${String(patient.nombre ?? '')}` })),
        appointments: appointments.map(appointment => ({
          id: appointment.id, patientId: appointment.patientId,
          label: `${String(appointment.scheduledDate ?? '')} ${String(appointment.scheduledTime ?? '')}`,
        })),
      })
    }
    if (body.action === 'create') {
      if (!validId(body.patientId) || (body.appointmentId !== undefined && !validId(body.appointmentId))
        || !Number.isInteger(body.durationMinutes) || Number(body.durationMinutes) < 1 || Number(body.durationMinutes) > 120) {
        return reply(400, { error: 'Paciente, turno o duracion invalidos.' })
      }
      const patient = patients.find(patient => patient.id === body.patientId)
      if (!patient) return reply(403, { error: 'El paciente no pertenece a tus fichas guardadas. Guarda la ficha y volve a intentar.' })
      if (body.appointmentId && !appointments.some(appointment => appointment.id === body.appointmentId && appointment.patientId === patient.id)) {
        return reply(403, { error: 'El turno no corresponde a este paciente o no esta disponible.' })
      }
      const lifecycleToken = Array.from(crypto.getRandomValues(new Uint8Array(32)), byte => byte.toString(16).padStart(2, '0')).join('')
      const { data, error } = await admin.from('video_consultations').insert({
        professional_id: id, patient_id: patient.id, appointment_id: body.appointmentId ?? null,
        duration_minutes: body.durationMinutes, lifecycle_hash: await hash(lifecycleToken),
      }).select('id').single()
      if (error) throw error
      return reply(201, { consultationId: data.id, patientName: `${String(patient.apellido ?? '')}, ${String(patient.nombre ?? '')}`, lifecycleToken })
    }
    return reply(400, { error: 'Accion no reconocida.' })
  } catch (error) {
    console.error('video-consultations: fallo de registro', error instanceof Error ? error.message : 'Error de base de datos')
    return reply(503, { error: 'No se pudo consultar o guardar el registro de videoconsulta. Reintenta.' })
  }
})
