import { supabase, isSupabaseConfigured } from './supabaseClient'

interface WorkspaceResponse {
  success: boolean
  message?: string
  professional?: unknown
  workspace?: unknown
  archivedPatients?: unknown[]
}

async function invokeWorkspace(body: Record<string, unknown>): Promise<WorkspaceResponse> {
  if (!isSupabaseConfigured || !supabase) return { success: false, message: 'Supabase no está conectado.' }
  const sessionToken = sessionStorage.getItem('drhappy-professional-session') || ''
  const { data, error } = await supabase.functions.invoke('workspace-data', {
    body,
    headers: sessionToken ? { 'x-drhappy-session': sessionToken } : undefined,
  })
  if (error) {
    if (error.context instanceof Response) {
      try {
        const detail: unknown = await error.context.json()
        if (detail && typeof detail === 'object' && 'message' in detail && typeof detail.message === 'string') return { success: false, message: detail.message }
      } catch { console.error('Respuesta inválida del servicio de workspace:', error.context.status) }
    }
    return { success: false, message: error.message || 'No se pudo sincronizar el workspace.' }
  }
  return data as WorkspaceResponse
}

export function loadWorkspaceData(): Promise<WorkspaceResponse> {
  return invokeWorkspace({ action: 'load' })
}

export function saveWorkspaceData(params: { profile: unknown; patients: unknown[]; appointments: unknown[]; treatmentLedger?: unknown[] }): Promise<WorkspaceResponse> {
  return invokeWorkspace({ action: 'save', ...params })
}

export function saveTreatmentLedgerData(treatmentLedger: unknown[]): Promise<WorkspaceResponse> {
  return invokeWorkspace({ action: 'save-ledger', treatmentLedger })
}

export function updatePatientArchive(patientId: string, archiveAction: 'archive' | 'restore' | 'confirm'): Promise<WorkspaceResponse> {
  return invokeWorkspace({ action: 'archive-patient', patientId, archiveAction })
}
