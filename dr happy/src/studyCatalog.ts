// Procedimientos activos verificados en Snowstorm Test del Ministerio de Salud (rama MAIN, idioma es).
// https://snowstorm-test.msal.gob.ar/swagger-ui.html — selección frecuente, no catálogo completo de la extensión argentina.
export const STUDY_CATALOG: CatalogStudy[] = [
  { code: '45036003', term: 'Ecografía de abdomen' },
  { code: '24848001', term: 'Ecografía pélvica' },
  { code: '47079000', term: 'Ecografía mamaria' },
  { code: '268445003', term: 'Ecografía obstétrica' },
  { code: '241455000', term: 'Ecografía de glándula tiroides' },
  { code: '306005', term: 'Ecografía de riñón' },
  { code: '169066007', term: 'Tomografía computarizada de cráneo' },
  { code: '169069000', term: 'Tomografía computarizada de tórax' },
  { code: '169070004', term: 'Tomografía computarizada de abdomen' },
  { code: '169071000', term: 'Tomografía computarizada de pelvis' },
  { code: '399208008', term: 'Radiografía simple de tórax' },
  { code: '268400002', term: 'ECG de 12 derivaciones' },
]

export interface OrderedStudy {
  term: string
  code?: string
  codeSystem?: 'snomed' | 'nomenclador'
  setting?: 'Ambulatorio' | 'Internación'
}

export interface CatalogStudy extends OrderedStudy {
  code: string
  category?: string
  sourcePage?: number
}

export function studyCodeLabel(study: OrderedStudy): string {
  if (!study.code) return 'Texto libre'
  return `${study.codeSystem === 'nomenclador' ? 'Nomenclador' : 'SNOMED CT'} ${study.code}${study.setting ? ` · ${study.setting}` : ''}`
}

export function formatOrderedStudy(study: OrderedStudy): string {
  return `${study.term} (${studyCodeLabel(study)})`
}

export function loadStudyNomenclatorFromJson(value: unknown): CatalogStudy[] {
  if (!value || typeof value !== 'object' || !('practices' in value) || !Array.isArray(value.practices) || !value.practices.length) {
    throw new Error('El catálogo de prácticas no tiene un formato válido.')
  }
  return value.practices.map((entry: unknown) => {
    if (!entry || typeof entry !== 'object' || !('term' in entry) || typeof entry.term !== 'string' || !entry.term.trim()
      || !('code' in entry) || typeof entry.code !== 'string' || !/^\d{6}$/.test(entry.code)
      || !('codeSystem' in entry) || entry.codeSystem !== 'nomenclador'
      || !('setting' in entry) || (entry.setting !== 'Ambulatorio' && entry.setting !== 'Internación')
      || !('category' in entry) || typeof entry.category !== 'string' || !entry.category.trim()
      || !('sourcePage' in entry) || typeof entry.sourcePage !== 'number' || !Number.isInteger(entry.sourcePage) || entry.sourcePage < 9 || entry.sourcePage > 98) {
      throw new Error('Hay una práctica inválida en el catálogo. No se cargó para evitar códigos incorrectos.')
    }
    return { code: entry.code, term: entry.term, codeSystem: entry.codeSystem, setting: entry.setting, category: entry.category, sourcePage: entry.sourcePage }
  })
}

function searchText(value: string): string {
  return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim()
}

export function findStudySuggestions(catalog: CatalogStudy[], query: string, limit = 16): CatalogStudy[] {
  if (query.trim().length < 2) return []
  const aliases: Record<string, string> = { rx: 'radiografia', tc: 'tomografia', tac: 'tomografia', rm: 'resonancia', rmn: 'resonancia', eco: 'ecografia' }
  const parts = searchText(query).split(/\s+/).map(part => aliases[part] || part)
  return catalog.filter(study => {
    const text = searchText(`${study.term} ${study.code} ${study.category || ''} ${study.setting || ''}`)
    return parts.every(part => text.includes(part))
  }).slice(0, limit)
}
