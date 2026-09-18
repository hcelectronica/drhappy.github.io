import { supabase, isSupabaseConfigured } from './supabaseClient'

interface WorkspaceResponse {
  success: boolean
  message?: string
  professional?: unknown
  workspace?: unknown
}

async function invokeWorkspace(body: Record<string, unknown>): Promise<WorkspaceResponse> {
  if (!isSupabaseConfigured || !supabase) return { success: false, message: 'Supabase no está conectado.' }
  const sessionToken = sessionStorage.getItem('drhappy-professional-session') || ''
  const { data, error } = await supabase.functions.invoke('workspace-data', {
    body,
    headers: sessionToken ? { 'x-drhappy-session': sessionToken } : undefined,
  })
  if (error) return { success: false, message: error.message || 'No se pudo sincronizar el workspace.' }
  return data as WorkspaceResponse
}

export function loadWorkspaceData(): Promise<WorkspaceResponse> {
  return invokeWorkspace({ action: 'load' })
}

export function saveWorkspaceData(params: { profile: unknown; patients: unknown[]; appointments: unknown[]; treatmentLedger: unknown[] }): Promise<WorkspaceResponse> {
  return invokeWorkspace({ action: 'save', ...params })
}
