import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFImage, type PDFPage } from 'npm:pdf-lib@1.17.1'

export interface VirtualConsultPdfInput {
  consultId: string
  letterhead: string
  professionalName: string
  specialty: string
  licenseNumber: string
  signatureText: string
  signatureDataUrl?: string
  patientName: string
  patientDni: string
  question: string
  response: string
  createdAt: string
  answeredAt: string
}

// Las fuentes estándar de PDF usan WinAnsi: se reemplazan los caracteres que no puede dibujar.
function winAnsi(value: string): string {
  return value
    .replace(/[\u2018\u2019\u201A\u2032]/g, "'")
    .replace(/[\u201C\u201D\u201E\u2033]/g, '"')
    .replace(/[\u2013\u2014\u2212]/g, '-')
    .replace(/\u2026/g, '...')
    .replace(/[\u2022\u25CF\u25AA]/g, '-')
    .replace(/\t/g, '    ')
    .replace(/\r\n?/g, '\n')
    .replace(/[^\n\u0020-\u007E\u00A0-\u00FF]/g, '')
}

function wrap(text: string, font: PDFFont, size: number, width: number): string[] {
  const lines: string[] = []
  for (const paragraph of winAnsi(text).split('\n')) {
    if (!paragraph.trim()) { lines.push(''); continue }
    let line = ''
    for (const word of paragraph.split(/\s+/).filter(Boolean)) {
      const candidate = line ? `${line} ${word}` : word
      if (font.widthOfTextAtSize(candidate, size) <= width) { line = candidate; continue }
      if (line) lines.push(line)
      let rest = word
      while (font.widthOfTextAtSize(rest, size) > width) {
        let cut = rest.length - 1
        while (cut > 1 && font.widthOfTextAtSize(rest.slice(0, cut), size) > width) cut -= 1
        lines.push(rest.slice(0, cut))
        rest = rest.slice(cut)
      }
      line = rest
    }
    lines.push(line)
  }
  return lines
}

function formatDate(value: string): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  return new Intl.DateTimeFormat('es-AR', { dateStyle: 'long', timeStyle: 'short', timeZone: 'America/Argentina/Buenos_Aires' }).format(date)
}

async function embedSignature(pdf: PDFDocument, dataUrl?: string): Promise<PDFImage | null> {
  const match = dataUrl?.match(/^data:image\/(png|jpe?g);base64,([A-Za-z0-9+/=\s]+)$/i)
  if (!match) return null
  try {
    const bytes = Uint8Array.from(atob(match[2].replace(/\s/g, '')), (char) => char.charCodeAt(0))
    return match[1].toLowerCase() === 'png' ? await pdf.embedPng(bytes) : await pdf.embedJpg(bytes)
  } catch {
    return null
  }
}

