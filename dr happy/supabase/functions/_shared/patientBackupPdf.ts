import { PDFDocument } from 'npm:pdf-lib@1.17.1'
import { Image } from 'npm:imagescript@3.1.0'
import { imageSize } from 'npm:image-size@2.0.2'

export const MAX_BACKUP_PDF_BYTES = 12 * 1024 * 1024
export async function patientBackupPdf(bytes: Uint8Array, mime: string): Promise<Uint8Array> {
  if (!bytes.length || bytes.length > 10 * 1024 * 1024) throw new Error('El archivo original está vacío o supera 10 MB. No se eliminó la cuenta.')
  // Existing PDFs remain byte-identical, preserving any embedded signatures.
  if (mime === 'application/pdf') {
    if (!new TextDecoder().decode(bytes.subarray(0, 1024)).includes('%PDF-')) throw new Error('El archivo no contiene un PDF válido. No se eliminó la cuenta.')
    return bytes
  }
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(mime)) throw new Error('El archivo no puede convertirse a PDF. No se eliminó la cuenta.')
  const size = imageSize(bytes)
  if (!size.width || !size.height || size.width * size.height > 16_000_000) throw new Error('La imagen supera el límite seguro de conversión (16 megapíxeles). No se eliminó la cuenta; requiere revisión manual.')
  if (size.type === 'webp' && new TextDecoder().decode(bytes.subarray(12, 16)) === 'VP8X' && (bytes[20] & 2)) throw new Error('La imagen es animada y requiere revisión antes de convertirla. No se eliminó la cuenta.')
  const pdf = await PDFDocument.create()
  const decoded = await Image.decode(bytes)
  const image = await pdf.embedPng(await decoded.encode())
  const scale = Math.min(535 / image.width, 782 / image.height)
  const page = pdf.addPage([595, 842])
  page.drawImage(image, { x: (595 - image.width * scale) / 2, y: (842 - image.height * scale) / 2, width: image.width * scale, height: image.height * scale })
  const result = await pdf.save()
  if (result.length > MAX_BACKUP_PDF_BYTES) throw new Error('El PDF convertido supera el tamaño seguro del adjunto. No se eliminó la cuenta; requiere revisión manual.')
  return result
}
export function backupPdfFilename(title: string, id: string): string {
  const name = title.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-zA-Z0-9 _-]/g, '').trim().slice(0, 70)
  return `${name || 'Estudio'}-${id.slice(0, 8)}.pdf`
}
export function pdfBase64(bytes: Uint8Array): string {
  let binary = ''
  for (let i = 0; i < bytes.length; i += 8192) binary += String.fromCharCode(...bytes.subarray(i, i + 8192))
  return btoa(binary)
}
