import { isSupabaseConfigured, supabase } from './supabaseClient'

export const receptionTools = [
  { key: 'documents', title: 'Certificados y recetas', description: 'Solicitalos para evaluación profesional.', icon: 'document', destination: 'Tu enlace de certificados y recetas.' },
  { key: 'studies', title: 'Evaluación de estudios', description: 'No esperes un turno para consultar por tu laboratorio.', icon: 'studies', destination: 'Orientación virtual asistida por IA y revisada por vos.' },
  { key: 'booking', title: 'Turno presencial', description: 'Elegí día y horario en el consultorio.', icon: 'calendar', destination: 'Tu turnera paga, no la gratuita.' },
  { key: 'video', title: 'Videoconsulta', description: 'Reservá y pagá tu turno. Tu profesional te enviará el enlace.', icon: 'video', destination: 'Tu turnera paga. Origen virtual identificado en agenda y correos.' },
  { key: 'registration', title: 'Registrarse como paciente', description: 'Completá tus datos para el consultorio.', icon: 'user', destination: 'Tu enlace de registro, no Mi Carpeta de Salud.' },
] as const
export type ReceptionTool = typeof receptionTools[number]['key']
export type ReceptionSettings = Record<ReceptionTool, boolean> & { slug: string; display_name: string; enabled: boolean }
export interface ReceptionResponse {
  success: boolean
  message?: string
  settings?: ReceptionSettings
  available?: Record<ReceptionTool, boolean>
  reception?: { displayName: string; links: Partial<Record<ReceptionTool, string>> }
}
export const receptionUrl = (slug: string) => `https://www.drhappy.com.ar/r/${encodeURIComponent(slug)}`
export async function callReception(body: Record<string, unknown>): Promise<ReceptionResponse> {
  if (!isSupabaseConfigured || !supabase) return { success: false, message: 'Supabase no está conectado.' }
  const token = sessionStorage.getItem('drhappy-professional-session')
  const { data, error } = await supabase.functions.invoke('patient-reception', {
    body, headers: token && body.action !== 'public' ? { 'x-drhappy-session': token } : undefined,
  })
  if (error) {
    if (error.context instanceof Response) {
      const response = await error.context.json().catch(() => null)
      if (response?.message) return { success: false, message: response.message }
    }
    return { success: false, message: error.message || 'No se pudo contactar con la recepción.' }
  }
  return data ?? { success: false, message: 'El servidor devolvió una respuesta vacía.' }
}
