import { isSupabaseConfigured, supabase } from './supabaseClient'

export const receptionTools = [
  { key: 'documents', title: 'Documentos médicos', description: 'Certificados, aptos físicos y recetas.', icon: 'document', destination: 'Cada documento habilitado tiene su enlace y arancel propios.' },
  { key: 'studies', title: 'Chequea tus estudios con IA, Ahora', description: 'Orientación virtual asistida por IA y revisada por tu profesional.', icon: 'studies', destination: 'Orientación virtual asistida por IA y revisada por vos.' },
  { key: 'booking', title: 'Turneras', description: 'Elegí la atención que necesitás.', icon: 'calendar', destination: 'Todas tus turneras habilitadas, cada una con su nombre, enlace e importe.' },
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
  reception?: { displayName: string; links: Partial<Record<ReceptionTool, string>>; turneras?: Array<{ id: string; label: string; url: string; location: string; amountToCharge: number | null }>; documents?: Array<{ type: string; label: string; url: string; amount: number }> }
}
export function buildReceptionChoices(reception: NonNullable<ReceptionResponse['reception']>) {
  const tools = receptionTools.flatMap(tool => {
    const url = reception.links[tool.key]
    if (!url || (tool.key === 'booking' && reception.turneras !== undefined) || (tool.key === 'documents' && reception.documents !== undefined)) return []
    return [{ key: tool.key, kind: tool.key, title: tool.title, description: tool.description, icon: tool.icon, url }]
  })
  const turneras = (reception.turneras ?? []).map(turnera => ({
    key: `turnera-${turnera.id}`, kind: 'booking', icon: 'calendar', url: turnera.url,
    title: /^\s*turnos?\b/i.test(turnera.label) ? turnera.label : `Turno ${turnera.label}`,
    description: [turnera.location, turnera.amountToCharge ? '' : 'Sin pago online'].filter(Boolean).join(' · '),
  }))
  const isIoma = (label: string) => /\bioma\b/i.test(label.replace(/\./g, ''))
  return [
    ...tools.filter(tool => tool.kind === 'registration'),
    ...turneras.filter(turnera => isIoma(turnera.title)),
    ...tools.filter(tool => tool.kind === 'studies'),
    ...(reception.documents ?? []).map(document => ({ key: `document-${document.type}`, kind: 'documents', title: document.label, description: 'Evaluación profesional', icon: 'document', url: document.url })),
    ...tools.filter(tool => tool.kind !== 'registration' && tool.kind !== 'studies'),
    ...turneras.filter(turnera => !isIoma(turnera.title)),
  ]
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
