import { serve } from 'https://deno.land/std@0.224.0/http/server.ts'
import { createClient } from 'jsr:@supabase/supabase-js@2'
import { corsHeaders } from '../_shared/cors.ts'
import { resolveProfessionalId } from '../_shared/professionalSession.ts'

const tools = ['documents', 'studies', 'booking', 'registration', 'video'] as const
const slugPattern = /^[a-z0-9](?:[a-z0-9-]{0,22}[a-z0-9])?$/
function reply(status: number, body: Record<string, unknown>) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } })
}
serve(async request => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (request.method !== 'POST') return reply(405, { success: false, message: 'Método no permitido.' })
  try {
    let body: Record<string, unknown>
    try { body = await request.json() } catch { return reply(400, { success: false, message: 'Solicitud inválida.' }) }
    if (!body || typeof body !== 'object' || Array.isArray(body)) return reply(400, { success: false, message: 'Solicitud inválida.' })
    const url = Deno.env.get('SUPABASE_URL'), key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
    if (!url || !key) throw new Error('Missing server configuration')
    const admin = createClient(url, key, { auth: { persistSession: false } })
    const isPublic = body.action === 'public'
    let professionalId: string
    let settings: Record<string, unknown> | null = null
    if (isPublic) {
      if (typeof body.slug !== 'string' || !slugPattern.test(body.slug)) return reply(404, { success: false, message: 'Esta recepción no está disponible.' })
      const result = await admin.from('patient_receptions').select('*').eq('slug', body.slug).eq('enabled', true).maybeSingle()
      if (result.error) throw result.error
      if (!result.data) return reply(404, { success: false, message: 'Esta recepción no está disponible.' })
      settings = result.data
      professionalId = result.data.professional_id
    } else {
      const id = await resolveProfessionalId(request, admin)
      if (!id) return reply(401, { success: false, message: 'Iniciá sesión para configurar tu recepción.' })
      professionalId = id
    }
    const professional = await admin.from('professionals').select('full_name,active').eq('id', professionalId).maybeSingle()
    if (professional.error) throw professional.error
    if (!professional.data || professional.data.active === false) return reply(404, { success: false, message: 'Esta recepción no está disponible.' })
    const [booking, virtual, documents, invite, payment] = await Promise.all([
      admin.from('public_booking_profiles').select('slug,enabled,availability_blocks').eq('professional_id', professionalId).maybeSingle(),
      admin.from('virtual_consult_settings').select('slug,enabled').eq('professional_id', professionalId).maybeSingle(),
      admin.from('paid_clinical_document_settings').select('slug,certificate_enabled').eq('professional_id', professionalId).maybeSingle(),
      admin.from('patient_invite_links').select('token').eq('professional_id', professionalId).maybeSingle(),
      admin.from('professional_payment_accounts').select('status').eq('professional_id', professionalId).eq('provider', 'mercadopago').maybeSingle(),
    ])
    for (const result of [booking, virtual, documents, invite, payment]) if (result.error) throw result.error
    const base = 'https://www.drhappy.com.ar'
    const paidBooking = booking.data?.enabled && payment.data?.status === 'connected'
      && Array.isArray(booking.data.availability_blocks) && booking.data.availability_blocks.some(
        (block: Record<string, unknown>) => block.modality === 'private' && Number(block.amountToCharge) > 0,
      )
    const destinations: Record<string, string | null> = {
      documents: documents.data?.certificate_enabled ? `${base}/documentos/${encodeURIComponent(documents.data.slug)}` : null,
      studies: virtual.data?.enabled && payment.data?.status === 'connected' ? `${base}/consulta/${encodeURIComponent(virtual.data.slug)}` : null,
      booking: paidBooking ? `${base}/turnera/${encodeURIComponent(booking.data!.slug)}?m=private` : null,
      registration: invite.data ? `${base}/registro/${encodeURIComponent(invite.data.token)}` : null,
      video: paidBooking ? `${base}/turnera/${encodeURIComponent(booking.data!.slug)}?m=private&consultation=video` : null,
    }
    if (isPublic) {
      return reply(200, { success: true, reception: {
        displayName: settings!.display_name,
        links: Object.fromEntries(tools.filter(tool => settings![tool] === true && destinations[tool]).map(tool => [tool, destinations[tool]])),
      } })
    }
    if (body.action === 'get-settings') {
      const result = await admin.from('patient_receptions').select('*').eq('professional_id', professionalId).maybeSingle()
      if (result.error) throw result.error
      return reply(200, { success: true, settings: result.data ?? {
        slug: '', display_name: professional.data.full_name || 'Mi consultorio', enabled: false,
        ...Object.fromEntries(tools.map(tool => [tool, !!destinations[tool]])),
      }, available: Object.fromEntries(tools.map(tool => [tool, !!destinations[tool]])) })
    }
    if (body.action !== 'save-settings') return reply(400, { success: false, message: 'Acción inválida.' })
    const input = body.settings
    if (!input || typeof input !== 'object' || Array.isArray(input)) return reply(400, { success: false, message: 'Revisá la configuración.' })
    const value = input as Record<string, unknown>
    if (typeof value.slug !== 'string' || !slugPattern.test(value.slug) || typeof value.display_name !== 'string'
      || !value.display_name.trim() || value.display_name.trim().length > 80
      || ['enabled', ...tools].some(field => typeof value[field] !== 'boolean')) {
      return reply(400, { success: false, message: 'Completá el nombre y un enlace de hasta 24 letras minúsculas, números o guiones, con todas las opciones revisadas.' })
    }
    if (value.enabled && !tools.some(tool => value[tool] && destinations[tool])) return reply(400, { success: false, message: 'Activá al menos una herramienta disponible.' })
    for (const tool of tools) if (value[tool] && !destinations[tool]) return reply(409, { success: false, message: 'Una herramienta elegida no está habilitada. Revisá sus ajustes y volvé a abrir Mi recepción.' })
    const result = await admin.from('patient_receptions').upsert({
      professional_id: professionalId, slug: value.slug, display_name: value.display_name.trim(), enabled: value.enabled,
      ...Object.fromEntries(tools.map(tool => [tool, value[tool]])), updated_at: new Date().toISOString(),
    }, { onConflict: 'professional_id' }).select('*').single()
    if (result.error?.code === '23505') return reply(409, { success: false, message: 'Ese enlace ya está en uso. Elegí otro nombre corto.' })
    if (result.error) throw result.error
    return reply(200, { success: true, settings: result.data })
  } catch (error) {
    console.error('patient-reception: request failed', error instanceof Error ? error.message : error)
    return reply(500, { success: false, message: 'No se pudo cargar o guardar la recepción. Intentá nuevamente.' })
  }
})
