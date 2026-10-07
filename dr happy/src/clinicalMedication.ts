export interface ClinicalMedication {
  drug: string
  presentation: string
  dosage: string
}

export function clinicalMedicationSuggestions(catalog: ReadonlyArray<ClinicalMedication>, query: string): ClinicalMedication[] {
  const normalize = (text: string) => text.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
  const search = normalize(query.trim())
  if (search.length < 2) return []
  const seen = new Set<string>()
  return catalog.filter(item => {
    const key = `${item.drug}|${item.presentation}`
    if (!normalize(`${item.drug} ${item.presentation}`).includes(search) || seen.has(key)) return false
    seen.add(key)
    return true
  }).slice(0, 16)
}

export function clinicalMedicationLine(item: ClinicalMedication, regimen: string): string {
  return [item.drug, item.presentation, regimen.trim()].filter(Boolean).join(' · ')
}
