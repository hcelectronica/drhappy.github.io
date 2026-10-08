import type { ConsultationFollowUp } from './clinicalFollowUp'
import type { SignatureSeal } from './signatureSeal'

export interface SignedConsultation extends ConsultationFollowUp {
  id: string
  date: string
  motivoConsulta: string
  diagnostico?: string
  detalleAtencion: string
  pensamientoMedico: string
  enfermedadActual?: string
  examenFisico?: string
  impresionDiagnostica?: string
  planManejo?: string
  professionalSignature: {
    fullName: string
    licenseNumber: string
    signatureText: string
    signatureImageDataUrl?: string
  }
  signatureSeal?: SignatureSeal
  certificateId?: string
  correction?: { reason: string; previousHash: string; originalDate: string }
  correctionHistory?: ConsultationRevision[]
}

export interface ConsultationRevision {
  previous: SignedConsultation
  correctedAt: string
  correctedByUserId: string
  reason: string
  newHash: string
}

export const CORRECTION_WINDOW_MS = 24 * 60 * 60 * 1000

function validTimestamp(value: string): number {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(value)) return NaN
  const day = new Date(`${value.slice(0, 10)}T12:00:00Z`)
  if (!Number.isFinite(day.getTime()) || day.toISOString().slice(0, 10) !== value.slice(0, 10)) return NaN
  return Date.parse(value)
}

export function consultationCorrectionError(entry: SignedConsultation, userId: string, now = Date.now()): string | null {
  if (entry.certificateId || /^(?:video-|virtual-)/.test(entry.id)) return 'Este registro fue generado por otro documento o consulta. No se corrige desde la evolución clínica.'
  if (!entry.signatureSeal || entry.signatureSeal.signedByUserId !== userId) return 'Solo el profesional que firmó esta evolución puede corregirla.'
  const date = validTimestamp(entry.date)
  const signed = validTimestamp(entry.correctionHistory?.[0]?.previous.signatureSeal?.signedAt || entry.signatureSeal.signedAt)
  const start = Math.min(date, signed)
  if (!Number.isFinite(start) || start > now) return 'La fecha original no es válida para habilitar una corrección.'
  if (now >= start + CORRECTION_WINDOW_MS) return 'Venció el plazo de 24 horas desde la evolución original. No puede modificarse.'
  return null
}

export function correctionSignedContent(patientId: string, patientDni: string, entry: SignedConsultation): Record<string, unknown> {
  return {
    patientId, patientDni,
    motivoConsulta: entry.motivoConsulta,
    detalleAtencion: entry.detalleAtencion,
    pensamientoMedico: entry.pensamientoMedico,
    enfermedadActual: entry.enfermedadActual,
    impresionDiagnostica: entry.impresionDiagnostica,
    planManejo: entry.planManejo,
    pesoActual: entry.pesoActual || '',
    tensionArterial: entry.tensionArterial || '',
    tallaCmEnConsulta: entry.tallaCmEnConsulta || '',
    farmacosAgregados: entry.farmacosAgregados || '',
    estudiosComplementarios: entry.estudiosComplementarios || '',
    resumenSofia: entry.resumenSofia || '',
    signatureImageDataUrl: entry.professionalSignature.signatureImageDataUrl || '',
    diagnostico: entry.diagnostico || '',
    examenFisico: entry.examenFisico || '',
    consultationId: entry.id,
    originalDate: entry.date,
    correction: entry.correction ? {
      reason: entry.correction.reason,
      previousHash: entry.correction.previousHash,
      originalDate: entry.correction.originalDate,
    } : undefined,
    professionalSignature: {
      fullName: entry.professionalSignature.fullName,
      licenseNumber: entry.professionalSignature.licenseNumber,
      signatureText: entry.professionalSignature.signatureText,
      signatureImageDataUrl: entry.professionalSignature.signatureImageDataUrl || '',
    },
  }
}

