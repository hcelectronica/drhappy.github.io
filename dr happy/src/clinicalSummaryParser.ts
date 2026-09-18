export interface ParsedClinicalSummary {
  motivo: string
  enfermedadActual: string
  examenFisico: string
  impresionDiagnostica: string
  planManejo: string
  antecedentes: string
  pensamiento: string
}

export function normalizeConsultationReason(value: string): string {
  const cleaned = value
    .replace(/\*\*/g, '')
    .replace(/^[-•#\s]+/, '')
    .split(/[\n.;:!?]/)[0]
    .trim()
  return cleaned.split(/\s+/).filter(Boolean).slice(0, 4).join(' ')
}

export function parseClinicalSummary(reply: string): ParsedClinicalSummary {
  const normalized = reply
    .trim()
    .replace(/\r/g, '')
    .replace(/\*\*/g, '')
    .replace(/\s+(MOTIVO:|ENFERMEDAD ACTUAL:|EXAMEN FÍSICO:|IMPRESIÓN DIAGNÓSTICA:|PLAN DE MANEJO:|RESUMEN(?: DE HOY)?:|ANTECEDENTES RELEVANTES:|PENSAMIENTO:)/gi, '\n$1')
  const read = (pattern: RegExp): string => normalized.match(pattern)?.[1]?.trim() || ''
  return {
    motivo: normalizeConsultationReason(read(/MOTIVO:\s*([\s\S]*?)(?=\n\s*(?:ENFERMEDAD ACTUAL|RESUMEN(?: DE HOY)?):|$)/i)),
    enfermedadActual: read(/ENFERMEDAD ACTUAL:\s*([\s\S]*?)(?=\n\s*EXAMEN FÍSICO:|$)/i) || read(/RESUMEN(?: DE HOY)?:\s*([\s\S]*?)(?=\n\s*(?:ANTECEDENTES RELEVANTES|PENSAMIENTO):|$)/i),
    examenFisico: read(/EXAMEN FÍSICO:\s*([\s\S]*?)(?=\n\s*IMPRESIÓN DIAGNÓSTICA:|$)/i),
    impresionDiagnostica: read(/IMPRESIÓN DIAGNÓSTICA:\s*([\s\S]*?)(?=\n\s*PLAN DE MANEJO:|$)/i),
    planManejo: read(/PLAN DE MANEJO:\s*([\s\S]*?)(?=\n\s*(?:ANTECEDENTES RELEVANTES|PENSAMIENTO):|$)/i),
    antecedentes: read(/ANTECEDENTES RELEVANTES:\s*([\s\S]*?)(?=\n\s*PENSAMIENTO:|$)/i),
    pensamiento: read(/PENSAMIENTO:\s*([\s\S]*)$/i),
  }
}
