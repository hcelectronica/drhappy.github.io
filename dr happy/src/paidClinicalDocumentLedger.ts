import type { PaidClinicalDocumentRequest } from './paidClinicalDocumentsService'

export interface PaidDocumentLedgerEntry {
  id: string
  patientId: string
  patientName: string
  date: string
  intervention: string
  totalAmount: number
  paidAmount: number
  notes: string
  createdAt: string
  updatedAt: string
  paidClinicalDocumentRequestId: string
}

export function paidDocumentLedgerEntries(
  requests: readonly PaidClinicalDocumentRequest[],
  patients: readonly { id: string; dni: string; nombre: string; apellido: string }[],
): PaidDocumentLedgerEntry[] {
  const entries = new Map<string, PaidDocumentLedgerEntry>()
  for (const request of requests) {
    if (request.payment_status !== 'approved' || !['pending_review', 'completed'].includes(request.status)) continue
    if (!Number.isFinite(request.amount) || request.amount <= 0) throw new Error('Una solicitud paga tiene un importe inválido.')
    const timestamp = request.paid_at || request.created_at
    const paidDate = new Date(timestamp)
    if (Number.isNaN(paidDate.getTime())) throw new Error('Una solicitud paga tiene una fecha inválida.')
    const dni = request.patient_dni.replace(/\D/g, '')
    const patient = dni ? patients.find((item) => item.dni.replace(/\D/g, '') === dni) : undefined
    const id = `paid-document-${request.id}`
    entries.set(id, {
      id,
      patientId: patient?.id || (dni ? `paid-document-dni-${dni}` : id),
      patientName: patient ? `${patient.apellido}, ${patient.nombre}` : `${request.patient_last_name}, ${request.patient_first_name}`,
      date: paidDate.toLocaleDateString('en-CA', { timeZone: 'America/Argentina/Buenos_Aires' }),
      intervention: 'Solicitud de certificados y órdenes',
      totalAmount: request.amount,
      paidAmount: request.amount,
      notes: 'Pago confirmado por Mercado Pago. Enlace independiente de certificados y órdenes.',
      createdAt: request.created_at,
      updatedAt: request.completed_at || timestamp,
      paidClinicalDocumentRequestId: request.id,
    })
  }
  return [...entries.values()]
}
