// Procesa en el equipo el texto que devuelve el reconocimiento de voz del navegador:
// correcciones médicas, puntuación dictada, signos de apertura y mayúsculas.

const L = '\\p{L}\\d'
const phrase = (pattern: string) => new RegExp(`(^|[^${L}])(?:${pattern})(?=$|[^${L}])`, 'giu')

/** Errores frecuentes del reconocimiento con medicamentos, siglas y unidades. Se puede ampliar. */
export const MEDICAL_CORRECTIONS: Array<[RegExp, string]> = [
  [phrase('ibu ?profeno'), '$1ibuprofeno'],
  [phrase('para ?cetamol|para seta mol'), '$1paracetamol'],
  [phrase('amoxi ?cilina|amoxi silina|amoxisilina'), '$1amoxicilina'],
  [phrase('omepra ?zol|ome prazol|omeprazo'), '$1omeprazol'],
  [phrase('a ?sitro ?micina|azitro ?micina|a sitromicina'), '$1azitromicina'],
  [phrase('diclo ?fenac|diclo phenac'), '$1diclofenac'],
  [phrase('keto ?rolac|queto ?rolac'), '$1ketorolac'],
  [phrase('lo ?sart[aá]n'), '$1losartán'],
  [phrase('e ?nala ?pril'), '$1enalapril'],
  [phrase('am ?lodipina|amlo dipina'), '$1amlodipina'],
  [phrase('met ?formina'), '$1metformina'],
  [phrase('levo ?tiroxina'), '$1levotiroxina'],
  [phrase('sal ?butamol'), '$1salbutamol'],
  [phrase('dexa ?metasona'), '$1dexametasona'],
  [phrase('beta ?metasona'), '$1betametasona'],
  [phrase('clona ?[sz]ep[aá]m'), '$1clonazepam'],
  [phrase('alpra ?[sz]ol[aá]m'), '$1alprazolam'],
  [phrase('[cs]efa ?lexina'), '$1cefalexina'],
  [phrase('cipro ?floxacina'), '$1ciprofloxacina'],
  [phrase('atorva ?statina'), '$1atorvastatina'],
  [phrase('hta|hache te a'), '$1HTA'],
  [phrase('dbt'), '$1DBT'],
  [phrase('acv|a ce ve'), '$1ACV'],
  [phrase('epoc|e poc'), '$1EPOC'],
  [phrase('ecg'), '$1ECG'],
  [phrase('iam'), '$1IAM'],
  [phrase('dm ?2'), '$1DM2'],
  [/(\d)\s*miligramos?(?=$|[^\p{L}])/giu, '$1 mg'],
  [/(\d)\s*microgramos?(?=$|[^\p{L}])/giu, '$1 mcg'],
  [/(\d)\s*mililitros?(?=$|[^\p{L}])/giu, '$1 ml'],
  [/(\d)\s*mil[ií]metros de mercurio(?=$|[^\p{L}])/giu, '$1 mmHg'],
  [/(\d)\s*grados cent[ií]grados(?=$|[^\p{L}])/giu, '$1 °C'],
  [/(\d) (?:coma) (\d)/giu, '$1,$2'],
  [/(\d) (?:punto) (\d)/giu, '$1.$2'],
]

const COMMANDS: Array<[RegExp, string]> = [
  [phrase('punto y aparte|punto aparte|nuevo p[aá]rrafo'), '$1.\n'],
  [phrase('punto y seguido|punto seguido|punto final'), '$1.'],
  [phrase('punto y coma'), '$1;'],
  [phrase('nueva l[ií]nea|salto de l[ií]nea|nuevo rengl[oó]n|rengl[oó]n nuevo'), '$1\n'],
  [phrase('dos puntos'), '$1:'],
  [phrase('abr(?:ir|e|o) (?:signo de )?(?:pregunta|interrogaci[oó]n)'), '$1¿'],
  [phrase('(?:cerr(?:ar|a|o) (?:signo de )?|signo de )(?:pregunta|interrogaci[oó]n)|fin de (?:la )?pregunta'), '$1?'],
  [phrase('abr(?:ir|e|o) (?:signo de )?(?:exclamaci[oó]n|admiraci[oó]n)'), '$1¡'],
  [phrase('(?:cerr(?:ar|a|o) (?:signo de )?|signo de )(?:exclamaci[oó]n|admiraci[oó]n)'), '$1!'],
  [phrase('abr(?:ir|e|o) par[eé]ntesis'), '$1('],
  [phrase('cerr(?:ar|a|o) par[eé]ntesis'), '$1)'],
]

// "coma" y "punto" también son términos clínicos: solo se toman como signo fuera de esos contextos.
const COMA_BEFORE = /(?:^|\s)(?:en|de|del|un|el|al|su|tu|estado de)\s*$/iu
const COMA_AFTER = /^\s*(?:diab[eé]tic|hipogluc[eé]mic|hipergluc[eé]mic|hiperosmolar|et[ií]lic|alcoh[oó]lic|inducid|farmacol[oó]gic|vigil|profund|barbit[uú]ric|hep[aá]tic|mixedematos|ur[eé]mic|metab[oó]lic|cetoacid[oó]tic|de glasgow|glasgow)/iu
const PUNTO_BEFORE = /(?:^|\s)(?:un|el|al|del|este|ese|cada|ning[uú]n|alg[uú]n|a|en|mismo|primer|segundo|tercer|buen|mal|otro)\s*$/iu
const PUNTO_AFTER = /^\s*(?:de|del|doloros|gatillo|cardinal|ciego|medio|m[aá]xim|cr[ií]tic|clave|exact|com[uú]n|central|blando|\d)/iu

