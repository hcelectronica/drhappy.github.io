export interface ArchivedPatient {
  patient_id: string
  state: 'archived' | 'confirmed'
  patient: { id: string; nombre: string; apellido: string; dni: string } & Record<string, unknown>
  archived_at: string
  confirmed_at: string | null
}

export function readPatientArchives(value: unknown): ArchivedPatient[] {
  if (value === undefined) return []
  if (!Array.isArray(value)) throw new Error('El servidor devolvió un archivo de pacientes inválido.')
  return value.map((entry: unknown) => {
    if (!entry || typeof entry !== 'object') throw new Error('Registro de archivo inválido.')
    const row = entry as Record<string, unknown>
    const patient = row.patient
    if (!patient || typeof patient !== 'object') throw new Error('Paciente archivado inválido.')
    const data = patient as Record<string, unknown>
    if (typeof row.patient_id !== 'string' || data.id !== row.patient_id || typeof data.nombre !== 'string'
      || typeof data.apellido !== 'string' || typeof data.dni !== 'string'
      || (row.state !== 'archived' && row.state !== 'confirmed') || typeof row.archived_at !== 'string'
      || (row.confirmed_at !== null && typeof row.confirmed_at !== 'string')) throw new Error('Registro de archivo inválido.')
    return {
      patient_id: row.patient_id, state: row.state, archived_at: row.archived_at, confirmed_at: row.confirmed_at,
      patient: { ...data, id: row.patient_id, nombre: data.nombre, apellido: data.apellido, dni: data.dni },
    }
  })
}
