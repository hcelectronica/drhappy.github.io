import { BarcodeFormat, EncodeHintType, QRCodeWriter } from '@zxing/library'
import type { SignatureSeal } from './signatureSeal'

export interface CertificateEntry {
  id: string
  issuedAt: string
  certificateDate: string
  letterhead: string
  diagnostico: string
  body: string
  patient: {
    fullName: string
    dni: string
    birthDate: string
    obraSocial: string
    plan: string
    numeroAfiliado: string
  }
  professional: {
    fullName: string
    licenseNumber: string
    specialty: string
    signatureImageDataUrl: string
  }
  signatureSeal: SignatureSeal
}

// A4 a ~194 ppp: nítido en pantalla e impresión sin generar archivos pesados.
const PAGE_WIDTH = 1600
const PAGE_HEIGHT = Math.round((PAGE_WIDTH * 297) / 210)
const MARGIN = 120
const CONTENT_WIDTH = PAGE_WIDTH - MARGIN * 2
const DISPLAY_FONT = '"Plus Jakarta Sans", "DM Sans", Arial, sans-serif'
const BODY_FONT = '"DM Sans", Arial, sans-serif'

const INK = '#0f172a'
const MUTED = '#64748b'
const ACCENT = '#0f766e'
const ACCENT_BLUE = '#1d4ed8'

function stripAccents(value: string): string {
  return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '')
}

export function formatCertificateDate(isoDate: string): string {
  const [year, month, day] = isoDate.slice(0, 10).split('-').map(Number)
  if (!year || !month || !day) return isoDate
  return new Date(year, month - 1, day).toLocaleDateString('es-AR', { day: 'numeric', month: 'long', year: 'numeric' })
}

export function certificateFileName(entry: CertificateEntry): string {
  const name = stripAccents(entry.patient.fullName).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
  return `certificado-${name || 'paciente'}-${entry.certificateDate}.pdf`
}

export function certificateSignedContent(entry: Pick<CertificateEntry, 'certificateDate' | 'letterhead' | 'diagnostico' | 'body' | 'patient'>): Record<string, unknown> {
  return {
    type: 'certificado-medico',
    certificateDate: entry.certificateDate,
    letterhead: entry.letterhead,
    diagnostico: entry.diagnostico,
    body: entry.body,
    patientDni: entry.patient.dni,
    patientName: entry.patient.fullName,
  }
}

function buildValidationText(entry: CertificateEntry): string {
  return stripAccents([
    'DR HAPPY - CERTIFICADO MEDICO',
    `ID: ${entry.id}`,
    `Fecha: ${entry.certificateDate}`,
    `Paciente: ${entry.patient.fullName} - DNI ${entry.patient.dni || 'S/D'}`,
    `Profesional: ${entry.professional.fullName} - Mat. ${entry.professional.licenseNumber}`,
    `Firmado: ${entry.signatureSeal.signedAt}`,
    `SHA-256: ${entry.signatureSeal.hashSha256}`,
  ].join('\n'))
}

function drawQrCode(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, size: number): void {
  const hints = new Map<EncodeHintType, unknown>([
    [EncodeHintType.MARGIN, 0],
    [EncodeHintType.ERROR_CORRECTION, 'M'],
  ])
  const matrix = new QRCodeWriter().encode(text, BarcodeFormat.QR_CODE, 0, 0, hints as Map<EncodeHintType, never>)
  const modules = matrix.getWidth()
  const cell = Math.floor(size / modules)
  const drawn = cell * modules
  const offset = Math.floor((size - drawn) / 2)
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(x, y, size, size)
  ctx.fillStyle = INK
  for (let row = 0; row < modules; row += 1) {
    for (let column = 0; column < modules; column += 1) {
      if (matrix.get(column, row)) ctx.fillRect(x + offset + column * cell, y + offset + row * cell, cell, cell)
    }
  }
}

export function buildQrDataUrl(text: string, size = 360): string {
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const ctx = canvas.getContext('2d')
  if (!ctx) return ''
  drawQrCode(ctx, text, 0, 0, size)
  return canvas.toDataURL('image/png')
}

