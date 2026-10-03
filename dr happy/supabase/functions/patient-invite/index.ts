import { serve } from 'https://deno.land/std@0.224.0/http/server.ts'
import { createClient } from 'jsr:@supabase/supabase-js@2'
import { corsHeaders } from '../_shared/cors.ts'
import { resolveProfessionalId } from '../_shared/professionalSession.ts'
import { notifyProfessionalRegistration } from '../_shared/professionalRegistrationEmail.ts'

// Link de invitación para que los pacientes se registren solos en la base del profesional.
// Los registros quedan pendientes y la app del profesional los incorpora a su ficha.

type RequestBody = {
  action?: 'get-link' | 'regenerate-link' | 'get-invite' | 'submit' | 'pull' | 'ack'
  token?: string
  ids?: string[]
  nombre?: string
  apellido?: string
  dni?: string
  birthDate?: string
  obraSocial?: string
  numeroAfiliado?: string
  email?: string
  phone?: string
  consent?: boolean
  website?: string
}

const PER_PROFESSIONAL_HOURLY_LIMIT = 60
const PER_DNI_DAILY_LIMIT = 3

function jsonResponse(status: number, body: Record<string, unknown>): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
}

function plainText(value: unknown, maxLength: number): string {
  return String(value ?? '')
    .replace(/<[^>]*>/g, '')
    .replace(/[\u0000-\u001F\u007F]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maxLength)
}

function slugify(value: string): string {
  return value
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
}

function randomSuffix(length: number): string {
  const alphabet = 'abcdefghijkmnpqrstuvwxyz23456789'
  const bytes = crypto.getRandomValues(new Uint8Array(length))
  return Array.from(bytes, (byte) => alphabet[byte % alphabet.length]).join('')
}

function isValidBirthDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const date = new Date(`${value}T12:00:00Z`)
  if (Number.isNaN(date.getTime())) return false
  const year = date.getUTCFullYear()
  return year >= 1900 && date.getTime() <= Date.now()
}

serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (request.method !== 'POST') return jsonResponse(405, { success: false, message: 'Método no permitido.' })

  const supabaseUrl = Deno.env.get('SUPABASE_URL')
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  if (!supabaseUrl || !serviceRoleKey) return jsonResponse(500, { success: false, message: 'Falta configuración del servidor.' })
  const admin = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false } })

  let body: RequestBody
  try {
    body = await request.json()
  } catch {
    return jsonResponse(400, { success: false, message: 'Cuerpo JSON inválido.' })
  }

  // ── Acciones públicas (paciente) ───────────────────────────────────────────
  if (body.action === 'get-invite' || body.action === 'submit') {
    const token = plainText(body.token, 80).toLowerCase()
    if (!/^[a-z0-9-]{6,80}$/.test(token)) return jsonResponse(404, { success: false, message: 'Este link de invitación no es válido.' })
    const { data: link } = await admin.from('patient_invite_links').select('professional_id').eq('token', token).maybeSingle()
    if (!link) return jsonResponse(404, { success: false, message: 'Este link de invitación ya no está disponible. Pedile uno nuevo a tu profesional.' })

    if (body.action === 'get-invite') {
      const [{ data: professional }, { data: workspace }] = await Promise.all([
        admin.from('professionals').select('full_name, specialty, active').eq('id', link.professional_id).maybeSingle(),
        admin.from('user_workspaces').select('profile_json').eq('user_id', link.professional_id).maybeSingle(),
      ])
      if (!professional || professional.active === false) {
        return jsonResponse(404, { success: false, message: 'Este link de invitación ya no está disponible.' })
      }
      const profile = (workspace?.profile_json ?? {}) as Record<string, unknown>
      return jsonResponse(200, {
        success: true,
        invite: {
          professionalName: professional.full_name ?? '',
          specialty: professional.specialty ?? '',
          letterhead: typeof profile.certificateLetterhead === 'string' ? profile.certificateLetterhead : '',
        },
      })
    }

    // Campo trampa: si viene completo es un bot; respondemos OK sin guardar.
    if (typeof body.website === 'string' && body.website.trim()) return jsonResponse(200, { success: true })

    const nombre = plainText(body.nombre, 80)
    const apellido = plainText(body.apellido, 80)
    const dni = String(body.dni ?? '').replace(/\D/g, '')
    const birthDate = plainText(body.birthDate, 10)
    const obraSocial = plainText(body.obraSocial, 80)
    const numeroAfiliado = plainText(body.numeroAfiliado, 40)
    const email = plainText(body.email, 160).toLowerCase()
    const phone = String(body.phone ?? '').replace(/[^\d+]/g, '').slice(0, 30)

    if (!nombre || !apellido) return jsonResponse(400, { success: false, message: 'Completá tu nombre y apellido.' })
    if (!/^\d{6,9}$/.test(dni)) return jsonResponse(400, { success: false, message: 'Ingresá un DNI válido (solo números).' })
    if (!isValidBirthDate(birthDate)) return jsonResponse(400, { success: false, message: 'Ingresá una fecha de nacimiento válida.' })
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return jsonResponse(400, { success: false, message: 'El email no tiene un formato válido.' })
    if (phone.replace(/\D/g, '').length < 8) return jsonResponse(400, { success: false, message: 'Ingresá un teléfono de contacto válido.' })
    if (body.consent !== true) return jsonResponse(400, { success: false, message: 'Necesitamos tu consentimiento para registrar tus datos.' })

    const now = Date.now()
    const { count: hourlyCount } = await admin
      .from('patient_invite_submissions')
      .select('id', { count: 'exact', head: true })
      .eq('professional_id', link.professional_id)
      .gte('created_at', new Date(now - 60 * 60 * 1000).toISOString())
    if ((hourlyCount ?? 0) >= PER_PROFESSIONAL_HOURLY_LIMIT) {
      return jsonResponse(429, { success: false, message: 'Hay muchos registros en este momento. Probá de nuevo en unos minutos.' })
    }
    const { count: dniCount } = await admin
      .from('patient_invite_submissions')
      .select('id', { count: 'exact', head: true })
      .eq('professional_id', link.professional_id)
      .eq('dni', dni)
      .gte('created_at', new Date(now - 24 * 60 * 60 * 1000).toISOString())
    if ((dniCount ?? 0) >= PER_DNI_DAILY_LIMIT) {
      return jsonResponse(200, { success: true })
    }

    const submissionId = crypto.randomUUID()
    const { error } = await admin.from('patient_invite_submissions').insert({
      id: submissionId,
      professional_id: link.professional_id,
      nombre,
      apellido,
      dni,
      birth_date: birthDate,
      obra_social: obraSocial || null,
      numero_afiliado: numeroAfiliado || null,
      email: email || null,
      phone: phone || null,
    })
    if (error) return jsonResponse(500, { success: false, message: 'No pudimos registrar tus datos. Probá de nuevo.' })
    const professionalEmailSent = await notifyProfessionalRegistration({
      admin, url: supabaseUrl, key: serviceRoleKey, professionalId: link.professional_id, eventId: submissionId,
      event: { source: 'invite', patientName: `${apellido}, ${nombre}`, patientEmail: email, patientPhone: phone },
    })
    return jsonResponse(200, { success: true, professionalEmailSent })
  }

  // ── Acciones del profesional ───────────────────────────────────────────────
  const professionalId = await resolveProfessionalId(request, admin)
  if (!professionalId) return jsonResponse(401, { success: false, message: 'Sesión profesional requerida.' })

  if (body.action === 'get-link' || body.action === 'regenerate-link') {
    if (body.action === 'get-link') {
      const { data: existing } = await admin.from('patient_invite_links').select('token').eq('professional_id', professionalId).maybeSingle()
      if (existing?.token) return jsonResponse(200, { success: true, token: existing.token })
    }
    const { data: professional } = await admin.from('professionals').select('full_name').eq('id', professionalId).maybeSingle()
    const base = slugify(String(professional?.full_name ?? '')) || 'profesional'
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const token = `${base}-${randomSuffix(5)}`
      const { error } = await admin
        .from('patient_invite_links')
        .upsert({ professional_id: professionalId, token, created_at: new Date().toISOString() }, { onConflict: 'professional_id' })
      if (!error) return jsonResponse(200, { success: true, token })
    }
    return jsonResponse(500, { success: false, message: 'No se pudo generar el link de invitación.' })
  }

  if (body.action === 'pull') {
    const { data, error } = await admin
      .from('patient_invite_submissions')
      .select('id, nombre, apellido, dni, birth_date, obra_social, numero_afiliado, email, phone, created_at')
      .eq('professional_id', professionalId)
      .is('imported_at', null)
      .order('created_at', { ascending: true })
      .limit(200)
    if (error) return jsonResponse(500, { success: false, message: error.message })
    return jsonResponse(200, { success: true, submissions: data ?? [] })
  }

  if (body.action === 'ack') {
    const ids = Array.isArray(body.ids) ? body.ids.filter((id) => typeof id === 'string' && /^[0-9a-f-]{36}$/i.test(id)).slice(0, 200) : []
    if (!ids.length) return jsonResponse(200, { success: true })
    const { error } = await admin
      .from('patient_invite_submissions')
      .update({ imported_at: new Date().toISOString() })
      .eq('professional_id', professionalId)
      .in('id', ids)
    if (error) return jsonResponse(500, { success: false, message: error.message })
    return jsonResponse(200, { success: true })
  }

  return jsonResponse(400, { success: false, message: 'Acción no reconocida.' })
})
