type JsonRecord = Record<string, unknown>

function record(value: unknown): JsonRecord | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as JsonRecord : null
}

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function escapeHtml(value: string): string {
  return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;').replaceAll("'", '&#39;')
}

export class InstructionsError extends Error {
  status: number
  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

export function buildConsultationInstructions(params: {
  professionalId: string
  patients: unknown
  patientId: string
  consultationId: string
  expectedEmail: string
}): { to: string; subject: string; text: string; type: 'custom'; templateData: { message: string } } {
  const patient = (Array.isArray(params.patients) ? params.patients : [])
    .map(record).find(value => value?.id === params.patientId)
  if (!patient) throw new InstructionsError(404, 'La ficha no está en tu espacio de trabajo.')
  const entry = (Array.isArray(patient.consultations) ? patient.consultations : [])
    .map(record).find(value => value?.id === params.consultationId)
  if (!entry) throw new InstructionsError(409, 'La evolución todavía no está guardada en la nube. Guardala y volvé a intentar.')
  const seal = record(entry.signatureSeal)
  if (patient.ownerUserId !== params.professionalId && seal?.signedByUserId !== params.professionalId) {
    throw new InstructionsError(403, 'Solo podés enviar tus propias evoluciones en una ficha compartida.')
  }
  const email = text(patient.email)
  if (email.length > 254 || !/^[^\s@<>;,]+@[^\s@<>;,]+\.[^\s@<>;,]+$/.test(email)) {
    throw new InstructionsError(400, 'El paciente no tiene un email válido. Completalo y guardá su ficha.')
  }
  if (email.toLowerCase() !== params.expectedEmail.trim().toLowerCase()) {
    throw new InstructionsError(409, 'El email de la ficha cambió. Revisá el destinatario antes de enviar.')
  }
  const sections = [
    ['Estudios complementarios solicitados', text(entry.estudiosComplementarios)],
    ['Tratamiento e indicaciones', text(entry.planManejo)],
    ['Fármacos y forma de tomarlos (pauta indicada por el profesional)', text(entry.farmacosAgregados)],
  ].filter(([, value]) => Boolean(value))
  if (!sections.length) throw new InstructionsError(400, 'Esta evolución no tiene tratamiento, fármacos ni estudios para enviar.')
  if (sections.some(([, value]) => value.length > 20_000)) {
    throw new InstructionsError(400, 'Las indicaciones son demasiado extensas para enviarlas por correo. No se recortó el contenido.')
  }
  const date = new Date(text(entry.date))
  if (!Number.isFinite(date.getTime())) throw new InstructionsError(400, 'La evolución no tiene una fecha válida.')
  const dateLabel = new Intl.DateTimeFormat('es-AR', {
    timeZone: 'America/Argentina/Buenos_Aires', day: '2-digit', month: '2-digit', year: 'numeric',
  }).format(date)
  const professional = record(entry.professionalSignature)
  const signature = [text(professional?.fullName), text(professional?.licenseNumber) ? `Matrícula ${text(professional?.licenseNumber)}` : '']
    .filter(Boolean).join(' · ')
  const heading = `Indicaciones de tu consulta del ${dateLabel}`
  const notice = 'Este correo es un recordatorio de las indicaciones registradas por tu profesional. No reemplaza una receta ni una orden de estudios.'
  return {
    to: email,
    subject: `Tratamiento y estudios solicitados · Consulta del ${dateLabel}`,
    type: 'custom',
    text: [heading, ...sections.map(([label, value]) => `${label}:\n${value}`), signature, notice].filter(Boolean).join('\n\n'),
    templateData: {
      message: `<p>${escapeHtml(heading)}</p>${sections.map(([label, value]) =>
        `<h3>${escapeHtml(label)}</h3><p style="white-space:pre-wrap">${escapeHtml(value).replaceAll('\n', '<br>')}</p>`).join('')}
        ${signature ? `<p>${escapeHtml(signature)}</p>` : ''}<p>${notice}</p>`,
    },
  }
}

export async function deliverConsultationInstructions(
  payload: ReturnType<typeof buildConsultationInstructions>,
  send: (payload: ReturnType<typeof buildConsultationInstructions>) => Promise<Response>,
): Promise<void> {
  let response: Response
  let result: unknown
  try {
    response = await send(payload)
    result = await response.json()
  } catch {
    throw new InstructionsError(502, 'No se pudo confirmar el envío. Verificá con el paciente antes de reintentar; no se reenvía automáticamente.')
  }
  if (!response.ok || record(result)?.success !== true) {
    throw new InstructionsError(502, 'El servicio de correo no confirmó el envío. Verificá con el paciente antes de reintentar.')
  }
}