export function correctionReplacementError(original: SignedConsultation, replacement: SignedConsultation, expectedHash: string): string | null {
  const editable = new Set([
    'motivoConsulta', 'diagnostico', 'detalleAtencion', 'enfermedadActual', 'pensamientoMedico',
    'examenFisico', 'impresionDiagnostica', 'planManejo', 'pesoActual', 'tensionArterial', 'tallaCmEnConsulta',
    'farmacosAgregados', 'estudiosComplementarios', 'resumenSofia', 'signatureSeal', 'professionalSignature', 'correction', 'correctionHistory',
  ])
  if (replacement.id !== original.id || replacement.date !== original.date || typeof replacement.motivoConsulta !== 'string' || !replacement.motivoConsulta.trim()
    || typeof replacement.correction?.reason !== 'string' || !replacement.correction.reason.trim() || replacement.correction.reason.length > 1000
    || replacement.correction.previousHash !== expectedHash || replacement.correction.originalDate !== original.date) return 'La corrección debe conservar la identidad y fecha original e indicar su motivo.'
  for (const [key, value] of Object.entries(replacement)) {
    if (!editable.has(key) && JSON.stringify(value) !== JSON.stringify(Object.entries(original).find(([name]) => name === key)?.[1])) return 'No se pueden modificar vínculos ni otros datos de la evolución.'
    if (editable.has(key) && !['signatureSeal', 'professionalSignature', 'correction', 'correctionHistory'].includes(key)
      && typeof value !== 'string') return 'Los campos clínicos deben contener texto.'
  }
  for (const [key, value] of Object.entries(original)) {
    if (!editable.has(key) && JSON.stringify(value) !== JSON.stringify(Object.entries(replacement).find(([name]) => name === key)?.[1])) return 'No se pueden eliminar vínculos ni otros datos de la evolución.'
  }
  if (replacement.tallaCmEnConsulta !== original.tallaCmEnConsulta && replacement.pesoActual?.trim()) return 'La corrección conserva la talla histórica de la consulta.'
  if (replacement.signatureSeal?.hashSha256 === expectedHash) return 'La corrección requiere una nueva firma.'
  return null
}

export function consultationRevisionText(entry: SignedConsultation): string {
  return (entry.correctionHistory || []).map((revision, index) => {
    const previous = revision.previous
    return [
      `Versión anterior ${index + 1} · Corrección: ${revision.correctedAt}`,
      `Motivo de corrección: ${revision.reason}`,
      `Fecha original: ${previous.date}`,
      `Motivo de consulta: ${previous.motivoConsulta}`,
      `Enfermedad actual: ${previous.enfermedadActual || previous.detalleAtencion}`,
      `Diagnóstico: ${previous.diagnostico || ''}`,
      `Sospecha diagnóstica: ${previous.impresionDiagnostica || ''}`,
      `Tratamiento: ${previous.planManejo || ''}`,
      `Examen físico: ${previous.examenFisico || ''}`,
      `Pensamiento médico: ${previous.pensamientoMedico || ''}`,
      `Peso: ${previous.pesoActual || ''} kg · Talla histórica: ${previous.tallaCmEnConsulta || ''} cm · TA: ${previous.tensionArterial || ''}`,
      `Fármacos: ${previous.farmacosAgregados || ''}`,
      `Estudios: ${previous.estudiosComplementarios || ''}`,
      `Resumen Sofía: ${previous.resumenSofia || ''}`,
      `Firma original: ${previous.professionalSignature.fullName} · Matrícula ${previous.professionalSignature.licenseNumber} · ${previous.professionalSignature.signatureText}`,
      `Sello original: ${previous.signatureSeal?.signedAt || ''} · SHA-256 ${previous.signatureSeal?.hashSha256 || ''}`,
      `Nuevo SHA-256: ${revision.newHash}`,
    ].join('\n')
  }).join('\n\n')
}
