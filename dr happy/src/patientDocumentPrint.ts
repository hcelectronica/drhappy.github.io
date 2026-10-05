export interface PatientDocumentAttachment {
  id: string
  name: string
  type: string
  dataUrl: string
  uploadedAt: string
  category?: 'paper-record'
  transcription?: string
}

export function patientDocumentLabel(document: PatientDocumentAttachment): string {
  if (document.category !== 'paper-record') return document.name
  return document.type === 'application/pdf'
    ? 'PDF de HC en papel agregado'
    : 'Imagen de HC en papel agregada'
}

export function selectPatientPrintAttachments(
  documents: PatientDocumentAttachment[],
  optionalIds: readonly string[],
): PatientDocumentAttachment[] {
  return documents.filter(document => document.category === 'paper-record' || optionalIds.includes(document.id))
}

function escapeHtml(value: string): string {
  return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;').replaceAll("'", '&#039;')
}

function attachmentBytes(document: PatientDocumentAttachment): Uint8Array {
  const match = /^data:([^;,]+);base64,([\s\S]+)$/.exec(document.dataUrl)
  if (!match || (match[1] !== document.type && !(document.type === 'application/pdf' && match[1] === 'application/octet-stream'))) {
    throw new Error(`${document.name}: el archivo guardado no es válido.`)
  }
  try {
    return Uint8Array.from(atob(match[2]), character => character.charCodeAt(0))
  } catch {
    throw new Error(`${document.name}: no se pudo leer el archivo guardado.`)
  }
}

async function attachmentPages(document: PatientDocumentAttachment): Promise<string[]> {
  const bytes = attachmentBytes(document)
  if (/^image\/(jpeg|png|webp|gif|bmp)$/.test(document.type)) return [document.dataUrl]
  if (document.type !== 'application/pdf') {
    throw new Error(`${document.name}: solo se pueden incorporar imágenes y PDF al anexo.`)
  }
  const [pdfjs, { default: workerUrl }] = await Promise.all([
    import('pdfjs-dist/legacy/build/pdf.mjs'),
    import('pdfjs-dist/legacy/build/pdf.worker.mjs?url'),
  ])
  pdfjs.GlobalWorkerOptions.workerSrc = workerUrl
  const task = pdfjs.getDocument({ data: bytes })
  try {
    const pdf = await task.promise
    const pages: string[] = []
    for (let number = 1; number <= pdf.numPages; number += 1) {
      const page = await pdf.getPage(number)
      const original = page.getViewport({ scale: 1 })
      const viewport = page.getViewport({ scale: Math.min(2, 2200 / Math.max(original.width, original.height)) })
      const canvas = window.document.createElement('canvas')
      canvas.width = Math.max(1, Math.ceil(viewport.width))
      canvas.height = Math.max(1, Math.ceil(viewport.height))
      try {
        const context = canvas.getContext('2d')
        if (!context) throw new Error('El navegador no pudo preparar las páginas del PDF.')
        await page.render({ canvasContext: context, canvas, viewport, background: '#ffffff' }).promise
        pages.push(canvas.toDataURL('image/jpeg', 0.92))
      } finally {
        page.cleanup()
        canvas.width = 0
        canvas.height = 0
      }
    }
    return pages
  } catch (error) {
    throw new Error(`${document.name}: no se pudo preparar el PDF. Comprobá que no esté dañado ni protegido con contraseña.`, { cause: error })
  } finally {
    await task.destroy()
  }
}

export async function buildPatientAttachmentsMarkup(documents: PatientDocumentAttachment[]): Promise<string> {
  if (!documents.length) return ''
  const sections: string[] = []
  for (const document of documents) {
    const pages = await attachmentPages(document)
    const date = new Date(document.uploadedAt).toLocaleString('es-AR')
    sections.push(...pages.map((source, index) => `
      <section class="clinical-attachment-page">
        <h2>Anexo documental · ${escapeHtml(patientDocumentLabel(document))}</h2>
        <p class="muted">Agregado el ${escapeHtml(date)} · Página ${index + 1} de ${pages.length}</p>
        <p class="muted">${escapeHtml(document.name)}</p>
        <img src="${escapeHtml(source)}" alt="${escapeHtml(patientDocumentLabel(document))} · página ${index + 1}" />
      </section>`))
    if (document.transcription) {
      sections.push(`<section class="clinical-attachment-transcription">
        <h2>Transcripción revisada · ${escapeHtml(patientDocumentLabel(document))}</h2>
        <p class="muted">Documento agregado el ${escapeHtml(date)}. Se conserva también el documento digitalizado.</p>
        <p>${escapeHtml(document.transcription).replaceAll('\n', '<br />')}</p>
      </section>`)
    }
  }
  return sections.join('')
}

export async function waitForPatientPrintImages(printWindow: Window): Promise<void> {
  await Promise.all(Array.from(printWindow.document.images, async image => {
    try {
      await image.decode()
    } catch {
      throw new Error('No se pudo cargar una imagen del resumen. No se inició la impresión; intentá nuevamente.')
    }
  }))
}
