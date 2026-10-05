import test from 'node:test'
import assert from 'node:assert/strict'
import {
  buildPatientAttachmentsMarkup,
  patientDocumentLabel,
  selectPatientPrintAttachments,
  waitForPatientPrintImages,
} from '../src/patientDocumentPrint.ts'

const image = {
  id: 'paper', name: 'Anterior.jpg', type: 'image/jpeg',
  dataUrl: 'data:image/jpeg;base64,YQ==', uploadedAt: '2026-10-05T12:00:00Z',
  category: 'paper-record',
}
const optional = { ...image, id: 'study', name: 'Estudio.jpg', category: undefined }

test('old names stay stored; paper records receive human-readable labels', () => {
  assert.equal(patientDocumentLabel(image), 'Imagen de HC en papel agregada')
  assert.equal(patientDocumentLabel({ ...image, type: 'application/pdf' }), 'PDF de HC en papel agregado')
  assert.equal(patientDocumentLabel(optional), 'Estudio.jpg')
  assert.equal(image.name, 'Anterior.jpg')
})

test('paper originals always print; optional selections neither duplicate nor lose order', () => {
  const documents = [optional, image]
  assert.deepEqual(selectPatientPrintAttachments(documents, []), [image])
  assert.deepEqual(selectPatientPrintAttachments(documents, ['study', 'study', 'missing']), documents)
  assert.deepEqual(selectPatientPrintAttachments([], ['missing']), [])
})

test('annexes preserve reviewed text and escape document names', async () => {
  const markup = await buildPatientAttachmentsMarkup([{ ...image, name: '<script>.jpg', transcription: 'Revisión <segura> & fiel\nSegunda línea' }])
  assert(markup.includes('Página 1 de 1'))
  assert(markup.includes('Revisión &lt;segura&gt; &amp; fiel<br />Segunda línea'))
  assert(markup.includes('&lt;script&gt;.jpg'))
  assert(!markup.includes('<script>'))
  assert.equal(await buildPatientAttachmentsMarkup([]), '')
})

test('malformed and unsupported attachments fail explicitly, not as empty annexes', async () => {
  for (const document of [
    { ...image, dataUrl: '' },
    { ...image, dataUrl: 'data:image/jpeg;base64,!' },
    { ...image, dataUrl: 'data:text/html;base64,YQ==' },
    { ...image, type: 'application/msword', dataUrl: 'data:application/msword;base64,YQ==' },
  ]) {
    await assert.rejects(buildPatientAttachmentsMarkup([document]))
  }
})

test('printing waits for every image and surfaces decode errors', async () => {
  let finish
  let completed = false
  const pending = waitForPatientPrintImages({ document: { images: [{ decode: () => new Promise(resolve => { finish = resolve }) }] } })
    .then(() => { completed = true })
  assert.equal(completed, false)
  finish()
  await pending
  assert.equal(completed, true)
  await assert.rejects(waitForPatientPrintImages({ document: { images: [{ decode: async () => { throw new Error('bad image') } }] } }), /No se inició la impresión/)
})
