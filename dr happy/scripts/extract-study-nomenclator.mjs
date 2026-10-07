import { readFile, writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs'

const sourcePath = process.argv[2]
if (!sourcePath) throw new Error('Provide the local manual_nomenclador.pdf path.')
const bytes = await readFile(sourcePath)
const task = getDocument({ data: new Uint8Array(bytes) })
const entries = []
let category = ''
let setting = 'Ambulatorio'
let excluded = false
try {
  const pdf = await task.promise
  if (pdf.numPages < 98) throw new Error('The source does not include the requested page range.')
  for (let pageNumber = 9; pageNumber <= 98; pageNumber++) {
    const page = await pdf.getPage(pageNumber)
    const { items } = await page.getTextContent()
    const textItems = items.filter(item => 'str' in item && item.str.trim())
    const headingRows = new Map()
    for (const item of textItems) {
      if (item.transform[4] < 175) continue
      const y = Math.round(item.transform[5] * 2) / 2
      headingRows.set(y, [...(headingRows.get(y) || []), item])
    }
    const headings = new Map([...headingRows].map(([y, row]) => [
      y, row.sort((a, b) => a.transform[4] - b.transform[4]).map(item => item.str).join(' ').replace(/\s+/g, ' ').trim(),
    ]).filter(([, text]) => /^\d+\.(?:\d+(?:\.\d+)*)?\s+[A-Za-zÁÉÍÓÚÑáéíóúñ]/.test(text)))
    let current = null
    const flush = () => {
      if (!current) return
      const term = current.fragments.join(' ').replace(/\s+/g, ' ').trim()
      if (!term || !category) throw new Error(`Missing description/category: ${current.code} page ${pageNumber}`)
      entries.push({ code: current.code, term, codeSystem: 'nomenclador', category, setting, sourcePage: pageNumber })
      current = null
    }
    let lastHeadingY = null
    for (const item of textItems) {
      const y = Math.round(item.transform[5] * 2) / 2
      const heading = headings.get(y)
      if (heading) {
        if (lastHeadingY === y) continue
        flush()
        lastHeadingY = y
        if (/^3\.4\s/.test(heading)) { excluded = true; break }
        if (/^3\.\s/.test(heading)) setting = 'Internación'
        category = heading.replace(/^\d+(?:\.\d+)*\.?\s+/, '')
        continue
      }
      if (excluded) break
      const x = item.transform[4]
      if (x >= 130 && x < 175 && /^\d{6}$/.test(item.str.trim())) {
        flush()
        current = { code: item.str.trim(), fragments: [] }
      } else if (current && x >= 175 && y > 45) {
        current.fragments.push(item.str.trim())
      }
    }
    flush()
  }
} finally {
  await task.destroy()
}
const seen = new Set()
const practices = entries.filter(entry => {
  const key = `${entry.code}|${entry.term}|${entry.setting}`
  if (seen.has(key)) return false
  seen.add(key)
  return true
})
if (!excluded || practices.length < 2000) throw new Error('Requested scope was not fully extracted.')
const catalog = {
  source: 'Manual nomenclador aportado por el usuario',
  sourceSha256: createHash('sha256').update(bytes).digest('hex'),
  pageRange: [9, 98],
  excludedSection: '3.4 Prácticas en internación clínica',
  codeSystem: 'nomenclador',
  practices,
}
await writeFile(new URL('../public/study-nomenclator.json', import.meta.url), JSON.stringify(catalog, null, 2) + '\n')
console.log(`Extracted ${practices.length} practices from ${entries.length} rows; excluded section 3.4.`)
console.log(JSON.stringify(Object.fromEntries([...new Set(practices.map(entry => entry.setting))].map(setting => [
  setting, practices.filter(entry => entry.setting === setting).length,
])), null, 2))
