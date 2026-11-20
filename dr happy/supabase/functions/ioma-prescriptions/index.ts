import { createClient } from 'jsr:@supabase/supabase-js@2'
import { corsHeaders } from '../_shared/cors.ts'
import { resolveProfessionalId } from '../_shared/professionalSession.ts'
import { ensurePublicAlias, findPublicAliasOwner } from '../_shared/professionalPublicAlias.ts'
import { hasMedicalToolRowAccess, MEDICAL_TOOL_ACCESS_COLUMNS } from '../_shared/medicalToolAccess.ts'

const reply = (status: number, body: Record<string, unknown>) => new Response(JSON.stringify(body), {
  status, headers: { ...corsHeaders, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
})
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const text = (value: unknown, limit: number) => typeof value === 'string'
  ? value.replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, limit) : ''

Deno.serve(async request => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (request.method !== 'POST') return reply(405, { success: false, message: 'Método no permitido.' })
  const url = Deno.env.get('SUPABASE_URL'), key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  if (!url || !key) return reply(503, { success: false, message: 'Servicio no configurado.' })
  if (Number(request.headers.get('content-length') || 0) > 20_000) return reply(413, { success: false, message: 'La solicitud supera el tamaño permitido.' })
  let body: Record<string, unknown>
  try {
    const raw = await request.text()
    if (raw.length > 20_000) return reply(413, { success: false, message: 'La solicitud supera el tamaño permitido.' })
    const parsed: unknown = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return reply(400, { success: false, message: 'Solicitud inválida.' })
    body = parsed as Record<string, unknown>
  } catch { return reply(400, { success: false, message: 'Solicitud inválida.' }) }
  const admin = createClient(url, key, { auth: { persistSession: false } })
  try {
    const publicAction = body.action === 'public-info' || body.action === 'submit'
    const slug = text(body.slug, 80).toLowerCase()
    const professionalId = publicAction
      ? (/^[a-z0-9-]{1,80}$/.test(slug) ? await findPublicAliasOwner(admin, slug) : null)
      : await resolveProfessionalId(request, admin)
    if (!professionalId) return reply(publicAction ? 404 : 401, { success: false, message: publicAction ? 'Este servicio no está disponible.' : 'Iniciá sesión nuevamente.' })
    const { data: professional, error: professionalError } = await admin.from('professionals')
      .select(`${MEDICAL_TOOL_ACCESS_COLUMNS}, full_name, email`).eq('id', professionalId).maybeSingle()
    if (professionalError) throw professionalError
    if (!professional || professional.active === false || !hasMedicalToolRowAccess(professional, ['attention'])) {
      return reply(404, { success: false, message: 'Este servicio no está disponible.' })
    }
    if (body.action === 'get-settings' || body.action === 'save-settings') {
      if (body.action === 'save-settings') {
        if (typeof body.enabled !== 'boolean') return reply(400, { success: false, message: 'Revisá la configuración.' })
        const { error } = await admin.from('ioma_prescription_settings').upsert({ professional_id: professionalId, enabled: body.enabled })
        if (error) throw error
      }
      const { data, error } = await admin.from('ioma_prescription_settings').select('enabled').eq('professional_id', professionalId).maybeSingle()
      if (error) throw error
      return reply(200, { success: true, enabled: data?.enabled === true, slug: await ensurePublicAlias(admin, professionalId) })
    }
    if (publicAction) {
      const { data: settings, error } = await admin.from('ioma_prescription_settings').select('enabled').eq('professional_id', professionalId).maybeSingle()
      if (error) throw error
      if (!settings?.enabled) return reply(404, { success: false, message: 'Este servicio no está habilitado.' })
      if (body.action === 'public-info') return reply(200, { success: true, enabled: true, professionalName: professional.full_name || 'Profesional' })
      if (typeof body.website === 'string' && body.website.trim()) return reply(400, { success: false, message: 'No se pudo enviar la solicitud.' })
      const first = text(body.patientFirstName, 80), last = text(body.patientLastName, 80)
      const dni = text(body.patientDni, 12).replace(/\D/g, ''), email = text(body.patientEmail, 160).toLowerCase()
      const phone = text(body.patientPhone, 30).replace(/[^\d+]/g, ''), birth = text(body.birthDate, 10)
      const member = text(body.insuranceMemberNumber, 80), medication = text(body.medication, 2000)
      const date = new Date(`${birth}T12:00:00Z`)
      if (body.consent !== true || !first || !last || !/^\d{6,9}$/.test(dni)
        || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || phone.replace(/\D/g, '').length < 8
        || !/^\d{4}-\d{2}-\d{2}$/.test(birth) || Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== birth
        || date > new Date() || date.getUTCFullYear() < 1900 || !member || medication.length < 2) {
        return reply(400, { success: false, message: 'Completá los datos, el número de afiliado y la medicación solicitada.' })
      }
      if (body.image != null || body.token != null) return reply(400, { success: false, message: 'No se reciben capturas ni tokens en esta solicitud.' })
      const id = crypto.randomUUID()
      const { error: insertError } = await admin.rpc('create_ioma_prescription_request', {
        p_professional_id: professionalId,
        p_request: { id, patientFirstName: first, patientLastName: last, patientDni: dni, patientEmail: email,
          patientPhone: phone, birthDate: birth, insuranceMemberNumber: member, medication },
      })
      if (insertError) { console.error('[ioma-prescriptions] No se pudo guardar', { code: insertError.code }); return reply(503, { success: false, message: 'No se pudo registrar la solicitud. Contactá al consultorio.' }) }
      let emailSent = false
      try {
        const { data: workspace, error: workspaceError } = await admin.from('user_workspaces').select('profile_json').eq('user_id', professionalId).maybeSingle()
        if (workspaceError) throw workspaceError
        const profile = workspace?.profile_json && typeof workspace.profile_json === 'object' ? workspace.profile_json as Record<string, unknown> : {}
        const recipient = text(profile.email, 160) || text(professional.email, 160)
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(recipient)) throw new Error('No hay email profesional válido.')
        const response = await fetch(`${url}/functions/v1/send-email`, {
          method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}`, apikey: key },
          body: JSON.stringify({ to: recipient, subject: 'Dr Happy - Nueva solicitud de receta IOMA', type: 'custom',
            text: 'Tenés una nueva solicitud gratuita de receta IOMA. Ingresá a Dr Happy para revisarla.',
            templateData: { message: 'Tenés una nueva solicitud gratuita de receta IOMA. Ingresá a Dr Happy para revisarla.' } }),
          signal: AbortSignal.timeout(10000),
        })
        const result: unknown = await response.json()
        emailSent = response.ok && !!result && typeof result === 'object' && 'success' in result && result.success === true
        if (!emailSent) console.error('[ioma-prescriptions] El correo no fue aceptado', { id, status: response.status })
      } catch (error) { console.error('[ioma-prescriptions] No se pudo enviar aviso', { id, message: error instanceof Error ? error.message : 'Error de correo' }) }
      const { error: statusError } = await admin.from('ioma_prescription_requests').update({ email_status: emailSent ? 'sent' : 'failed' }).eq('id', id)
      if (statusError) console.error('[ioma-prescriptions] No se pudo registrar el aviso', { id, code: statusError.code })
      return reply(200, { success: true, emailSent })
    }
    if (body.action === 'list') {
      const offset = body.offset === undefined ? 0 : Number(body.offset)
      if (!Number.isSafeInteger(offset) || offset < 0) return reply(400, { success: false, message: 'Página inválida.' })
      const { data, error } = await admin.from('ioma_prescription_requests')
        .select('id,patient_first_name,patient_last_name,patient_dni,patient_email,patient_phone,patient_birth_date,insurance_member_number,medication,status,email_status,created_at,completed_at')
        .eq('professional_id', professionalId).order('created_at', { ascending: false })
        .order('id', { ascending: false }).range(offset, offset + 99)
      if (error) throw error
      return reply(200, { success: true, requests: data || [] })
    }
    const id = text(body.id, 36)
    if (!uuid.test(id)) return reply(400, { success: false, message: 'Solicitud inválida.' })
    if (body.action === 'complete') {
      const { data, error } = await admin.rpc('complete_ioma_prescription_request', { p_professional_id: professionalId, p_request_id: id })
      if (error) throw error
      return data ? reply(200, { success: true }) : reply(404, { success: false, message: 'No se encontró la solicitud.' })
    }
    return reply(400, { success: false, message: 'Acción inválida.' })
  } catch (error) {
    console.error('[ioma-prescriptions] Error de servicio', { name: error instanceof Error ? error.name : 'Error desconocido' })
    return reply(500, { success: false, message: 'No se pudo completar la operación. Intentá nuevamente.' })
  }
})
