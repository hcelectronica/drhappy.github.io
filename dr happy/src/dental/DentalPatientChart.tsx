import { useEffect, useState } from 'react'
import DentalChart from './DentalDesignPreview'
import { createDentalDesignRecord } from './dentalModel'
import { loadDentalRecord, saveDentalRecord } from './dentalService'
import type { DentalDesignRecord } from './dentalModel'
import type { DentalSaveResult } from './dentalService'
import { useErrorNotification } from '../useErrorNotification'

export interface DentalPatient {
  id: string
  nombre: string
  apellido: string
  dni: string
  email: string
  birthDate: string
  direccion: string
  telefono?: string
  obraSocial: string
  numeroAfiliado: string
  dentalStatus?: 'provisional' | 'confirmed'
}
export function DentalPatientChart({ patient, appointmentId, onSaved, onBack, onDirtyChange, onSavingChange, professional }: {
  professional: { fullName: string; licenseNumber: string }
  patient: DentalPatient
  appointmentId?: string
  onSaved: (result: DentalSaveResult) => void
  onBack: () => void
  onDirtyChange: (dirty: boolean) => void
  onSavingChange: (saving: boolean) => void
}) {
  const [loaded, setLoaded] = useState<DentalSaveResult | null>(null)
  const [error, setError] = useErrorNotification()
  const [attempt, setAttempt] = useState(0)
  const [chartVersion, setChartVersion] = useState(0)
  useEffect(() => {
    let cancelled = false
    void loadDentalRecord(patient.id).then((result) => { if (!cancelled) setLoaded(result) })
      .catch((error: unknown) => { if (!cancelled) setError(error instanceof Error ? error.message : 'No se pudo cargar la ficha dental.') })
    return () => { cancelled = true; onDirtyChange(false) }
  }, [patient.id, attempt, onDirtyChange, setError])
  if (error) return <section className="panel"><p className="error">{error}</p><button type="button" onClick={() => { setError(null); setAttempt((value) => value + 1) }}>Reintentar</button><button type="button" className="ghost" onClick={onBack}>Volver a pacientes</button></section>
  if (!loaded) return <section className="panel"><p role="status">Cargando ficha odontológica...</p></section>
  const initialRecord: DentalDesignRecord = loaded.record ?? {
    ...createDentalDesignRecord(),
    patient: {
      name: `${patient.apellido}, ${patient.nombre}`, dni: patient.dni, email: patient.email,
      birthDate: patient.birthDate, address: patient.direccion, phone: patient.telefono || '',
      locality: '', coverage: patient.obraSocial, memberNumber: patient.numeroAfiliado,
    }, status: patient.dentalStatus ?? 'provisional',
  }
  return <DentalChart key={chartVersion} initialRecord={initialRecord} realPatientId={patient.id} professional={professional} onDirtyChange={onDirtyChange} onSavingChange={onSavingChange} onBack={onBack}
    revisions={loaded.history}
    onReload={async () => {
      const result = await loadDentalRecord(patient.id)
      setLoaded(result)
      setChartVersion((value) => value + 1)
      onDirtyChange(false)
    }}
    onSave={async (record, confirm) => {
      const result = await saveDentalRecord(patient.id, record, loaded.revision, confirm, appointmentId)
      if (!result.record) throw new Error('El servidor no devolvió la ficha guardada.')
      setLoaded(result)
      onSaved(result)
      return result.record
    }} />
}