function wrapText(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string[] {
  const lines: string[] = []
  for (const paragraph of text.split(/\r?\n/)) {
    const words = paragraph.split(/\s+/).filter(Boolean)
    if (!words.length) {
      lines.push('')
      continue
    }
    let current = ''
    for (const word of words) {
      const candidate = current ? `${current} ${word}` : word
      if (ctx.measureText(candidate).width <= maxWidth || !current) {
        current = candidate
      } else {
        lines.push(current)
        current = word
      }
    }
    lines.push(current)
  }
  return lines
}

function roundedRect(ctx: CanvasRenderingContext2D, x: number, y: number, width: number, height: number, radius: number): void {
  ctx.beginPath()
  ctx.moveTo(x + radius, y)
  ctx.arcTo(x + width, y, x + width, y + height, radius)
  ctx.arcTo(x + width, y + height, x, y + height, radius)
  ctx.arcTo(x, y + height, x, y, radius)
  ctx.arcTo(x, y, x + width, y, radius)
  ctx.closePath()
}

function setLetterSpacing(ctx: CanvasRenderingContext2D, value: string): void {
  if ('letterSpacing' in ctx) (ctx as CanvasRenderingContext2D & { letterSpacing: string }).letterSpacing = value
}

function loadImage(src: string): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    if (!src) {
      resolve(null)
      return
    }
    const image = new Image()
    image.onload = () => resolve(image)
    image.onerror = () => resolve(null)
    image.src = src
  })
}

async function ensureFonts(): Promise<void> {
  if (!('fonts' in document)) return
  await Promise.all([
    document.fonts.load('800 56px "Plus Jakarta Sans"'),
    document.fonts.load('700 32px "DM Sans"'),
    document.fonts.load('400 32px "DM Sans"'),
  ]).catch(() => undefined)
}

function drawLabel(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, color = MUTED): void {
  ctx.font = `700 21px ${BODY_FONT}`
  ctx.fillStyle = color
  setLetterSpacing(ctx, '3px')
  ctx.fillText(text.toUpperCase(), x, y)
  setLetterSpacing(ctx, '0px')
}

