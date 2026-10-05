import test from 'node:test'
import assert from 'node:assert/strict'
import { createTranscriber, formatClock, transcriptText } from './transcription.js'

function fakeEnvironment({ availability = { 'es-AR': 'available' }, install = true, local = true, startThrows = false } = {}) {
  let clock = 1_000_000
  const timers = []
  const instances = []
  class FakeRecognition {
    constructor() { instances.push(this); this.stopped = false }
    start(track) { if (startThrows) throw new TypeError('track unsupported'); this.track = track }
    stop() { this.stopped = true }
    static async available({ langs, processLocally }) {
      assert.equal(processLocally, true)
      return availability[langs[0]] ?? 'unavailable'
    }
    static async install({ langs, processLocally }) {
      assert.equal(processLocally, true)
      FakeRecognition.installed = langs[0]
      return install
    }
  }
  if (local) FakeRecognition.prototype.processLocally = false
  const env = {
    Recognition: FakeRecognition,
    instances,
    timers,
    advance(ms) { clock += ms },
    runTimers() { const due = timers.splice(0); for (const timer of due) if (!timer.cleared) timer.callback() },
    options: {
      Recognition: FakeRecognition,
      now: () => clock,
      setTimer: (callback, ms) => { const timer = { callback, ms, cleared: false }; timers.push(timer); return timer },
      clearTimer: timer => { timer.cleared = true },
    },
  }
  return env
}
const track = () => ({ readyState: 'live' })
const result = (text, isFinal = true) => Object.assign([{ transcript: text }], { isFinal })

test('Refuses to transcribe without on-device recognition instead of sending audio elsewhere', async () => {
  await assert.rejects(createTranscriber({ Recognition: undefined }).prepare(), /no tiene reconocimiento/)
  const cloudOnly = fakeEnvironment({ local: false })
  await assert.rejects(createTranscriber(cloudOnly.options).prepare(), /dentro del equipo/)
  const noSpanish = fakeEnvironment({ availability: {} })
  await assert.rejects(createTranscriber(noSpanish.options).prepare(), /no tiene reconocimiento de voz en español/)
  const downloading = fakeEnvironment({ availability: { 'es-AR': 'downloading' } })
  await assert.rejects(createTranscriber(downloading.options).prepare(), /se está descargando/)
  const failedInstall = fakeEnvironment({ availability: { 'es-ES': 'downloadable' }, install: false })
  await assert.rejects(createTranscriber(failedInstall.options).prepare(), /No se pudo instalar/)
  assert.throws(() => createTranscriber(fakeEnvironment().options).start([]), /Prepará/)
})

test('Prefers an available Spanish variant and installs a downloadable local pack when needed', async () => {
  const available = fakeEnvironment({ availability: { 'es-AR': 'downloadable', 'es-419': 'available' } })
  assert.equal(await createTranscriber(available.options).prepare(), 'es-419')
  assert.equal(available.Recognition.installed, undefined)
  const downloadable = fakeEnvironment({ availability: { 'es-MX': 'downloadable' } })
  assert.equal(await createTranscriber(downloadable.options).prepare(), 'es-MX')
  assert.equal(downloadable.Recognition.installed, 'es-MX')
})

test('Runs one local recognizer per speaker on its own audio track and orders segments by time', async () => {
  const env = fakeEnvironment()
  const updates = []
  const transcriber = createTranscriber({ ...env.options, onUpdate: () => updates.push(transcriber.segments.length) })
  await transcriber.prepare()
  const professionalTrack = track()
  const patientTrack = track()
  transcriber.start([
    { speaker: 'Profesional', getTrack: () => professionalTrack },
    { speaker: 'Paciente', getTrack: () => patientTrack },
  ])
  const [professional, patient] = env.instances
  assert.equal(professional.track, professionalTrack)
  assert.equal(patient.track, patientTrack)
  for (const recognition of env.instances) {
    assert.equal(recognition.processLocally, true)
    assert.equal(recognition.lang, 'es-AR')
    assert.equal(recognition.continuous, true)
  }
  env.advance(2000)
  patient.onspeechstart()
  env.advance(3000)
  professional.onspeechstart()
  env.advance(1000)
  professional.onresult({ resultIndex: 0, results: [result('¿Cómo dormiste esta semana?')] })
  patient.onresult({ resultIndex: 0, results: [result('parcial', false), result('Mejor que la anterior')] })
  assert.deepEqual(transcriber.segments, [
    { speaker: 'Profesional', at: 5000, text: '¿Cómo dormiste esta semana?' },
    { speaker: 'Paciente', at: 2000, text: 'Mejor que la anterior' },
  ])
  const text = transcriber.text({ patientName: 'Rodolfo Pérez' })
  assert.match(text, /Paciente: Rodolfo Pérez/)
  assert.ok(text.indexOf('[00:02] Paciente: Mejor que la anterior') < text.indexOf('[00:05] Profesional: ¿Cómo dormiste'))
  assert.ok(!text.includes('parcial'))
  assert.ok(updates.length > 0)
})

test('Restarts recognizers after the browser ends them, waits for missing audio and stops on fatal errors', async () => {
  const env = fakeEnvironment()
  const transcriber = createTranscriber(env.options)
  await transcriber.prepare()
  let patientTrack = null
  transcriber.start([
    { speaker: 'Profesional', getTrack: track },
    { speaker: 'Paciente', getTrack: () => patientTrack },
  ])
  assert.equal(env.instances.length, 1)
  assert.equal(transcriber.channels[1].state, 'esperando audio')
  patientTrack = track()
  env.runTimers()
  assert.equal(env.instances.length, 2)
  env.instances[0].onend()
  env.runTimers()
  assert.equal(env.instances.length, 3)
  env.instances[1].onerror({ error: 'network' })
  env.instances[1].onend()
  env.runTimers()
  assert.equal(env.instances.length, 3)
  assert.match(transcriber.channels[1].error, /servicio externo/)
  transcriber.stop()
  assert.equal(env.instances[2].stopped, true)
  env.instances[2].onend?.()
  env.runTimers()
  assert.equal(env.instances.length, 3)
})

test('Reports browsers that cannot recognize WebRTC tracks and discard clears memory', async () => {
  const env = fakeEnvironment({ startThrows: true })
  const transcriber = createTranscriber(env.options)
  await transcriber.prepare()
  transcriber.start([{ speaker: 'Paciente', getTrack: track }])
  assert.match(transcriber.channels[0].error, /no puede transcribir/)
  transcriber.discard()
  assert.equal(transcriber.segments.length, 0)
  assert.equal(transcriber.active, false)
  assert.equal(transcriber.startedAt, null)
})

test('Formats clock and empty transcripts', () => {
  assert.equal(formatClock(65_000), '01:05')
  assert.equal(formatClock(3_725_000), '1:02:05')
  assert.match(transcriptText([]), /Sin fragmentos/)
})
