// Experimental transcription that only uses the browser's on-device speech recognition.
// Audio never leaves this computer: if local recognition is not available, it refuses to start.
export const LANGUAGES = ['es-AR', 'es-419', 'es-US', 'es-MX', 'es-ES']
const FATAL_ERRORS = {
  'not-allowed': 'El navegador no permitió usar el reconocimiento de voz.',
  'service-not-allowed': 'El navegador no permitió usar el reconocimiento de voz local.',
  'language-not-supported': 'El idioma español no está disponible para reconocimiento local.',
  network: 'El navegador intentó usar un servicio externo; la transcripción se detuvo.',
  'phrases-not-supported': 'El reconocimiento local no admite esta configuración.',
}

export function formatClock(ms) {
  const total = Math.max(0, Math.floor(ms / 1000))
  const hours = Math.floor(total / 3600)
  const clock = `${String(Math.floor(total / 60) % 60).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`
  return hours ? `${hours}:${clock}` : clock
}

export function transcriptText(segments, { patientName = '', startedAt = null, lang = '' } = {}) {
  const lines = [
    'Transcripción de videoconsulta - Dr Happy',
    patientName ? `Paciente: ${patientName}` : null,
    startedAt ? `Inicio: ${new Date(startedAt).toLocaleString('es-AR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })}` : null,
    lang ? `Idioma de reconocimiento: ${lang}` : null,
    'Generada en este equipo con el reconocimiento de voz local del navegador. Borrador: requiere revisión profesional.',
    '',
  ].filter(line => line !== null)
  const ordered = segments.map((segment, index) => ({ ...segment, index })).sort((a, b) => a.at - b.at || a.index - b.index)
  for (const segment of ordered) lines.push(`[${formatClock(segment.at)}] ${segment.speaker}: ${segment.text}`)
  if (!ordered.length) lines.push('(Sin fragmentos reconocidos.)')
  return `${lines.join('\n')}\n`
}

export function createTranscriber({
  Recognition: injectedRecognition,
  now = () => Date.now(),
  setTimer = (callback, ms) => setTimeout(callback, ms),
  clearTimer = timer => clearTimeout(timer),
  onUpdate = () => {},
} = {}) {
  let Recognition = injectedRecognition
  let lang = ''
  let active = false
  let startedAt = null
  let runners = []
  const segments = []
  const emit = () => onUpdate(api)

  async function prepare() {
    if (!lang) Recognition = injectedRecognition ?? globalThis.SpeechRecognition ?? globalThis.webkitSpeechRecognition
    if (typeof Recognition !== 'function') {
      throw new Error('Este navegador no tiene reconocimiento de voz. Usá Chrome actualizado en una computadora.')
    }
    if (!('processLocally' in Recognition.prototype) || typeof Recognition.available !== 'function') {
      throw new Error('Este navegador no ofrece reconocimiento de voz dentro del equipo. No se transcribe para no enviar el audio a servicios externos. Usá Chrome 139 o posterior en una computadora.')
    }
    if (lang) return lang
    let downloadable = ''
    let downloading = false
    for (const candidate of LANGUAGES) {
      const status = await Recognition.available({ langs: [candidate], processLocally: true })
      if (status === 'available') return (lang = candidate)
      if (status === 'downloadable' && !downloadable) downloadable = candidate
      if (status === 'downloading') downloading = true
    }
    if (downloading) throw new Error('El paquete de español para reconocimiento local se está descargando. Probá de nuevo en unos minutos.')
    if (downloadable && typeof Recognition.install === 'function') {
      const installed = await Recognition.install({ langs: [downloadable], processLocally: true })
      if (installed) return (lang = downloadable)
      throw new Error('No se pudo instalar el paquete de español para reconocimiento local.')
    }
    throw new Error('Este equipo no tiene reconocimiento de voz en español dentro del navegador. No se transcribe para no enviar el audio a servicios externos.')
  }

  function runChannel(channel) {
    const runner = { speaker: channel.speaker, state: 'esperando audio', error: '', recognition: null, timer: null, failures: 0, stopped: false }
    const schedule = ms => { runner.timer = setTimer(launch, ms) }
    function launch() {
      runner.timer = null
      if (!active || runner.stopped) return
      const track = channel.getTrack()
      if (!track || track.readyState !== 'live') {
        runner.state = 'esperando audio'
        emit()
        return schedule(1500)
      }
      const recognition = new Recognition()
      recognition.lang = lang
      recognition.continuous = true
      recognition.interimResults = false
      recognition.maxAlternatives = 1
      recognition.processLocally = true
      let utteranceStart = null
      recognition.onspeechstart = () => { utteranceStart ??= now() }
      recognition.onresult = event => {
        for (let index = event.resultIndex; index < event.results.length; index++) {
          const result = event.results[index]
          const text = result?.isFinal ? String(result[0]?.transcript ?? '').trim() : ''
          if (!text) continue
          segments.push({ speaker: channel.speaker, at: Math.max(0, (utteranceStart ?? now()) - startedAt), text })
          utteranceStart = null
          runner.failures = 0
        }
        emit()
      }
      recognition.onerror = event => {
        if (FATAL_ERRORS[event.error]) {
          runner.stopped = true
          runner.state = 'detenido'
          runner.error = FATAL_ERRORS[event.error]
          emit()
        } else if (event.error !== 'no-speech' && event.error !== 'aborted') runner.failures++
      }
      recognition.onend = () => {
        if (runner.recognition === recognition) runner.recognition = null
        if (active && !runner.stopped) schedule(Math.min(250 * 2 ** runner.failures, 8000))
      }
      runner.recognition = recognition
      try {
        recognition.start(track)
        runner.state = 'escuchando'
      } catch {
        runner.recognition = null
        runner.stopped = true
        runner.state = 'detenido'
        runner.error = 'Este navegador no puede transcribir el audio de la videollamada. Actualizá Chrome.'
      }
      emit()
    }
    runner.halt = () => {
      runner.stopped = true
      if (runner.timer !== null) clearTimer(runner.timer)
      runner.timer = null
      const recognition = runner.recognition
      runner.recognition = null
      if (recognition) {
        recognition.onend = null
        try { recognition.stop() } catch {}
      }
      runner.state = 'detenido'
    }
    launch()
    return runner
  }

  function start(channels) {
    if (active) return
    if (!lang) throw new Error('Prepará el reconocimiento local antes de transcribir.')
    active = true
    startedAt ??= now()
    runners = channels.map(runChannel)
    emit()
  }

  function stop() {
    if (!active) return
    active = false
    for (const runner of runners) runner.halt()
    emit()
  }

  function discard() {
    stop()
    segments.length = 0
    runners = []
    startedAt = null
    emit()
  }

  const api = {
    prepare,
    start,
    stop,
    discard,
    get active() { return active },
    get lang() { return lang },
    get startedAt() { return startedAt },
    get segments() { return segments.slice() },
    get channels() { return runners.map(({ speaker, state, error }) => ({ speaker, state, error })) },
    text: meta => transcriptText(segments, { lang, startedAt, ...meta }),
  }
  return api
}
