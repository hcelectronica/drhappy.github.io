import { supabase } from './supabaseClient'

export async function createVideoAccessUrl(): Promise<string> {
  if (!supabase) throw new Error('Supabase no está conectado.')
  const { data, error } = await supabase.functions.invoke('video-handoff', { body: { action: 'create' } })
  if (error) {
    if ('context' in error && error.context instanceof Response) {
      const text = await error.context.text()
      let payload: unknown
      try { payload = JSON.parse(text) }
      catch { throw new Error('El servicio de acceso devolvió una respuesta inválida. Reintentá desde Dr Happy.') }
      if (payload && typeof payload === 'object' && 'error' in payload && typeof payload.error === 'string') {
        throw new Error(payload.error)
      }
    }
    throw new Error(error.message || 'No se pudo abrir la videoconsulta.')
  }
  const result: unknown = data
  if (!result || typeof result !== 'object' || !('token' in result)
    || typeof result.token !== 'string' || !/^[a-f0-9]{64}$/.test(result.token)) {
    throw new Error('No se recibió un pase válido para la videoconsulta.')
  }
  return `https://video.drhappy.com.ar/#handoff=${result.token}`
}
