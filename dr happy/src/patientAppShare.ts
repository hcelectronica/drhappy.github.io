export const PATIENT_APP_URL = 'https://www.drhappy.com.ar/paciente'

export const PATIENT_APP_SHARE_TEXT = [
  '¡Te comparto Mi Carpeta de Salud de Dr Happy! Es gratis.',
  'Podés guardar tus estudios, llevar un registro de tu presión y disfrutar del taller de memoria.',
  'Entrá acá para crear tu propia carpeta:',
  PATIENT_APP_URL,
].join('\n\n')

export const PATIENT_APP_WHATSAPP_URL = `https://wa.me/?text=${encodeURIComponent(PATIENT_APP_SHARE_TEXT)}`

export function patientAppWhatsAppUrl(shareUrl: string): string {
  return `https://wa.me/?text=${encodeURIComponent(PATIENT_APP_SHARE_TEXT.replace(PATIENT_APP_URL, shareUrl))}`
}
