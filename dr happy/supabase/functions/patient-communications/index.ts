import { serve } from 'https://deno.land/std@0.224.0/http/server.ts'
import { createClient } from 'jsr:@supabase/supabase-js@2'
import { corsHeaders } from '../_shared/cors.ts'
import { resolveProfessionalId } from '../_shared/professionalSession.ts'
import { communicationHtml, normalizeContactEmail, uniqueContacts } from '../_shared/patientCommunications.ts'
import type { CommunicationAudience, CommunicationContact, CommunicationTemplate } from '../_shared/patientCommunications.ts'

const uuid = (value: unknown): value is string => typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)
function reply(status: number, body: Record<string, unknown>) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } })
}
serve(async request => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  try {
    const url = Deno.env.get('SUPABASE_URL'), key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
    if (!url || !key) throw new Error('Missing server configuration')
    const admin = createClient(url, key, { auth: { persistSession: false } })
    if (request.method !== 'POST') return reply(405, { success: false, message: 'Método no permitido.' })
    let body: Record<string, unknown>
    try { body = await request.json() } catch { return reply(400, { success: false, message: 'Solicitud inválida.' }) }
    if (!body || typeof body !== 'object' || Array.isArray(body)) return reply(400, { success: false, message: 'Solicitud inválida.' })
    if (body.action === 'unsubscribe') {
      if (!uuid(body.token)) return reply(400, { success: false, message: 'El enlace de baja no es válido.' })
      const { data, error } = await admin.from('patient_email_preferences').update({ opted_out: true, opted_in: false, updated_at: new Date().toISOString() }).eq('token', body.token).select('email')
      if (error) throw error
      return data?.length ? reply(200, { success: true }) : reply(404, { success: false, message: 'El enlace de baja no es válido.' })
    }
    const professionalId = await resolveProfessionalId(request, admin)
    if (!professionalId) return reply(401, { success: false, message: 'Iniciá sesión como administrador.' })
    const { data: professional, error: professionalError } = await admin.from('professionals').select('id, is_admin, active, full_name').eq('id', professionalId).maybeSingle()
    const { data: allowed, error: allowedError } = await admin.from('patient_communication_admins').select('professional_id').eq('professional_id', professionalId).maybeSingle()
    if (professionalError || allowedError) throw professionalError || allowedError
    if (!allowed || !professional?.is_admin || professional.active === false) return reply(403, { success: false, message: 'Esta herramienta está habilitada solo para la cuenta administradora autorizada.' })
    async function allPreferences() {
      const rows: Array<{ email: string; opted_in: boolean; opted_out: boolean }> = []
      for (let offset = 0; ; offset += 1000) {
        const { data, error } = await admin.from('patient_email_preferences').select('email,opted_in,opted_out').order('email').range(offset, offset + 999)
        if (error) throw error
        rows.push(...(data ?? []))
        if ((data?.length ?? 0) < 1000) return new Map(rows.map(row => [row.email, row]))
      }
    }
    async function audienceContacts(audience: CommunicationAudience) {
      const preferences = await allPreferences()
      let contacts: CommunicationContact[] = []
      if (audience === 'own') {
        const { data, error } = await admin.from('user_workspaces').select('patients_json').eq('user_id', professionalId).maybeSingle()
        if (error) throw error
        contacts = (Array.isArray(data?.patients_json) ? data.patients_json : [])
          .filter((row: Record<string, unknown>) => row && typeof row === 'object' && (!row.ownerUserId || row.ownerUserId === professionalId))
          .map((row: Record<string, unknown>) => ({ id: String(row.id), email: normalizeContactEmail(row.email),
            name: `${String(row.nombre || '')} ${String(row.apellido || '')}`.trim(), eligible: true, reason: '' }))
      } else {
        for (let offset = 0; ; offset += 1000) {
          const { data, error } = await admin.from('patient_accounts').select('id,email,full_name').eq('active', true).not('email_verified_at', 'is', null).order('id').range(offset, offset + 999)
          if (error) throw error
          contacts.push(...(data ?? []).map(row => ({ id: row.id, email: normalizeContactEmail(row.email), name: row.full_name, eligible: true, reason: '' })))
          if ((data?.length ?? 0) < 1000) break
        }
      }
      return uniqueContacts(contacts).map(row => {
        const preference = preferences.get(row.email)
        const reason = preference?.opted_out ? 'Solicitó la baja' : audience === 'folder' && !preference?.opted_in ? 'No aceptó novedades' : ''
        return { ...row, eligible: !reason, reason }
      })
    }
    async function campaignResult(id: string) {
      const { data: campaign, error } = await admin.from('patient_email_campaigns').select('*').eq('id', id).eq('professional_id', professionalId).maybeSingle()
      if (error) throw error
      if (!campaign) return null
      const counts: Record<string, number> = {}
      for (const status of ['pending', 'sending', 'sent', 'failed', 'uncertain', 'skipped']) {
        const { count, error } = await admin.from('patient_email_recipients').select('id', { count: 'exact', head: true }).eq('campaign_id', id).eq('status', status)
        if (error) throw error
        counts[status] = count ?? 0
      }
      return { ...campaign, counts, total: Object.values(counts).reduce((sum, n) => sum + n, 0) }
    }
    if (body.action === 'contacts') {
      if (body.audience !== 'own' && body.audience !== 'folder') return reply(400, { success: false, message: 'Elegí la audiencia.' })
      const contacts = await audienceContacts(body.audience)
      const { data: settings, error } = await admin.from('virtual_consult_settings').select('slug,enabled').eq('professional_id', professionalId).maybeSingle()
      if (error) throw error
      return reply(200, { success: true, contacts, virtualReady: settings?.enabled === true })
    }
    if (body.action === 'history') {
      const { data, error } = await admin.from('patient_email_campaigns').select('id').eq('professional_id', professionalId).order('created_at', { ascending: false }).limit(20)
      if (error) throw error
      return reply(200, { success: true, campaigns: await Promise.all((data ?? []).map(row => campaignResult(row.id))) })
    }
    if (body.action === 'preview') {
      if ((body.audience !== 'own' && body.audience !== 'folder') || (body.template !== 'folder' && body.template !== 'virtual') || !uuid(body.campaignId)) return reply(400, { success: false, message: 'Revisá la audiencia y herramienta.' })
      if (body.permissionConfirmed !== true) return reply(400, { success: false, message: 'Confirmá que tenés permiso para enviar estas invitaciones.' })
      const audience = body.audience, template = body.template
      const subject = typeof body.subject === 'string' ? body.subject.trim() : ''
      const message = typeof body.message === 'string' ? body.message.trim() : ''
      if (!subject || subject.length > 150 || /[\r\n]/.test(subject) || !message || message.length > 3000) return reply(400, { success: false, message: 'Completá asunto (hasta 150 caracteres) y mensaje (hasta 3000).' })
      const contacts = await audienceContacts(audience)
      if (body.all !== true && (!Array.isArray(body.contactIds) || body.contactIds.some(id => typeof id !== 'string'))) return reply(400, { success: false, message: 'Seleccioná destinatarios.' })
      const ids = new Set(Array.isArray(body.contactIds) ? body.contactIds : [])
      const recipients = contacts.filter(row => row.eligible && (body.all === true || ids.has(row.id))).map(row => ({ email: row.email, name: row.name }))
      if (!recipients.length) return reply(400, { success: false, message: 'No hay destinatarios habilitados en esta selección.' })
      let link = 'https://www.drhappy.com.ar/paciente'
      if (template === 'virtual') {
        const { data: settings, error } = await admin.from('virtual_consult_settings').select('slug,enabled').eq('professional_id', professionalId).maybeSingle()
        if (error) throw error
        if (!settings?.enabled || !/^[a-z0-9-]{6,80}$/.test(settings.slug)) return reply(400, { success: false, message: 'Primero activá tu orientación virtual desde Consultas virtuales.' })
        link = `https://www.drhappy.com.ar/consulta/${settings.slug}`
      }
      const { error } = await admin.rpc('create_patient_email_campaign', {
        p_id: body.campaignId, p_professional: professionalId, p_audience: audience, p_template: template,
        p_subject: subject, p_message: message, p_link: link, p_recipients: recipients,
      })
      if (error) throw error
      return reply(200, { success: true, campaign: await campaignResult(body.campaignId) })
    }
    if (body.action === 'status' || body.action === 'send-batch') {
      if (!uuid(body.campaignId)) return reply(400, { success: false, message: 'Envío inválido.' })
      const campaign = await campaignResult(body.campaignId)
      if (!campaign) return reply(404, { success: false, message: 'No encontramos ese envío.' })
      if (body.action === 'status') return reply(200, { success: true, campaign })
      if (body.confirm !== true) return reply(400, { success: false, message: 'Confirmá el envío desde la vista previa.' })
      if (campaign.template === 'virtual') {
        const { data: settings, error } = await admin.from('virtual_consult_settings').select('slug,enabled').eq('professional_id', professionalId).maybeSingle()
        if (error) throw error
        if (!settings?.enabled || campaign.link !== `https://www.drhappy.com.ar/consulta/${settings.slug}`) return reply(409, { success: false, message: 'La orientación virtual cambió o está desactivada. Prepará un nuevo envío con su enlace actual.' })
      }
      const { error: activateError } = await admin.from('patient_email_campaigns').update({ status: 'active' }).eq('id', campaign.id).eq('professional_id', professionalId)
      if (activateError) throw activateError
      const { data: claimed, error: claimError } = await admin.rpc('claim_patient_email_batch', { p_id: campaign.id, p_professional: professionalId })
      if (claimError) throw claimError
      for (const row of claimed ?? []) {
        // A claimed recipient is never automatically retried: SMTP may accept mail before a timeout.
        let status = 'uncertain'
        try {
          const { error: prefInsertError } = await admin.from('patient_email_preferences').upsert({ email: row.email }, { onConflict: 'email', ignoreDuplicates: true })
          if (prefInsertError) throw prefInsertError
          const { data: preference, error: prefError } = await admin.from('patient_email_preferences').select('token,opted_in,opted_out').eq('email', row.email).single()
          if (prefError) throw prefError
          let activeAccount = true
          if (campaign.audience === 'folder') {
            const { data: account, error } = await admin.from('patient_accounts').select('id').eq('email', row.email).eq('active', true).not('email_verified_at', 'is', null).maybeSingle()
            if (error) throw error
            activeAccount = !!account
          }
          if (preference.opted_out || (campaign.audience === 'folder' && (!preference.opted_in || !activeAccount))) status = 'skipped'
          else {
            const unsubscribe = `https://www.drhappy.com.ar/paciente?unsubscribe=${preference.token}`
            const html = communicationHtml({ name: row.name, sender: professional.full_name || 'Dr Happy', subject: campaign.subject,
              message: campaign.message, template: campaign.template as CommunicationTemplate, link: campaign.link, unsubscribe })
            const response = await fetch(`${url}/functions/v1/send-email`, {
              method: 'POST', headers: { Authorization: `Bearer ${key}`, apikey: key, 'Content-Type': 'application/json' },
              body: JSON.stringify({ to: row.email, subject: campaign.subject, type: 'custom', html,
                text: `${campaign.message}\n\n${campaign.link}\n\nDejar de recibir novedades: ${unsubscribe}` }),
              signal: AbortSignal.timeout(20000),
            })
            const result = await response.json()
            status = response.ok && result.success === true ? 'sent' : 'failed'
          }
        } catch (error) {
          console.error('patient-communications: recipient result unconfirmed', { campaignId: campaign.id, recipientId: row.id, error: error instanceof Error ? error.name : 'Unknown' })
        }
        const { error } = await admin.from('patient_email_recipients').update({ status, completed_at: new Date().toISOString() }).eq('id', row.id).eq('status', 'sending')
        if (error) throw error
      }
      return reply(200, { success: true, campaign: await campaignResult(campaign.id) })
    }
    return reply(400, { success: false, message: 'Acción no válida.' })
  } catch (error) {
    console.error('patient-communications:', error instanceof Error ? error.message : error)
    return reply(500, { success: false, message: 'No se pudo completar la acción. Consultá el estado antes de volver a enviar; no se reintentan destinatarios ya procesados.' })
  }
})