export async function renderCertificateCanvas(entry: CertificateEntry): Promise<HTMLCanvasElement> {
  await ensureFonts()
  const canvas = document.createElement('canvas')
  canvas.width = PAGE_WIDTH
  canvas.height = PAGE_HEIGHT
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('El navegador no permite generar el certificado.')
  ctx.textBaseline = 'alphabetic'

  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, PAGE_WIDTH, PAGE_HEIGHT)

  // Banda superior de marca.
  const band = ctx.createLinearGradient(0, 0, PAGE_WIDTH, 0)
  band.addColorStop(0, ACCENT)
  band.addColorStop(1, ACCENT_BLUE)
  ctx.fillStyle = band
  ctx.fillRect(0, 0, PAGE_WIDTH, 22)

  // Membrete.
  let letterheadSize = 60
  ctx.fillStyle = '#0f2944'
  do {
    ctx.font = `800 ${letterheadSize}px ${DISPLAY_FONT}`
    letterheadSize -= 2
  } while (ctx.measureText(entry.letterhead).width > CONTENT_WIDTH && letterheadSize > 30)
  ctx.fillText(entry.letterhead, MARGIN, 165)

  ctx.font = `500 29px ${BODY_FONT}`
  ctx.fillStyle = '#475569'
  const professionalLine = [entry.professional.fullName, entry.professional.specialty, `Matrícula ${entry.professional.licenseNumber}`]
    .filter((part) => part && part.trim())
    .join('  ·  ')
  ctx.fillText(professionalLine, MARGIN, 218)

  ctx.fillStyle = '#e2e8f0'
  ctx.fillRect(MARGIN, 258, CONTENT_WIDTH, 3)

  // Ficha del paciente.
  const cardY = 320
  const cardHeight = 250
  roundedRect(ctx, MARGIN, cardY, CONTENT_WIDTH, cardHeight, 24)
  ctx.fillStyle = '#f3f8fc'
  ctx.fill()
  ctx.lineWidth = 2
  ctx.strokeStyle = '#d5e3f0'
  ctx.stroke()
  ctx.fillStyle = ACCENT
  ctx.fillRect(MARGIN, cardY + 24, 8, cardHeight - 48)

  const leftColumn = MARGIN + 50
  const rightColumn = MARGIN + CONTENT_WIDTH / 2 + 30
  const obraSocial = [entry.patient.obraSocial, entry.patient.plan].filter((part) => part && part.trim()).join(' · ')
  const fields: Array<[string, string, number, number]> = [
    ['Paciente', entry.patient.fullName, leftColumn, cardY + 70],
    ['DNI', entry.patient.dni || 'No informado', rightColumn, cardY + 70],
    ['Fecha de nacimiento', entry.patient.birthDate ? formatCertificateDate(entry.patient.birthDate) : 'No informada', leftColumn, cardY + 168],
    ['Obra social', obraSocial ? `${obraSocial}${entry.patient.numeroAfiliado ? `  ·  N° ${entry.patient.numeroAfiliado}` : ''}` : 'Particular', rightColumn, cardY + 168],
  ]
  for (const [label, value, x, y] of fields) {
    drawLabel(ctx, label, x, y)
    ctx.font = `700 33px ${BODY_FONT}`
    ctx.fillStyle = INK
    let fittedValue = value
    while (ctx.measureText(fittedValue).width > CONTENT_WIDTH / 2 - 90 && fittedValue.length > 4) {
      fittedValue = `${fittedValue.slice(0, -2).trimEnd()}…`
    }
    ctx.fillText(fittedValue, x, y + 46)
  }

  // Diagnóstico.
  let cursorY = cardY + cardHeight + 90
  drawLabel(ctx, 'Diagnóstico', MARGIN, cursorY, ACCENT)
  ctx.font = `700 34px ${BODY_FONT}`
  ctx.fillStyle = INK
  const diagnosisLines = wrapText(ctx, entry.diagnostico, CONTENT_WIDTH).slice(0, 2)
  for (const line of diagnosisLines) {
    cursorY += 48
    ctx.fillText(line, MARGIN, cursorY)
  }

  // R/p.
  cursorY += 100
  ctx.font = `italic 700 56px Georgia, "Times New Roman", serif`
  ctx.fillStyle = ACCENT_BLUE
  ctx.fillText('R/p', MARGIN, cursorY)
  cursorY += 30

  const bodyBottom = 1660
  let bodySize = 34
  let bodyLines: string[] = []
  let lineHeight = 54
  for (; bodySize >= 22; bodySize -= 2) {
    ctx.font = `400 ${bodySize}px ${BODY_FONT}`
    lineHeight = Math.round(bodySize * 1.6)
    bodyLines = wrapText(ctx, entry.body, CONTENT_WIDTH - 40)
    if (cursorY + bodyLines.length * lineHeight <= bodyBottom) break
  }
  ctx.fillStyle = '#1e293b'
  for (const line of bodyLines) {
    cursorY += lineHeight
    if (cursorY > bodyBottom) break
    ctx.fillText(line, MARGIN + 40, cursorY)
  }

  // Lugar y fecha.
  ctx.font = `600 30px ${BODY_FONT}`
  ctx.fillStyle = INK
  ctx.fillText(`Fecha: ${formatCertificateDate(entry.certificateDate)}`, MARGIN, 1745)

  // Firma manuscrita, aclaración y matrícula.
  const signatureCenter = MARGIN + CONTENT_WIDTH - 290
  const signatureImage = await loadImage(entry.professional.signatureImageDataUrl)
  if (signatureImage) {
    const boxWidth = 500
    const boxHeight = 190
    const ratio = Math.min(boxWidth / signatureImage.width, boxHeight / signatureImage.height)
    const width = signatureImage.width * ratio
    const height = signatureImage.height * ratio
    ctx.drawImage(signatureImage, signatureCenter - width / 2, 1960 - height, width, height)
  }
  ctx.fillStyle = '#334155'
  ctx.fillRect(signatureCenter - 270, 1975, 540, 3)
  ctx.textAlign = 'center'
  ctx.font = `700 32px ${BODY_FONT}`
  ctx.fillStyle = INK
  ctx.fillText(entry.professional.fullName, signatureCenter, 2022)
  ctx.font = `600 26px ${BODY_FONT}`
  ctx.fillStyle = '#334155'
  ctx.fillText(`Matrícula N° ${entry.professional.licenseNumber}`, signatureCenter, 2062)
  if (entry.professional.specialty) {
    ctx.font = `500 24px ${BODY_FONT}`
    ctx.fillStyle = MUTED
    ctx.fillText(entry.professional.specialty, signatureCenter, 2098)
  }
  ctx.textAlign = 'left'

  // Validación: QR + sello de firma electrónica.
  const qrSize = 250
  const qrY = 1800
  roundedRect(ctx, MARGIN - 12, qrY - 12, qrSize + 24, qrSize + 24, 18)
  ctx.fillStyle = '#ffffff'
  ctx.fill()
  ctx.strokeStyle = '#d5e3f0'
  ctx.lineWidth = 2
  ctx.stroke()
  drawQrCode(ctx, buildValidationText(entry), MARGIN, qrY, qrSize)

  const sealX = MARGIN + qrSize + 40
  ctx.font = `700 23px ${BODY_FONT}`
  ctx.fillStyle = '#15803d'
  ctx.fillText('Firma electrónica verificable', sealX, qrY + 34)
  ctx.font = `500 20px ${BODY_FONT}`
  ctx.fillStyle = '#475569'
  ctx.fillText(`Firmado: ${new Date(entry.signatureSeal.signedAt).toLocaleString('es-AR')}`, sealX, qrY + 72)
  ctx.font = `500 18px "Consolas", "Courier New", monospace`
  ctx.fillStyle = '#334155'
  const hash = entry.signatureSeal.hashSha256
  ctx.fillText(`SHA-256 ${hash.slice(0, 32)}`, sealX, qrY + 110)
  ctx.fillText(hash.slice(32), sealX, qrY + 136)
  ctx.font = `500 19px ${BODY_FONT}`
  ctx.fillStyle = MUTED
  ctx.fillText(`ID ${entry.id.slice(0, 18)}…`, sealX, qrY + 176)
  ctx.fillText('Escaneá el QR para validar los datos.', sealX, qrY + 206)

  // Pie.
  ctx.fillStyle = '#e2e8f0'
  ctx.fillRect(MARGIN, PAGE_HEIGHT - 110, CONTENT_WIDTH, 2)
  ctx.textAlign = 'center'
  ctx.font = `500 21px ${BODY_FONT}`
  ctx.fillStyle = '#94a3b8'
  ctx.fillText('Documento emitido con Dr Happy · drhappy.com.ar', PAGE_WIDTH / 2, PAGE_HEIGHT - 66)
  ctx.textAlign = 'left'
  ctx.fillStyle = band
  ctx.fillRect(0, PAGE_HEIGHT - 14, PAGE_WIDTH, 14)

  return canvas
}

