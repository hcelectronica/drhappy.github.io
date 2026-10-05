import { corsHeaders } from '../_shared/cors.ts'
import { createClient } from 'jsr:@supabase/supabase-js@2'
import type { SupabaseClient } from 'jsr:@supabase/supabase-js@2'
import { resolveProfessionalId } from '../_shared/professionalSession.ts'

function jsonResponse(status: number, body: Record<string, unknown>): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
}

async function visibleWorkspace(admin: SupabaseClient, professionalId: string, workspace: unknown) {
  const { data: archives, error } = await admin.from('dental_patient_archives')
    .select('patient_id, state, patient, archived_at, confirmed_at').eq('professional_id', professionalId).neq('state', 'active')
  if (error) throw new Error('No se pudo consultar el archivo de pacientes.')
  const hiddenIds = new Set((archives ?? []).map((entry) => entry.patient_id))
  const row = workspace && typeof workspace === 'object' ? workspace as Record<string, unknown> : null
  return {
    workspace: row ? { ...row, patients_json: (Array.isArray(row.patients_json) ? row.patients_json : [])
      .filter((patient) => patient && typeof patient === 'object' && !hiddenIds.has(patient.id)) } : null,
    archivedPatients: archives ?? [],
  }
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (request.method !== 'POST') return jsonResponse(405, { success: false, message: 'Método no permitido.' })
  const supabaseUrl = Deno.env.get('SUPABASE_URL')
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  if (!supabaseUrl || !serviceRoleKey) return jsonResponse(500, { success: false, message: 'Falta configuración del servidor.' })
  const admin = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false } })
  const professionalId = await resolveProfessionalId(request, admin)
  if (!professionalId) return jsonResponse(401, { success: false, message: 'Sesión profesional requerida.' })

  let body: Record<string, unknown>
  try { body = await request.json() } catch { return jsonResponse(400, { success: false, message: 'Cuerpo JSON inválido.' }) }
  if (body.action === 'load') {
    const [{ data: loadedWorkspace, error: workspaceError }, { data: professional, error: professionalError }] = await Promise.all([
      admin.from('user_workspaces').select('user_id, profile_json, patients_json, appointments_json, treatment_ledger_json, treatment_ledger_initialized').eq('user_id', professionalId).maybeSingle(),
      admin.from('professionals').select('id, username, full_name, specialty, license_number, dni, email, network_memberships_json, is_admin, active, enabled_modules_json, trial_started_at, subscription_status, subscription_expires_at').eq('id', professionalId).maybeSingle(),
    ])
    if (workspaceError || professionalError) return jsonResponse(500, { success: false, message: workspaceError?.message || professionalError?.message })
    let workspace = loadedWorkspace
    if (typeof professional?.specialty === 'string'
      && professional.specialty.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().includes('odont')) {
      const { data: syncedWorkspace, error: syncError } = await admin.rpc('dental_sync_provisional', {
        p_professional_id: professionalId,
      })
      if (syncError) return jsonResponse(500, { success: false, message: 'No se pudieron sincronizar los pacientes odontológicos.' })
      workspace = syncedWorkspace
    }
    try {
      return jsonResponse(200, { success: true, professional, ...await visibleWorkspace(admin, professionalId, workspace) })
    } catch (error) {
      console.error('[workspace-data] Archivo no disponible', { professionalId })
      return jsonResponse(500, { success: false, message: error instanceof Error ? error.message : 'No se pudo consultar el archivo.' })
    }
  }
  if (body.action === 'archive-patient') {
    if (typeof body.patientId !== 'string' || !body.patientId.trim() || body.patientId.length > 128
      || !['archive', 'restore', 'confirm'].includes(String(body.archiveAction))) {
      return jsonResponse(400, { success: false, message: 'Paciente o acción de archivo inválidos.' })
    }
    const { error } = await admin.rpc('dental_archive_patient', {
      p_professional_id: professionalId, p_patient_id: body.patientId, p_action: body.archiveAction,
    })
    if (error) {
      if (!['22023', '42501', 'P0002'].includes(error.code)) console.error('[workspace-data] Falló el archivo', { professionalId, code: error.code })
      return jsonResponse(error.code === '42501' ? 403 : error.code === 'P0002' ? 404 : error.code === '22023' ? 409 : 500,
        { success: false, message: ['22023', '42501', 'P0002'].includes(error.code) ? error.message : 'No se pudo actualizar el archivo del paciente.' })
    }
    return jsonResponse(200, { success: true })
  }
  if (body.action === 'save') {
    const profile = body.profile && typeof body.profile === 'object' ? body.profile : {}
    let patients = Array.isArray(body.patients) ? body.patients : []
    const appointments = Array.isArray(body.appointments) ? body.appointments : []
    // Las evoluciones de videoconsulta se guardan desde el servidor: una pestaña con datos viejos no debe borrarlas.
    const { data: current, error: currentError } = await admin.from('user_workspaces').select('patients_json').eq('user_id', professionalId).maybeSingle()
    if (currentError) return jsonResponse(500, { success: false, message: currentError.message })
    const videoEntries = new Map<string, Record<string, unknown>[]>()
    for (const patient of Array.isArray(current?.patients_json) ? current.patients_json : []) {
      if (!patient || typeof patient !== 'object' || typeof patient.id !== 'string' || !Array.isArray(patient.consultations)) continue
      const entries = patient.consultations.filter((entry: unknown) => entry && typeof entry === 'object'
        && typeof (entry as Record<string, unknown>).id === 'string' && String((entry as Record<string, unknown>).id).startsWith('video-'))
      if (entries.length) videoEntries.set(patient.id, entries)
    }
    if (videoEntries.size) {
      patients = patients.map((patient) => {
        if (!patient || typeof patient !== 'object' || !videoEntries.has(patient.id)) return patient
        const consultations = Array.isArray(patient.consultations) ? patient.consultations : []
        const known = new Set(consultations.map((entry: unknown) => entry && typeof entry === 'object' ? (entry as Record<string, unknown>).id : null))
        const missing = videoEntries.get(patient.id)!.filter((entry) => !known.has(entry.id))
        return missing.length ? { ...patient, consultations: [...missing, ...consultations] } : patient
      })
    }
    const workspaceUpdate: Record<string, unknown> = {
      user_id: professionalId,
      profile_json: profile,
      patients_json: patients,
      appointments_json: appointments,
    }
    if (Array.isArray(body.treatmentLedger)) {
      workspaceUpdate.treatment_ledger_json = body.treatmentLedger
      workspaceUpdate.treatment_ledger_initialized = true
    }
    const { error } = await admin.from('user_workspaces').upsert(workspaceUpdate, { onConflict: 'user_id' })
    if (error) return jsonResponse(500, { success: false, message: error.message })
    return jsonResponse(200, { success: true })
  }
  if (body.action === 'save-ledger') {
    if (!Array.isArray(body.treatmentLedger)) {
      return jsonResponse(400, { success: false, message: 'El balance enviado no es válido.' })
    }
    const { data: treatmentLedger, error: updateError } = await admin.rpc('dental_merge_ledger', {
      p_professional_id: professionalId,
      p_ledger: body.treatmentLedger,
    })
    if (updateError) return jsonResponse(500, { success: false, message: updateError.message })
    return jsonResponse(200, { success: true, treatmentLedger })
  }
  return jsonResponse(400, { success: false, message: 'Acción no soportada.' })
})
