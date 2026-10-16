export type CommunicationAudience = 'own' | 'folder'
export type CommunicationTemplate = 'folder' | 'virtual'
export interface CommunicationContact { id: string; email: string; name: string; eligible: boolean; reason: string }
export const COMMUNICATION_TEMPLATES = {
  folder: {
    title: 'Mi Carpeta de Salud',
    subject: 'Tu salud, organizada: conocé Mi Carpeta de Salud',
    message: 'Te invito a crear tu cuenta gratuita en Mi Carpeta de Salud. Podés guardar estudios, registrar presión y glucosa, y elegir qué compartir con tu médico. Tus datos quedan bajo tu control.',
    button: 'Crear o abrir mi Carpeta de Salud',
  },
  virtual: {
    title: 'Orientación virtual asincrónica',
    subject: 'Conocé la orientación virtual asincrónica',
    message: 'Podés enviar tu consulta y documentación para recibir una orientación del profesional sin coordinar una videollamada. Es un servicio pago y no obligatorio. No es atención de urgencias ni reemplaza una consulta presencial cuando sea necesaria.',
    button: 'Conocer la orientación virtual',
  },
} as const
export const normalizeContactEmail = (value: unknown) => typeof value === 'string' ? value.trim().toLowerCase() : ''
export const validContactEmail = (email: string) => email.length <= 254 && /^[^\s<>@,;]+@[^\s<>@,;]+\.[^\s<>@,;]+$/.test(email)
export function uniqueContacts(contacts: CommunicationContact[]): CommunicationContact[] {
  const seen = new Set<string>()
  return contacts.filter(row => {
    const email = normalizeContactEmail(row.email)
    if (!validContactEmail(email) || seen.has(email)) return false
    seen.add(email)
    return true
  }).map(row => ({ ...row, email: normalizeContactEmail(row.email) }))
}
export function escapeEmailHtml(value: string): string {
  return value.replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]!)
}
export function communicationHtml(input: { name: string; sender: string; subject: string; message: string; template: CommunicationTemplate; link: string; unsubscribe: string }) {
  const e = escapeEmailHtml
  return `<!doctype html><html lang="es"><meta charset="utf-8"><body style="font-family:Arial,sans-serif;background:#f0f7f5;color:#173b42;padding:24px"><main style="max-width:600px;margin:auto;background:white;padding:28px;border-radius:16px">
    <p>Dr Happy · ${e(COMMUNICATION_TEMPLATES[input.template].title)}</p><h1>${e(input.subject)}</h1>
    <p>Hola ${e(input.name || '')},</p><p style="white-space:pre-line;line-height:1.6">${e(input.message)}</p>
    <p><a style="display:inline-block;padding:14px 20px;background:#0f766e;color:white;border-radius:10px;text-decoration:none" href="${e(input.link)}">${e(COMMUNICATION_TEMPLATES[input.template].button)}</a></p>
    ${input.template === 'virtual' ? '<p>Servicio pago, no obligatorio y sin atención de urgencias. Consultá condiciones y valor antes de solicitarlo.</p>' : '<p>Registrarte no comparte automáticamente tus datos de salud con ningún profesional.</p>'}
    <p>Enviado por ${e(input.sender)} desde Dr Happy.</p><hr><p style="font-size:13px">Recibís este correo por tu vínculo con el consultorio o por tu registro en Mi Carpeta de Salud.
    <a href="${e(input.unsubscribe)}">Dejar de recibir estas novedades</a>. La baja no afecta tu atención ni tu cuenta.</p></main></body></html>`
}
