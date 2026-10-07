import { supabase } from './supabaseClient'

export async function sendConsultationInstructions(params: {
  patientId: string
  consultationId: string
  expectedEmail: string
}): Promise<{ recipient: string }> {
  if (!supabase) throw new Error('Supabase no está conectado. No se envió el correo.')
  const { data, error } = await supabase.functions.invoke('consultation-instructions', { body: params })
  if (error) {
    if (error.context instanceof Response) {
      let detail: unknown
      try { detail = await error.context.json() }
      catch { throw new Error('El servicio devolvió una respuesta inválida. Verificá con el paciente antes de reintentar.') }
      if (detail && typeof detail === 'object' && 'message' in detail && typeof detail.message === 'string') throw new Error(detail.message)
    }
    throw new Error('No se pudo confirmar el envío. Verificá con el paciente antes de reintentar.')
  }
  const result: unknown = data
  if (!result || typeof result !== 'object' || !('success' in result) || result.success !== true
    || !('recipient' in result) || typeof result.recipient !== 'string') {
    throw new Error('El servicio no confirmó el envío. Verificá con el paciente antes de reintentar.')
  }
  return { recipient: result.recipient }
}
