import { corsHeaders } from '../_shared/cors.ts'
import { createClient } from 'jsr:@supabase/supabase-js@2'
import { resolveProfessionalId } from '../_shared/professionalSession.ts'

function respond(status: number, body: Record<string, unknown>): Response {
  return new Response(JSON.stringify(body), {
    status, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (request.method !== 'POST') return respond(405, { success: false, message: 'Método no permitido.' })
  const url = Deno.env.get('SUPABASE_URL')
  const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  if (!url || !key) return respond(500, { success: false, message: 'Falta configuración del servidor.' })
  const admin = createClient(url, key, { auth: { persistSession: false } })
  const professionalId = await resolveProfessionalId(request, admin)
  if (!professionalId) return respond(401, { success: false, message: 'Sesión profesional requerida.' })
  let body: Record<string, unknown>
  try {
    const text = await request.text()
    if (new TextEncoder().encode(text).length > 1100000) return respond(413, { success: false, message: 'Ficha demasiado grande.' })
    const parsed: unknown = JSON.parse(text)
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('object required')
    body = parsed as Record<string, unknown>
  } catch {
    return respond(400, { success: false, message: 'Cuerpo JSON inválido.' })
  }
  if (typeof body.patientId !== 'string' || !body.patientId.trim() || body.patientId.length > 128) {
    return respond(400, { success: false, message: 'Paciente inválido.' })
  }
  let rpc: 'dental_load' | 'dental_save'
  const args: Record<string, unknown> = { p_professional_id: professionalId, p_patient_id: body.patientId }
  if (body.action === 'load') {
    rpc = 'dental_load'
  } else if (body.action === 'save') {
    if (!Number.isSafeInteger(body.expectedRevision) || Number(body.expectedRevision) < 0
      || Number(body.expectedRevision) > 2147483646 || typeof body.confirm !== 'boolean'
      || !body.record || typeof body.record !== 'object' || Array.isArray(body.record)
      || (body.appointmentId !== undefined && body.appointmentId !== null
        && (typeof body.appointmentId !== 'string' || !body.appointmentId.trim() || body.appointmentId.length > 128))) {
      return respond(400, { success: false, message: 'Ficha, revisión o confirmación inválida.' })
    }
    rpc = 'dental_save'
    Object.assign(args, { p_record: body.record, p_expected_revision: body.expectedRevision,
      p_confirm: body.confirm, p_appointment_id: body.appointmentId ?? null })
  } else {
    return respond(400, { success: false, message: 'Acción no soportada.' })
  }
  const { data, error } = await admin.rpc(rpc, args)
  if (error) {
    const revisionConflict = error.code === 'PT409' || error.code === '40001'
      || /\brevision_conflict\b/.test(`${error.message ?? ''} ${error.details ?? ''}`)
    const status = revisionConflict ? 409 : error.code === '42501' ? 403
      : error.code === 'P0002' ? 404 : ['22023', '22007', '22008', '22P02'].includes(error.code) ? 400 : 500
    if (status === 500) console.error('dental_records_rpc_failed', {
      rpc,
      code: typeof error.code === 'string' && /^[A-Za-z0-9_-]{1,32}$/.test(error.code) ? error.code : null,
      kind: typeof error.message === 'string' && /(?:fetch|network|timeout|connection|socket)/i.test(error.message)
        ? 'transport' : 'rpc_error',
    })
    return respond(status, { success: false, code: status === 409 ? 'revision_conflict' : error.code,
      message: status === 409 ? 'La ficha cambió. Recargala antes de guardar.' : status === 500 ? 'No se pudo guardar la ficha.' : error.message })
  }
  return respond(200, data as Record<string, unknown>)
})
