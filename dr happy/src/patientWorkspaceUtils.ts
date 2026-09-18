export interface PatientWorkspaceRemovalResult<Patient, Appointment, Ledger> {
  patients: Patient[]
  appointments: Appointment[]
  ledger: Ledger[]
}

export function removePatientFromWorkspace<
  Patient extends { id: string },
  Appointment extends { patientId?: string; patientDni?: string },
  Ledger extends { patientId: string },
>(
  patientId: string,
  patientDni: string,
  patients: Patient[],
  appointments: Appointment[],
  ledger: Ledger[],
): PatientWorkspaceRemovalResult<Patient, Appointment, Ledger> {
  return {
    patients: patients.filter((patient) => patient.id !== patientId),
    appointments: appointments.filter((appointment) => (
      appointment.patientId !== patientId &&
      (!patientDni || appointment.patientDni !== patientDni)
    )),
    ledger: ledger.filter((entry) => entry.patientId !== patientId),
  }
}
