import type { SupabaseClient } from 'jsr:@supabase/supabase-js@2'
import { ADMIN_REGISTRATION_RECIPIENT } from './adminRegistrationEmail.ts'

export function patientRegistrationEmail(patient: { full_name: string; email: string }) {
  const text = [
    'Un paciente completó su registro y verificó su email en Mi Carpeta de Salud.',
    '',
    `Nombre: ${patient.full_name}`,
    `Email: ${patient.email}`,
    '',
    'Podés consultar las altas y el uso en Administración → Mi Carpeta de Salud.',
    'https://www.drhappy.com.ar/',
  ].join('\n')
  const escaped = text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;').replaceAll("'", '&#39;')
  return {
    to: ADMIN_REGISTRATION_RECIPIENT,
    subject: 'Dr Happy - Nuevo paciente en Mi Carpeta de Salud',
    type: 'custom',
    text,
    templateData: { message: escaped.replaceAll('\n', '<br>') },
  }
}

export async function sendPatientRegistrationNotice(
  admin: SupabaseClient, url: string, key: string, patientId: string, send: typeof fetch = fetch,
): Promise<boolean> {
  // Claim before sending, including abandoned claims after an interrupted function.
  const { data: claim, error: claimError } = await admin.from('patient_registration_notices')
    .update({ status: 'sending', updated_at: new Date().toISOString() })
    .eq('patient_id', patientId)
    .or(`status.in.(pending,failed),and(status.eq.sending,updated_at.lt.${new Date(Date.now() - 600000).toISOString()})`)
    .select('patient_id, attempts').maybeSingle()
  if (claimError) throw claimError
  if (!claim) return false
  try {
    const { data: patient, error } = await admin.from('patient_accounts')
      .select('full_name, email, email_verified_at').eq('id', patientId).single()
    if (error) throw error
    if (!patient.email_verified_at) throw new Error('El paciente aún no verificó su email.')
    const response = await send(`${url}/functions/v1/send-email`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}`, apikey: key },
      body: JSON.stringify(patientRegistrationEmail(patient)),
      signal: AbortSignal.timeout(10000),
    })
    const result = await response.json()
    if (!response.ok || result?.success !== true) throw new Error(`Envío no confirmado (HTTP ${response.status}).`)
    const { error: saveError } = await admin.from('patient_registration_notices')
      .update({ status: 'sent', attempts: claim.attempts + 1, sent_at: new Date().toISOString(), updated_at: new Date().toISOString() })
      .eq('patient_id', patientId)
    if (saveError) throw saveError
    return true
  } catch (error) {
    console.error('[patient-registration-email] Aviso pendiente; el registro se conserva', {
      patientId, message: error instanceof Error ? error.message : String(error),
    })
    const { error: saveError } = await admin.from('patient_registration_notices')
      .update({ status: 'failed', attempts: claim.attempts + 1, updated_at: new Date().toISOString() })
      .eq('patient_id', patientId)
    if (saveError) throw saveError
    return false
  }
}
