import assert from 'node:assert/strict'
import { PDFDocument } from 'npm:pdf-lib@1.17.1'
import { Image } from 'npm:imagescript@3.1.0'
import { patientBackupPdf, backupPdfFilename, pdfBase64 } from '../supabase/functions/_shared/patientBackupPdf.ts'

Deno.test('Original PDF bytes stay identical, including multi-page documents', async () => {
  const pdf = await PDFDocument.create()
  pdf.addPage(); pdf.addPage()
  const bytes = await pdf.save()
  assert.strictEqual(await patientBackupPdf(bytes, 'application/pdf'), bytes)
  assert.equal((await PDFDocument.load(bytes)).getPageCount(), 2)
})
Deno.test('PNG, JPEG and WEBP become real readable PDFs with unchanged aspect ratio', async () => {
  const image = new Image(120, 80).fill(0x146bffff)
  for (const [mime, bytes] of [
    ['image/png', await image.encode()], ['image/jpeg', await image.encodeJPEG(95)], ['image/webp', await image.encodeWebP()],
  ] as const) {
    const bytesPdf = await patientBackupPdf(bytes, mime)
    const pdf = await PDFDocument.load(bytesPdf)
    assert.equal(pdf.getPageCount(), 1)
    assert.ok(bytesPdf.length > 100)
    assert.equal(pdf.getPage(0).getWidth(), 595)
    assert.equal(pdf.getPage(0).getHeight(), 842)
    assert.deepEqual(Uint8Array.from(atob(pdfBase64(bytesPdf)), c => c.charCodeAt(0)), bytesPdf)
  }
})
Deno.test('Invalid or oversized files cannot be treated as a successful backup', async () => {
  await assert.rejects(() => patientBackupPdf(new Uint8Array(), 'image/png'))
  await assert.rejects(() => patientBackupPdf(new Uint8Array(10 * 1024 * 1024 + 1), 'application/pdf'))
  await assert.rejects(() => patientBackupPdf(new TextEncoder().encode('not a PDF'), 'application/pdf'))
  await assert.rejects(() => patientBackupPdf(new Uint8Array([1, 2, 3]), 'image/webp'))
  await assert.rejects(() => patientBackupPdf(new Uint8Array([1]), 'application/msword'))
  const oversized = await new Image(2, 2).fill(0xffffffff).encode()
  new DataView(oversized.buffer, oversized.byteOffset).setUint32(16, 100000)
  new DataView(oversized.buffer, oversized.byteOffset).setUint32(20, 100000)
  await assert.rejects(() => patientBackupPdf(oversized, 'image/png'), /16 megapíxeles/)
  assert.equal(backupPdfFilename('../Estudio: corazón.pdf\r\n', '12345678-1234'), 'Estudio corazonpdf-12345678.pdf')
})
