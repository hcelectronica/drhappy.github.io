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
const SUMMARY_SYSTEM_PROMPT = [
  'Sos Sofía, asistente clínica de Dr Happy. Recibís dos transcripciones automáticas de una videoconsulta, una por canal: lo que dijo el profesional y lo que dijo el paciente.',
  'Provienen de un reconocedor de voz local: no tienen puntuación y pueden tener palabras mal reconocidas. Cada línea empieza con [mm:ss] desde el inicio de la transcripción; usalo para reconstruir el orden del diálogo. Reconstruí el sentido sin inventar.',
  'Redactá un borrador de evolución clínica en español rioplatense, claro, conciso y en tercera persona, solo con lo que surge de la conversación. No agregues diagnósticos, dosis, estudios ni indicaciones que no se hayan dicho. Marcá lo dudoso con [¿?].',
  'Si la conversación es insuficiente para resumir, indicalo brevemente en el resumen en lugar de rellenar.',
  'Respondé únicamente con un objeto JSON válido, sin texto adicional ni bloques de código, con estas claves de texto: "motivoConsulta" (una línea, máximo 200 caracteres), "detalleAtencion" (lo que refiere el paciente y lo que evalúa o explica el profesional) y "planManejo" (indicaciones, controles y pendientes acordados; cadena vacía si no hubo).',
].join('\n')
const text = (value: unknown, max: number) => typeof value === 'string' ? value.replace(/\r\n?/g, '\n').trim().slice(0, max) : ''
function parseSummary(raw: string) {
  const cleaned = raw.replace(/^```(?:json)?\s*|\s*```$/g, '').trim()
  try {
    const value = JSON.parse(cleaned.slice(cleaned.indexOf('{'), cleaned.lastIndexOf('}') + 1))
    const summary = { motivoConsulta: text(value?.motivoConsulta, 300), detalleAtencion: text(value?.detalleAtencion, 8000), planManejo: text(value?.planManejo, 4000) }
    if (summary.detalleAtencion) return summary
  } catch { /* Se usa el texto completo como resumen. */ }
  return { motivoConsulta: 'Videoconsulta', detalleAtencion: text(cleaned, 8000), planManejo: '' }
}
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
    if (body.action === 'summarize' || body.action === 'save-summary') {
      const consultationId = typeof body.consultationId === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(body.consultationId) ? body.consultationId : null
      if (!consultationId) return reply(400, { error: 'Videoconsulta invalida.' })
      const { data: consultation, error: consultationError } = await admin.from('video_consultations')
        .select('id,started_at,summary_saved_at').eq('id', consultationId).eq('professional_id', id).maybeSingle()
      if (consultationError) throw consultationError
      if (!consultation?.started_at) return reply(404, { error: 'La videoconsulta no existe o no llego a comenzar.' })
      if (consultation.summary_saved_at) return reply(409, { error: 'El resumen de esta videoconsulta ya fue guardado en la historia clinica.' })
      if (body.action === 'summarize') {
        const professionalText = text(body.professional, 100_000)
        const patientText = text(body.patient, 100_000)
        if (typeof body.professional !== 'string' || typeof body.patient !== 'string' || body.professional.length > 100_000 || body.patient.length > 100_000
          || (professionalText + patientText).replace(/[^\p{L}]/gu, '').length < 20) {
          return reply(400, { error: 'La transcripcion es demasiado corta para resumirla.' })
        }
        const anthropicKey = Deno.env.get('ANTHROPIC_API_KEY')?.trim()
        const model = Deno.env.get('ANTHROPIC_MODEL')?.trim() || 'claude-sonnet-4-5'
        if (!anthropicKey) return reply(503, { error: 'Sofia no esta configurada.' })
        const { data: claim, error: claimError } = await admin.rpc('claim_sofia_consultation', { p_professional_id: id, p_model: model })
        if (claimError) throw claimError
        if (!claim?.allowed) return reply(claim?.reason === 'expired' ? 402 : 429, { error: claim?.reason === 'expired' ? 'Tu acceso a Sofia vencio.' : 'Alcanzaste el limite mensual de consultas de Sofia.' })
        let inputTokens = 0
        let outputTokens = 0
        try {
          const response = await fetch('https://api.anthropic.com/v1/messages', {
            method: 'POST',
            headers: { 'x-api-key': anthropicKey, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
            body: JSON.stringify({ model, max_tokens: 2000, system: SUMMARY_SYSTEM_PROMPT, messages: [{ role: 'user', content:
              `TRANSCRIPCION DEL PROFESIONAL:\n${professionalText || '(sin texto)'}\n\nTRANSCRIPCION DEL PACIENTE:\n${patientText || '(sin texto)'}` }] }),
            signal: AbortSignal.timeout(50_000),
          })
          const result = await response.json().catch(() => null)
          inputTokens = Number(result?.usage?.input_tokens || 0)
          outputTokens = Number(result?.usage?.output_tokens || 0)
          const raw = Array.isArray(result?.content) ? result.content.filter((item: Entry) => item.type === 'text').map((item: Entry) => String(item.text || '')).join('\n').trim() : ''
          if (!response.ok || !raw) {
            console.error('video-consultations: resumen rechazado', response.status)
            return reply(502, { error: 'Sofia no pudo generar el resumen. Reintenta.' })
          }
          return reply(200, parseSummary(raw))
        } catch (error) {
          console.error('video-consultations: Sofia no respondio', error instanceof Error ? error.message : error)
          return reply(502, { error: 'Sofia no respondio a tiempo. Reintenta.' })
        } finally {
          const { error: usageError } = await admin.from('ai_usage_events').update({
            input_tokens: inputTokens, output_tokens: outputTokens, total_tokens: inputTokens + outputTokens,
            estimated_cost_usd: (inputTokens * 3 + outputTokens * 15) / 1_000_000,
          }).eq('id', claim.eventId)
          if (usageError) console.error('video-consultations: no se pudo actualizar el consumo', usageError.message)
          if (inputTokens === 0 && outputTokens === 0) await admin.from('ai_usage_events').delete().eq('id', claim.eventId)
        }
      }
      const motivo = text(body.motivoConsulta, 300)
      const detalle = text(body.detalleAtencion, 8000)
      const plan = text(body.planManejo, 4000)
      if (!detalle) return reply(400, { error: 'El resumen no puede quedar vacio.' })
      const { data: workspaceProfile, error: profileError } = await admin.from('user_workspaces').select('profile_json').eq('user_id', id).maybeSingle()
      if (profileError) throw profileError
      const profile = (workspaceProfile?.profile_json && typeof workspaceProfile.profile_json === 'object' ? workspaceProfile.profile_json : {}) as Entry
      const signatureImage = profile.signatureImage && typeof profile.signatureImage === 'object' ? (profile.signatureImage as Entry).dataUrl : undefined
      const entry = {
        id: `video-${consultationId}`,
        date: new Date().toISOString(),
        motivoConsulta: `[VIDEOCONSULTA] ${motivo || 'Videoconsulta'}`,
        diagnostico: '',
        detalleAtencion: `${detalle}\n\nResumen generado con Sofia a partir de la transcripcion de la videoconsulta y revisado por el profesional.`,
        pensamientoMedico: '',
        ...(plan ? { planManejo: plan } : {}),
        professionalSignature: {
          fullName: String(profile.fullName ?? ''), licenseNumber: String(profile.licenseNumber ?? ''), signatureText: String(profile.signatureText ?? ''),
          ...(typeof signatureImage === 'string' && signatureImage ? { signatureImageDataUrl: signatureImage } : {}),
        },
        videoConsultationId: consultationId,
      }
      const { data: saved, error: saveError } = await admin.rpc('append_video_consultation_entry', { p_professional_id: id, p_consultation_id: consultationId, p_entry: entry })
      if (saveError) throw saveError
      if (saved === 'duplicate') return reply(409, { error: 'El resumen de esta videoconsulta ya fue guardado en la historia clinica.' })
      if (saved !== 'saved') return reply(404, { error: 'La ficha del paciente ya no esta disponible.' })
      return reply(201, { ok: true })
    }
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
