import type { SupabaseClient } from 'jsr:@supabase/supabase-js@2'
import { hasMedicalToolRowAccess, MEDICAL_TOOL_ACCESS_COLUMNS } from './medicalToolAccess.ts'

export const patientFolderUrl = (professionalId: string) =>
  `https://www.drhappy.com.ar/paciente?prof=${encodeURIComponent(professionalId)}`

export function validReferringProfessional(value: unknown): value is string {
  return typeof value === 'string' && /^[A-Za-z0-9_-]{1,120}$/.test(value)
}

export async function patientFolderOrientation(admin: SupabaseClient, professionalId: string) {
  const { data: professional, error } = await admin.from('professionals')
    .select(`full_name,${MEDICAL_TOOL_ACCESS_COLUMNS}`).eq('id', professionalId).maybeSingle()
  if (error) throw error
  if (!professional || professional.active === false) return null
  const [settings, payment] = await Promise.all([
    admin.from('virtual_consult_settings').select('slug,enabled').eq('professional_id', professionalId).maybeSingle(),
    admin.from('professional_payment_accounts').select('status').eq('professional_id', professionalId).eq('provider', 'mercadopago').maybeSingle(),
  ])
  if (settings.error) throw settings.error
  if (payment.error) throw payment.error
  const available = hasMedicalToolRowAccess(professional, ['attention', 'balance'])
    && settings.data?.enabled === true && payment.data?.status === 'connected'
    && typeof settings.data.slug === 'string' && /^[a-z0-9-]{6,80}$/.test(settings.data.slug)
  return {
    professionalId,
    professionalName: professional.full_name,
    url: available ? `https://www.drhappy.com.ar/consulta/${encodeURIComponent(settings.data!.slug)}` : null,
    shareUrl: patientFolderUrl(professionalId),
  }
}
