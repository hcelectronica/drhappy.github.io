import type { SupabaseClient } from 'jsr:@supabase/supabase-js@2'

function object(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

type RegistrationEvent = {
  patientName: string
  patientEmail?: string
  patientPhone?: string
} & (
  | { source: 'invite' }
  | { source: 'booking'; date: string; time: string; location: string; status: 'confirmed' | 'pending_payment' | 'pending' }
)

function escapeHtml(value: string): string {
  return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;').replaceAll("'", '&#39;')
}

export function registrationEmail(event: RegistrationEvent, professionalName: string) {
  const origin = event.source === 'invite' ? 'Link de invitar paciente' : 'Link de turnera'
  const title = event.source === 'invite' ? 'Nuevo registro por invitación' : 'Nueva solicitud de turno por turnera'
  const lines = [
    `Hola ${professionalName || 'profesional'},`,
    '',
    event.source === 'invite'
      ? 'Un paciente completó sus datos mediante tu link de invitación.'
      : 'Un paciente se anotó mediante tu link de turnera.',
    '',
    `Origen: ${origin}`,
    `Paciente: ${event.patientName}`,
    ...(event.patientEmail ? [`Email de contacto: ${event.patientEmail}`] : []),
    ...(event.patientPhone ? [`Teléfono de contacto: ${event.patientPhone}`] : []),
  ]
  if (event.source === 'booking') {
    lines.push(
      `Fecha: ${event.date}`,
      `Hora: ${event.time} hs (Argentina)`,
      `Lugar: ${event.location}`,
      `Estado: ${event.status === 'confirmed' ? 'Turno confirmado' : event.status === 'pending_payment' ? 'Pendiente de pago. El turno todavía no está confirmado.' : 'Solicitud pendiente de atención por el profesional.'}`,
    )
  } else {
    lines.push('Este registro no reserva un turno. La ficha queda disponible para incorporarla a tu base de pacientes.')
  }
  lines.push('', 'Ingresá a Dr Happy para revisar tus pacientes y tu agenda.', 'https://www.drhappy.com.ar/')
  const text = lines.join('\n')
  return {
    subject: `Dr Happy - ${title}`,
    type: 'custom' as const,
    text,
    templateData: { message: escapeHtml(text).replaceAll('\n', '<br>') },
  }
}

export async function deliverRegistrationEmail(
  url: string,
  key: string,
  to: string,
  event: RegistrationEvent,
  professionalName: string,
  send: typeof fetch = fetch,
): Promise<void> {
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)) throw new Error('El profesional no tiene un email válido configurado.')
  const response = await send(`${url}/functions/v1/send-email`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}`, apikey: key },
    body: JSON.stringify({ to, ...registrationEmail(event, professionalName) }),
    signal: AbortSignal.timeout(10000),
  })
  const result: unknown = await response.json()
  if (!response.ok || !result || typeof result !== 'object' || !('success' in result) || result.success !== true) {
    throw new Error(`No se confirmó el envío del aviso al profesional (HTTP ${response.status}).`)
  }
}

export async function notifyProfessionalRegistration(params: {
  admin: SupabaseClient
  url: string
  key: string
  professionalId: string
  eventId: string
  event: RegistrationEvent
  send?: typeof fetch
}): Promise<boolean> {
  try {
    const [{ data: professional, error: professionalError }, { data: workspace, error: workspaceError }] = await Promise.all([
      params.admin.from('professionals').select('full_name, email').eq('id', params.professionalId).maybeSingle(),
      params.admin.from('user_workspaces').select('profile_json').eq('user_id', params.professionalId).maybeSingle(),
    ])
    if (professionalError || workspaceError || !professional) throw new Error('No se pudo consultar el destinatario profesional.')
    const account = object(professional)
    const profile = object(object(workspace).profile_json)
    const profileEmail = typeof profile.email === 'string' ? profile.email.trim() : ''
    const email = profileEmail || (typeof account.email === 'string' ? account.email.trim() : '')
    await deliverRegistrationEmail(params.url, params.key, email, params.event, typeof account.full_name === 'string' ? account.full_name : '', params.send)
    return true
  } catch (error) {
    console.error('[professional-registration-email] Aviso no enviado; el registro se conserva', {
      professionalId: params.professionalId, eventId: params.eventId, source: params.event.source,
      message: error instanceof Error ? error.message : String(error),
    })
    return false
  }
}
