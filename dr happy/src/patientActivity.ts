import { callPatientFolder } from './patientFolderService'

export type PatientFeature = 'home' | 'folder' | 'upload' | 'pressure' | 'glucose' | 'memory' | 'share' | 'account'
export type PatientActivityEvent = 'heartbeat' | 'view' | 'game_completed' | 'invite_clicked'

export async function trackPatientActivity(event: PatientActivityEvent, feature?: PatientFeature): Promise<void> {
  try {
    const result = await callPatientFolder({ action: 'activity', event, feature })
    if (!result.success) console.error('[patient-activity]', result.message || 'No se pudo registrar la actividad.')
  } catch (error) {
    console.error('[patient-activity] Error de conexión', error)
  }
}