export async function buildVirtualConsultPdf(input: VirtualConsultPdfInput): Promise<Uint8Array> {
  const pdf = await PDFDocument.create()
  pdf.setTitle('Devolucion de consulta virtual asistida')
  pdf.setAuthor(winAnsi(input.professionalName))
  pdf.setProducer('Dr Happy')
  const regular = await pdf.embedFont(StandardFonts.Helvetica)
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold)
  const teal = rgb(0.06, 0.46, 0.43)
  const ink = rgb(0.06, 0.09, 0.16)
  const muted = rgb(0.36, 0.42, 0.5)
  const margin = 54
  const pageWidth = 595.28
  const pageHeight = 841.89
  const contentWidth = pageWidth - margin * 2
  let page: PDFPage = pdf.addPage([pageWidth, pageHeight])
  let y = pageHeight - margin

  const ensure = (height: number) => {
    if (y - height >= margin + 20) return
    page = pdf.addPage([pageWidth, pageHeight])
    y = pageHeight - margin
  }
  const write = (text: string, options: { font?: PDFFont; size?: number; color?: ReturnType<typeof rgb>; gap?: number } = {}) => {
    const font = options.font ?? regular
    const size = options.size ?? 10.5
    const lineHeight = size * 1.42
    for (const line of wrap(text, font, size, contentWidth)) {
      ensure(lineHeight)
      if (line) page.drawText(line, { x: margin, y: y - size, size, font, color: options.color ?? ink })
      y -= lineHeight
    }
    y -= options.gap ?? 0
  }
  const section = (title: string) => {
    ensure(48)
    y -= 6
    page.drawText(winAnsi(title.toUpperCase()), { x: margin, y: y - 9, size: 9, font: bold, color: teal })
    y -= 15
    page.drawLine({ start: { x: margin, y }, end: { x: pageWidth - margin, y }, thickness: 0.6, color: rgb(0.85, 0.9, 0.94) })
    y -= 9
  }

  page.drawRectangle({ x: 0, y: pageHeight - 8, width: pageWidth, height: 8, color: teal })
  write(input.letterhead || input.professionalName, { font: bold, size: 16 })
  const subtitle = [input.specialty, input.licenseNumber ? `Matrícula ${input.licenseNumber}` : ''].filter(Boolean).join(' · ')
  if (subtitle) write(subtitle, { size: 10, color: muted })
  y -= 10
  write('Devolución de consulta virtual asistida', { font: bold, size: 14, color: teal, gap: 2 })
  write(`Consulta N° ${input.consultId.slice(0, 8).toUpperCase()}`, { size: 9, color: muted, gap: 6 })

  section('Paciente')
  write(`${input.patientName} · DNI ${input.patientDni}`, { font: bold })
  write(`Consulta recibida: ${formatDate(input.createdAt)}`, { size: 9.5, color: muted })
  write(`Devolución emitida: ${formatDate(input.answeredAt)}`, { size: 9.5, color: muted, gap: 4 })

  section('Consulta del paciente')
  write(input.question, { gap: 4 })

  section('Devolución')
  write(input.response, { gap: 8 })

  const notice = 'Orientación elaborada con asistencia de inteligencia artificial (Sofía) y revisada y visada por el profesional firmante. Es una orientación a distancia basada en la información enviada: no reemplaza la consulta presencial ni constituye un diagnóstico definitivo. Ante síntomas de alarma, concurrí a la guardia más cercana o llamá al 107.'
  const noticeLines = wrap(notice, regular, 8.8, contentWidth - 20)
  const noticeHeight = noticeLines.length * 12.5 + 14
  ensure(noticeHeight + 8)
  page.drawRectangle({ x: margin, y: y - noticeHeight, width: contentWidth, height: noticeHeight, color: rgb(0.93, 0.99, 0.96), borderColor: rgb(0.6, 0.85, 0.78), borderWidth: 0.8 })
  let noticeY = y - 7
  for (const line of noticeLines) {
    page.drawText(line, { x: margin + 10, y: noticeY - 8.8, size: 8.8, font: regular, color: rgb(0.02, 0.37, 0.27) })
    noticeY -= 12.5
  }
  y -= noticeHeight + 18

  const signature = await embedSignature(pdf, input.signatureDataUrl)
  const scale = signature ? Math.min(160 / signature.width, 60 / signature.height) : 0
  ensure((signature ? signature.height * scale : 30) + 80)
  const signatureX = pageWidth - margin - 220
  if (signature) {
    page.drawImage(signature, { x: signatureX + 30, y: y - signature.height * scale, width: signature.width * scale, height: signature.height * scale })
    y -= signature.height * scale + 4
  } else {
    y -= 30
  }
  page.drawLine({ start: { x: signatureX, y }, end: { x: pageWidth - margin, y }, thickness: 0.7, color: muted })
  y -= 6
  const signatureLines = [
    { text: 'Revisado y visado por', font: regular, size: 8.5, color: muted },
    { text: input.professionalName, font: bold, size: 10.5, color: ink },
    ...(input.licenseNumber ? [{ text: `Matrícula ${input.licenseNumber}`, font: regular, size: 9.5, color: ink }] : []),
    ...(input.signatureText ? [{ text: input.signatureText, font: regular, size: 9, color: muted }] : []),
  ]
  for (const line of signatureLines) {
    page.drawText(winAnsi(line.text).slice(0, 70), { x: signatureX, y: y - line.size, size: line.size, font: line.font, color: line.color })
    y -= line.size * 1.5
  }

  for (const current of pdf.getPages()) {
    current.drawText(winAnsi('Documento generado con Dr Happy · drhappy.com.ar · Consulta virtual asistida por IA con revisión profesional'), {
      x: margin, y: 28, size: 7.5, font: regular, color: muted,
    })
  }
  return await pdf.save()
}
