export interface NewProfessionalNotice {
  id: string
  username: string
  full_name: string
  email: string
  specialty?: string | null
  license_number?: string | null
}

export const ADMIN_REGISTRATION_RECIPIENT = 'alan.moodie@hotmail.com'

export function adminRegistrationEmail(professional: NewProfessionalNotice, source: 'form' | 'google' | 'email-verification') {
  const text = [
    'Se registró un nuevo profesional en Dr Happy.',
    '',
    `Nombre: ${professional.full_name}`,
    `Email: ${professional.email}`,
    `Usuario: ${professional.username}`,
    `Especialidad: ${professional.specialty || 'Todavía no informada'}`,
    `Matrícula: ${professional.license_number || 'Todavía no informada'}`,
    `ID de cuenta: ${professional.id}`,
    `Origen: ${source === 'google' ? 'Google (cuenta nueva)' : source === 'email-verification' ? 'Formulario con verificación de email pendiente' : 'Formulario de registro'}`,
    '',
    'El alta no acredita la habilitación profesional. Ingresá con tu cuenta administradora para revisar al nuevo usuario.',
    'https://www.drhappy.com.ar/',
  ].join('\n')
  const escaped = text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;').replaceAll("'", '&#39;')
  return {
    to: ADMIN_REGISTRATION_RECIPIENT,
    subject: 'Dr Happy - Nuevo profesional registrado',
    type: 'custom',
    text,
    templateData: { message: escaped.replaceAll('\n', '<br>') },
  }
}

export async function notifyAdminRegistration(
  url: string,
  key: string,
  professional: NewProfessionalNotice,
  source: 'form' | 'google' | 'email-verification',
  send: typeof fetch = fetch,
): Promise<boolean> {
  try {
    const response = await send(`${url}/functions/v1/send-email`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}`, apikey: key },
      body: JSON.stringify(adminRegistrationEmail(professional, source)),
      signal: AbortSignal.timeout(10000),
    })
    const result: unknown = await response.json()
    if (!response.ok || !result || typeof result !== 'object' || !('success' in result) || result.success !== true) {
      throw new Error(`No se confirmó el envío del aviso administrativo (HTTP ${response.status}).`)
    }
    return true
  } catch (error) {
    console.error('[admin-registration-email] Aviso no enviado; el alta se conserva', {
      professionalId: professional.id, source,
      message: error instanceof Error ? error.message : String(error),
    })
    return false
  }
}