function base64ToBytes(base64: string): Uint8Array {
  const binary = atob(base64)
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index)
  return bytes
}

// PDF mínimo de una página A4 con la imagen del certificado (sin dependencias externas).
function buildPdfFromJpeg(jpeg: Uint8Array, width: number, height: number, title: string): Blob {
  const encoder = new TextEncoder()
  const chunks: Uint8Array[] = []
  const offsets: number[] = []
  let length = 0
  const push = (chunk: Uint8Array | string) => {
    const bytes = typeof chunk === 'string' ? encoder.encode(chunk) : chunk
    chunks.push(bytes)
    length += bytes.length
  }
  const startObject = (id: number) => {
    offsets[id] = length
    push(`${id} 0 obj\n`)
  }
  const pageWidth = 595.28
  const pageHeight = 841.89
  const content = `q ${pageWidth} 0 0 ${pageHeight} 0 0 cm /Im0 Do Q`
  const safeTitle = stripAccents(title).replace(/[()\\]/g, '')

  push('%PDF-1.4\n%\u00e2\u00e3\u00cf\u00d3\n')
  startObject(1)
  push('<< /Type /Catalog /Pages 2 0 R >>\nendobj\n')
  startObject(2)
  push('<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n')
  startObject(3)
  push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pageWidth} ${pageHeight}] /Resources << /XObject << /Im0 4 0 R >> >> /Contents 5 0 R >>\nendobj\n`)
  startObject(4)
  push(`<< /Type /XObject /Subtype /Image /Width ${width} /Height ${height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpeg.length} >>\nstream\n`)
  push(jpeg)
  push('\nendstream\nendobj\n')
  startObject(5)
  push(`<< /Length ${content.length} >>\nstream\n${content}\nendstream\nendobj\n`)
  startObject(6)
  push(`<< /Title (${safeTitle}) /Producer (Dr Happy) >>\nendobj\n`)

  const xrefOffset = length
  push(`xref\n0 7\n0000000000 65535 f \n`)
  for (let id = 1; id <= 6; id += 1) push(`${String(offsets[id]).padStart(10, '0')} 00000 n \n`)
  push(`trailer\n<< /Size 7 /Root 1 0 R /Info 6 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`)
  return new Blob(chunks as BlobPart[], { type: 'application/pdf' })
}

export async function buildCertificatePdf(entry: CertificateEntry): Promise<Blob> {
  const canvas = await renderCertificateCanvas(entry)
  const jpegBase64 = canvas.toDataURL('image/jpeg', 0.9).split(',')[1] ?? ''
  return buildPdfFromJpeg(base64ToBytes(jpegBase64), canvas.width, canvas.height, `Certificado medico - ${entry.patient.fullName}`)
}

export function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result || '').split(',')[1] ?? '')
    reader.onerror = () => reject(new Error('No se pudo preparar el archivo.'))
    reader.readAsDataURL(blob)
  })
}
