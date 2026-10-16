import { supabase } from './supabaseClient'
import type { CommunicationContact } from '../supabase/functions/_shared/patientCommunications'
export interface PatientCampaign {
  id: string
  audience: 'own' | 'folder'
  template: 'folder' | 'virtual'
  subject: string
  message: string
  link: string
  status: 'draft' | 'active'
  created_at: string
  counts: Record<'pending' | 'sending' | 'sent' | 'failed' | 'uncertain' | 'skipped', number>
  total: number
}
interface Result {
  success: boolean
  message?: string
  contacts?: CommunicationContact[]
  virtualReady?: boolean
  campaign?: PatientCampaign
  campaigns?: PatientCampaign[]
}
export async function callPatientCommunications(body: Record<string, unknown>): Promise<Result> {
  if (!supabase) return { success: false, message: 'El servicio no está disponible.' }
  const { data, error } = await supabase.functions.invoke('patient-communications', { body })
  if (error) {
    const response = (error as { context?: Response }).context
    if (response) {
      try { const payload = await response.json(); if (typeof payload.message === 'string') return { success: false, message: payload.message } }
      catch { console.error('patient-communications: no se pudo leer el error del servidor') }
    }
    return { success: false, message: 'No se pudo conectar. Consultá el historial antes de reintentar un envío.' }
  }
  return data ?? { success: false, message: 'Respuesta vacía del servidor.' }
}