function replaceAmbiguous(text: string, word: string, symbol: string, before: RegExp, after: RegExp): string {
  return text.replace(phrase(word), (match: string, lead: string, offset: number, whole: string) => {
    const previous = whole.slice(0, offset + lead.length)
    const next = whole.slice(offset + match.length)
    return before.test(previous) || after.test(next) ? match : `${lead}${symbol}`
  })
}

function tidySpacing(text: string): string {
  return text
    .replace(/[ \t]+/g, ' ')
    .replace(/ ?([,.;:?!)])/g, '$1')
    .replace(/([¿¡(]) /g, '$1')
    .replace(/[,;]+\s*([.?!:])/g, '$1')
    .replace(/([,;:])\s*\1+/g, '$1')
    .replace(/\.\s+\./g, '.')
    .replace(/([,.;:?!)])(?=[\p{L}\d¿¡(])/gu, (mark: string, _m: string, offset: number, whole: string) =>
      (mark === ',' || mark === '.') && /\d/.test(whole[offset - 1] ?? '') && /\d/.test(whole[offset + 1] ?? '') ? mark : `${mark} `)
    .replace(/ *\n */g, '\n')
}

// Si la oración termina en ? o ! sin signo de apertura, lo agrega al comienzo de esa oración dictada.
function addOpeningMarks(text: string, preceding: string): string {
  let result = text
  for (const [open, close] of [['¿', '?'], ['¡', '!']] as const) {
    let searchFrom = 0
    while (true) {
      const closeAt = result.indexOf(close, searchFrom)
      if (closeAt < 0) break
      const before = result.slice(0, closeAt)
      const boundary = Math.max(before.lastIndexOf('.'), before.lastIndexOf('?'), before.lastIndexOf('!'), before.lastIndexOf('\n'))
      const sentence = before.slice(boundary + 1)
      const sentenceStartsInPreceding = boundary < 0 && preceding.trim() !== '' && !/[.?!\n]\s*$/.test(preceding)
      if (!sentence.includes(open) && !sentenceStartsInPreceding && sentence.trim()) {
        const insertAt = boundary + 1 + (sentence.length - sentence.trimStart().length)
        result = `${result.slice(0, insertAt)}${open}${result.slice(insertAt)}`
        searchFrom = closeAt + 2
      } else {
        searchFrom = closeAt + 1
      }
    }
  }
  return result
}

function capitalize(text: string, preceding: string): string {
  let capitalizeNext = /(^|[.?!\n])$/.test(preceding.replace(/[ \t]+$/, ''))
  let output = ''
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index]
    if (capitalizeNext && /\p{L}/u.test(char)) {
      output += char.toLocaleUpperCase('es-AR')
      capitalizeNext = false
      continue
    }
    output += char
    if (char === '\n' || char === '?' || char === '!') capitalizeNext = true
    else if (char === '.') capitalizeNext = !(/\d/.test(text[index - 1] ?? '') && /\d/.test(text[index + 1] ?? ''))
    else if (!/[\s¿¡("]/.test(char)) capitalizeNext = false
  }
  return output
}

export const DICTATION_COMMANDS_HINT =
  'Dictando... Podés decir: "coma", "punto", "punto y aparte", "nueva línea", "dos puntos", "abrir/cerrar pregunta", "abrir/cerrar paréntesis".'

/** Da formato al texto dictado. `preceding` es el texto ya escrito antes, para saber si empieza una oración. */
export function formatDictation(raw: string, preceding = ''): string {
  let text = raw.replace(/\s+/g, ' ').trim()
  if (!text) return ''
  for (const [pattern, replacement] of MEDICAL_CORRECTIONS) text = text.replace(pattern, replacement)
  for (const [pattern, replacement] of COMMANDS) text = text.replace(pattern, replacement)
  text = replaceAmbiguous(text, 'coma', ',', COMA_BEFORE, COMA_AFTER)
  text = replaceAmbiguous(text, 'punto', '.', PUNTO_BEFORE, PUNTO_AFTER)
  text = tidySpacing(text)
  text = addOpeningMarks(text, preceding)
  return capitalize(text, preceding).replace(/^ +| +$/g, '')
}

/** Une el texto ya escrito con el dictado formateado, sin espacios antes de signos ni después de saltos de línea. */
export function joinDictation(base: string, addition: string): string {
  const left = base.replace(/[ \t]+$/, '')
  if (!addition) return left
  if (!left) return addition.replace(/^[,;:]\s*/, '')
  if (/^[,.;:?!)\n]/.test(addition) || left.endsWith('\n')) return `${left}${addition}`
  return `${left} ${addition}`
}
