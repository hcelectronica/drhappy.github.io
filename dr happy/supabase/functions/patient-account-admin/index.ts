import { serve } from 'https://deno.land/std@0.224.0/http/server.ts'
import { createClient } from 'jsr:@supabase/supabase-js@2'
import { corsHeaders } from '../_shared/cors.ts'
import { resolveProfessionalId } from '../_shared/professionalSession.ts'
import { patientBackupPdf, backupPdfFilename, pdfBase64 } from '../_shared/patientBackupPdf.ts'

const uuid = (value: unknown): value is string => typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)
const reply = (status: number, body: Record<string, unknown>) => new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } })
serve(async request => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (request.method !== 'POST') return reply(405, { success: false, message: 'Método no permitido.' })
  try {
    const url = Deno.env.get('SUPABASE_URL'), key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
    if (!url || !key) throw new Error('Missing server configuration')
    const admin = createClient(url, key, { auth: { persistSession: false } })
    const actor = await resolveProfessionalId(request, admin)
    if (!actor) return reply(401, { success: false, message: 'Sesión profesional requerida.' })
    const { data: professional, error: authError } = await admin.from('professionals').select('is_admin,active').eq('id', actor).maybeSingle()
    if (authError) throw authError
    if (!professional?.is_admin || professional.active === false) return reply(403, { success: false, message: 'Solo el administrador puede eliminar cuentas de pacientes.' })
    let body: Record<string, unknown>
    try { body = await request.json() } catch { return reply(400, { success: false, message: 'Solicitud inválida.' }) }
    if (!body || !uuid(body.patientId) || !['status', 'prepare', 'send-next', 'retry', 'delete'].includes(String(body.action))) return reply(400, { success: false, message: 'Revisá la cuenta y acción solicitadas.' })
    const { data: patient, error: patientError } = await admin.from('patient_accounts').select('id,email,email_verified_at').eq('id', body.patientId).maybeSingle()
    if (patientError) throw patientError
    if (!patient) return reply(404, { success: false, message: 'La cuenta ya no existe. Actualizá el listado.' })
    if (body.action !== 'status' && (typeof body.confirmEmail !== 'string' || body.confirmEmail.trim().toLowerCase() !== patient.email.trim().toLowerCase())) return reply(400, { success: false, message: 'Escribí el email exacto del paciente para confirmar.' })
    if (body.action === 'prepare') {
      if (body.confirmPermanent !== true) return reply(400, { success: false, message: 'Confirmá que querés iniciar la eliminación permanente.' })
      if (!patient.email_verified_at) {
        const { count, error } = await admin.from('patient_documents').select('id', { count: 'exact', head: true }).eq('patient_id', patient.id).eq('status', 'ready').is('deleted_at', null)
        if (error) throw error
        if (count) return reply(409, { success: false, message: 'El paciente debe verificar su email antes de recibir sus estudios. No se bloqueó ni eliminó la cuenta.' })
      }
      const { error } = await admin.rpc('prepare_patient_account_deletion', { p_patient: patient.id, p_email: body.confirmEmail, p_actor: actor })
      if (error) throw error
    }
    const { data: job, error: jobError } = await admin.from('patient_account_exports').select('id,email').eq('patient_id', patient.id).maybeSingle()
    if (jobError) throw jobError
    if (!job) return body.action === 'status' ? reply(200, { success: true, backup: null }) : reply(409, { success: false, message: 'Primero prepará la copia y confirmá la eliminación.' })
    async function progress() {
      const counts: Record<string, number> = {}
      for (const status of ['pending', 'sending', 'sent', 'failed', 'uncertain']) {
        const { count, error } = await admin.from('patient_account_export_files').select('id', { count: 'exact', head: true }).eq('export_id', job!.id).eq('status', status)
        if (error) throw error
        counts[status] = count ?? 0
      }
      return { counts, total: Object.values(counts).reduce((a, b) => a + b, 0) }
    }
    if (body.action === 'retry') {
      if (body.acceptDuplicateRisk !== true) return reply(400, { success: false, message: 'Confirmá el riesgo de correos duplicados antes de reintentar.' })
      const { error } = await admin.from('patient_account_export_files').update({ status: 'pending', claimed_at: null }).eq('export_id', job.id)
        .or(`status.in.(failed,uncertain),and(status.eq.sending,claimed_at.lt.${new Date(Date.now() - 120000).toISOString()})`)
      if (error) throw error
    }
    if (body.action === 'send-next') {
      const { data: rows, error } = await admin.rpc('claim_patient_export_file', { p_export: job.id })
      if (error) throw error
      const file = rows?.[0]
      if (file) {
        let sending = false
        try {
          if (!file.file_path.startsWith(`${patient.id}/`)) throw new Error('Ruta de estudio inválida; no se eliminó la cuenta.')
          const { data, error: downloadError } = await admin.storage.from('patient-folders').download(file.file_path)
          if (downloadError || !data) throw new Error('No se pudo recuperar un estudio. No se eliminó la cuenta.')
          const pdf = await patientBackupPdf(new Uint8Array(await data.arrayBuffer()), file.mime_type)
          sending = true
          const response = await fetch(`${url}/functions/v1/send-email`, {
            method: 'POST', headers: { Authorization: `Bearer ${key}`, apikey: key, 'Content-Type': 'application/json' },
            body: JSON.stringify({ to: job.email, subject: 'Copia de tus archivos de Mi Carpeta de Salud',
              type: 'custom', text: 'Te enviamos un archivo de tu Carpeta de Salud como PDF adjunto, antes de la eliminación de tu cuenta solicitada al administrador. Si tenés varios archivos, recibirás varios correos. Guardá todos los adjuntos y confirmá su recepción con el administrador antes del borrado definitivo. Este correo contiene información privada de salud.',
              attachments: [{ filename: backupPdfFilename(file.title, file.id), content: pdfBase64(pdf), contentType: 'application/pdf', encoding: 'base64' }] }),
            signal: AbortSignal.timeout(45000),
          })
          const result = await response.json()
          const accepted = Array.isArray(result.accepted) && result.accepted.some((email: unknown) => typeof email === 'string' && email.toLowerCase() === job.email.toLowerCase())
          if (!response.ok || result.success !== true || !accepted || result.rejected?.length) throw new Error('No se confirmó la aceptación del adjunto por el servidor de correo. No se eliminó la cuenta.')
          const { error: saveError } = await admin.from('patient_account_export_files').update({ status: 'sent' }).eq('id', file.id).eq('status', 'sending')
          if (saveError) throw saveError
        } catch (error) {
          const { error: saveError } = await admin.from('patient_account_export_files').update({ status: sending ? 'uncertain' : 'failed' }).eq('id', file.id).eq('status', 'sending')
          if (saveError) throw saveError
          console.error('patient-account-admin: backup failed', { exportId: job.id, fileId: file.id, stage: sending ? 'email' : 'conversion' })
          return reply(409, { success: false, message: error instanceof Error ? error.message : 'Falló la copia de un archivo. No se eliminó la cuenta.', backup: await progress() })
        }
      }
    }
    if (body.action === 'delete') {
      const backup = await progress()
      if (body.confirmPermanent !== true || body.receiptConfirmed !== true || backup.counts.sent !== backup.total) return reply(409, { success: false, message: 'No se puede borrar: completá todos los envíos y confirmá la recepción de los PDF por el paciente.' })
      const { data: files, error } = await admin.storage.from('patient-folders').list(patient.id, { limit: 100 })
      if (error) throw error
      if (files?.length) {
        if (files.some(file => !file.id)) throw new Error('Se encontró una carpeta inesperada; requiere revisión antes del borrado.')
        const { error: removeError } = await admin.storage.from('patient-folders').remove(files.map(file => `${patient.id}/${file.name}`))
        if (removeError) throw removeError
        return reply(200, { success: true, deleted: false, backup })
      }
      const { error: deleteError } = await admin.rpc('finish_patient_account_deletion', { p_patient: patient.id, p_email: body.confirmEmail })
      if (deleteError) throw deleteError
      return reply(200, { success: true, deleted: true })
    }
    return reply(200, { success: true, backup: await progress() })
  } catch (error) {
    console.error('patient-account-admin: operation failed', error instanceof Error ? error.message : 'Database/storage error')
    return reply(500, { success: false, message: 'No se pudo completar la operación. La cuenta no se eliminó por completo. Actualizá el estado y reintentá; los PDF confirmados no se vuelven a enviar automáticamente.' })
  }
})
