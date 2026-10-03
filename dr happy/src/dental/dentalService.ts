import { supabase } from '../supabaseClient'
import { isDentalDesignRecord } from './dentalModel'
import type { DentalDesignRecord } from './dentalModel'

export interface DentalSaveResult {
  record: DentalDesignRecord | null
  revision: number
  patient?: unknown
  treatmentLedger?: unknown[]
  appointments?: unknown[]
  history?: Array<{ revision: number; createdAt: string; confirmed: boolean }>
}

async function dentalRequest(body: Record<string, unknown>): Promise<DentalSaveResult> {
  if (!supabase) throw new Error('Supabase no está conectado. La ficha no se guardó.')
  const token = sessionStorage.getItem('drhappy-professional-session')
  const { data, error } = await supabase.functions.invoke('dental-records', {
    body, headers: token ? { 'x-drhappy-session': token } : undefined,
  })
  if (error) {
    let message = error.message
    if (error.context instanceof Response) {
      const text = await error.context.text()
      try { const detail: unknown = JSON.parse(text); if (detail && typeof detail === 'object' && 'message' in detail && typeof detail.message === 'string') message = detail.message }
      catch { console.error('Respuesta inválida del servicio odontológico:', error.context.status) }
    }
    throw new Error(message)
  }
  if (!data?.success) throw new Error(data?.message || 'No se pudo consultar la ficha odontológica.')
  if (!Number.isSafeInteger(data.revision) || data.revision < 0 || (data.record !== null && !isDentalDesignRecord(data.record))) {
    throw new Error('El servidor devolvió una ficha odontológica inválida. No se sobrescribieron tus cambios.')
  }
  return data
}

export function loadDentalRecord(patientId: string) {
  return dentalRequest({ action: 'load', patientId })
}
export function saveDentalRecord(patientId: string, record: DentalDesignRecord, expectedRevision: number, confirm: boolean, appointmentId?: string) {
  return dentalRequest({ action: 'save', patientId, record, expectedRevision, confirm, appointmentId: confirm ? appointmentId : undefined })
}
