import { serve } from 'https://deno.land/std@0.224.0/http/server.ts'
import { createClient } from 'jsr:@supabase/supabase-js@2'
import { corsHeaders } from '../_shared/cors.ts'
import { resolveProfessionalId } from '../_shared/professionalSession.ts'
import { buildConsultationInstructions, deliverConsultationInstructions, InstructionsError } from '../_shared/consultationInstructions.ts'

function reply(status: number, body: Record<string, unknown>): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
}

serve(async request => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (request.method !== 'POST') return reply(405, { success: false, message: 'Método no permitido.' })
  try {
    const url = Deno.env.get('SUPABASE_URL')
    const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
    if (!url || !key) throw new Error('Falta configuración del servidor.')
    const admin = createClient(url, key, { auth: { persistSession: false } })
    const professionalId = await resolveProfessionalId(request, admin)
    if (!professionalId) return reply(401, { success: false, message: 'Sesión profesional requerida.' })
    let body: unknown
    try { body = await request.json() }
    catch { return reply(400, { success: false, message: 'Cuerpo JSON inválido.' }) }
    if (!body || typeof body !== 'object' || Array.isArray(body)) return reply(400, { success: false, message: 'Solicitud inválida.' })
    const fields = body as Record<string, unknown>
    if (typeof fields.patientId !== 'string' || !fields.patientId.trim() || fields.patientId.length > 128
      || typeof fields.consultationId !== 'string' || !fields.consultationId.trim() || fields.consultationId.length > 128
      || typeof fields.expectedEmail !== 'string' || fields.expectedEmail.length > 254
      || Object.keys(fields).some(name => !['patientId', 'consultationId', 'expectedEmail'].includes(name))) {
      return reply(400, { success: false, message: 'Se requiere la ficha y evolución guardada, sin contenido clínico ni destinatarios alternativos.' })
    }
    const { data, error } = await admin.from('user_workspaces').select('patients_json').eq('user_id', professionalId).maybeSingle()
    if (error) throw new Error('No se pudo consultar la evolución guardada.')
    const payload = buildConsultationInstructions({
      professionalId, patients: data?.patients_json, patientId: fields.patientId,
      consultationId: fields.consultationId, expectedEmail: fields.expectedEmail,
    })
    await deliverConsultationInstructions(payload, email => fetch(`${url}/functions/v1/send-email`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, apikey: key, 'Content-Type': 'application/json' },
      body: JSON.stringify(email),
      signal: AbortSignal.timeout(25_000),
    }))
    return reply(200, { success: true, recipient: payload.to })
  } catch (error) {
    const status = error instanceof InstructionsError ? error.status : 500
    console.error('consultation-instructions: envío no confirmado', { status })
    return reply(status, {
      success: false,
      message: error instanceof InstructionsError ? error.message : 'No se pudo consultar la evolución ni enviar el correo. Reintentá cuando haya conexión.',
    })
  }
})
