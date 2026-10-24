import type { SupabaseClient } from 'jsr:@supabase/supabase-js@2'
import { ownedSharedPatient, SharedStudyError } from './sofiaSharedDocument.ts'

const normalize = (value: unknown) => String(value ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim()
const validShare = (share: { expires_at: string | null }) => !share.expires_at
  || (Number.isFinite(Date.parse(share.expires_at)) && Date.parse(share.expires_at) > Date.now())

export async function sharedChatPatient(admin: SupabaseClient, professionalId: string, query: unknown, patientId?: unknown) {
  if (typeof patientId === 'string' && patientId.trim()) return ownedSharedPatient(admin, professionalId, patientId)
  const text = normalize(query)
  if (text.length < 2) throw new SharedStudyError(400, 'Indicá nombre, apellido o DNI del paciente.')
  const { data, error } = await admin.from('user_workspaces').select('patients_json').eq('user_id', professionalId).maybeSingle()
  if (error) throw error
  const patients: unknown[] = Array.isArray(data?.patients_json) ? data.patients_json : []
  const matches = patients.filter((entry): entry is Record<string, unknown> => {
    if (!entry || typeof entry !== 'object') return false
    const patient = entry as Record<string, unknown>
    if (patient.ownerUserId !== professionalId) return false
    const name = normalize(`${patient.nombre ?? ''} ${patient.apellido ?? ''}`)
    return /^\d[\d.\s-]+$/.test(text)
      ? String(patient.dni ?? '').replace(/\D/g, '') === text.replace(/\D/g, '')
      : text.split(/\s+/).every(part => name.includes(part))
  })
  if (!matches.length) throw new SharedStudyError(404, 'No encontré una ficha propia para ese paciente.')
  if (matches.length !== 1) throw new SharedStudyError(409, 'Hay varios pacientes con ese nombre. Pedí el DNI o seleccioná la ficha antes de consultar; no elijas uno por aproximación.')
  return ownedSharedPatient(admin, professionalId, String(matches[0].id))
}

export async function sharedChatFolder(admin: SupabaseClient, professionalId: string, patientId: string, monitoring = false) {
  const { patient, dni } = await ownedSharedPatient(admin, professionalId, patientId)
  const { data: accounts, error: accountError } = await admin.from('patient_accounts')
    .select('id').eq('dni', dni).eq('active', true)
  if (accountError) throw accountError
  const result = { patientId, patientName: `${patient.apellido ?? ''}, ${patient.nombre ?? ''}`,
    folders: [] as Array<Record<string, unknown>>, message: 'No hay permisos vigentes para Mi Carpeta de Salud.' }
  if (!accounts?.length) return result
  const { data: shares, error: shareError } = await admin.from('patient_shares')
    .select('id, patient_id, all_documents, document_ids, expires_at, include_pressure, include_glucose')
    .eq('kind', 'doctor').eq('professional_id', professionalId).is('revoked_at', null)
    .in('patient_id', accounts.map(account => account.id))
  if (shareError) throw shareError
  for (const share of (shares ?? []).filter(validShare)) {
    if (monitoring) {
      let pressure = null, glucose = null, treatment = null
      if (share.include_pressure) {
        const { data, error, count } = await admin.from('patient_bp_readings')
          .select('measured_at, systolic, diastolic, pulse, note', { count: 'exact' })
          .eq('patient_id', share.patient_id).is('deleted_at', null).order('measured_at', { ascending: false }).limit(30)
        if (error) throw error
        pressure = { readings: data ?? [], total: count ?? 0, unit: 'mmHg; pulso en lpm' }
      }
      if (share.include_glucose) {
        const { data, error, count } = await admin.from('patient_glucose_readings')
          .select('measured_at, value, context, method, note', { count: 'exact' })
          .eq('patient_id', share.patient_id).is('deleted_at', null).order('measured_at', { ascending: false }).limit(30)
        if (error) throw error
        glucose = { readings: data ?? [], total: count ?? 0, unit: 'mg/dL' }
        const { data: profile, error: profileError } = await admin.from('patient_diabetes_profiles')
          .select('treatment, updated_at').eq('patient_id', share.patient_id).maybeSingle()
        if (profileError) throw profileError
        treatment = profile
      }
      result.folders.push({ shareId: share.id, pressure, glucose, treatment,
        note: 'Datos declarados por el paciente; como máximo las últimas 30 mediciones por tipo. null significa sin permiso, no ausencia de enfermedad.' })
    } else {
      let documents: Array<Record<string, unknown>> = []
      let total = 0
      if (share.all_documents || share.document_ids?.length) {
        let query = admin.from('patient_documents')
          .select('id, title, study_date, mime_type, size_bytes', { count: 'exact' })
          .eq('patient_id', share.patient_id).eq('status', 'ready').is('deleted_at', null)
        if (!share.all_documents) query = query.in('id', share.document_ids ?? [])
        const { data, error, count } = await query.order('study_date', { ascending: false, nullsFirst: false }).limit(40)
        if (error) throw error
        documents = (data ?? []).map(document => ({
          id: document.id, title: document.title, study_date: document.study_date,
          mime_type: document.mime_type, size_bytes: document.size_bytes, patientId, shareId: share.id,
          readable: ['application/pdf', 'image/jpeg', 'image/png', 'image/webp'].includes(document.mime_type)
            && Number(document.size_bytes) > 0 && Number(document.size_bytes) <= 8 * 1024 * 1024,
        }))
        total = count ?? 0
      }
      result.folders.push({ shareId: share.id, documents, total,
        note: 'Listado de hasta 40 estudios recientes; listar no significa haber leído el contenido. Para otros estudios, usar Leer con Sofía desde la ficha.' })
    }
    // Do not return data whose permission changed while it was being queried.
    const { data: current, error: currentError } = await admin.from('patient_shares')
      .select('all_documents, document_ids, expires_at, include_pressure, include_glucose')
      .eq('id', share.id).eq('professional_id', professionalId).eq('kind', 'doctor').is('revoked_at', null).maybeSingle()
    if (currentError) throw currentError
    if (!current || !validShare(current) || current.all_documents !== share.all_documents
      || JSON.stringify(current.document_ids) !== JSON.stringify(share.document_ids)
      || current.include_pressure !== share.include_pressure || current.include_glucose !== share.include_glucose) {
      throw new SharedStudyError(403, 'Los permisos de la carpeta cambiaron. Volvé a consultar.')
    }
    const { data: active, error: activeError } = await admin.from('patient_accounts')
      .select('id').eq('id', share.patient_id).eq('dni', dni).eq('active', true).maybeSingle()
    if (activeError) throw activeError
    if (!active) throw new SharedStudyError(403, 'La carpeta del paciente ya no está disponible.')
  }
  await ownedSharedPatient(admin, professionalId, patientId)
  if (result.folders.length) result.message = monitoring ? 'Monitoreo autorizado; no modifica la historia clínica.' : 'Estudios autorizados; falta leer el archivo para conocer sus resultados.'
  return result
}
