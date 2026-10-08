import { supabase } from './supabaseClient'
import type { SignedConsultation } from './consultationCorrection'

export async function saveConsultationCorrection(params: {
  patientId: string
  consultationId: string
  expectedHash: string
  replacement: SignedConsultation
}): Promise<SignedConsultation> {
  if (!supabase) throw new Error('Se requiere conexión para corregir una evolución firmada.')
  const sessionToken = sessionStorage.getItem('drhappy-professional-session') || ''
  const replacement = { ...params.replacement }
  delete replacement.correctionHistory
  const { data, error } = await supabase.functions.invoke<{ success: boolean; consultation?: SignedConsultation }>('consultation-correction', {
    body: { ...params, replacement }, headers: sessionToken ? { 'x-drhappy-session': sessionToken } : undefined,
    timeout: 30_000,
  })
  if (error) {
    if (error.context instanceof Response) {
      let detail: unknown
      try { detail = await error.context.json() }
      catch { throw new Error('No se pudo confirmar la corrección. Recargá la ficha antes de reintentar.') }
      if (detail && typeof detail === 'object' && 'message' in detail && typeof detail.message === 'string') throw new Error(detail.message)
    }
    throw new Error('No se pudo confirmar la corrección. Recargá la ficha antes de reintentar.')
  }
  if (!data || data.success !== true || !data.consultation || data.consultation.id !== params.consultationId
    || data.consultation.signatureSeal?.hashSha256 !== params.replacement.signatureSeal?.hashSha256
    || !Array.isArray(data.consultation.correctionHistory)) {
    throw new Error('El servidor no confirmó la versión corregida. Recargá la ficha antes de reintentar.')
  }
  return data.consultation
}
