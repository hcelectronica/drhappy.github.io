export const documentServices = [
  { type: 'certificate', label: 'Certificados', singular: 'Certificado médico', enabledColumn: 'certificate_enabled', priceColumn: 'certificate_price' },
  { type: 'fitness', label: 'Aptos físicos', singular: 'Apto físico', enabledColumn: 'fitness_enabled', priceColumn: 'fitness_price' },
  { type: 'prescription', label: 'Recetas', singular: 'Receta', enabledColumn: 'prescription_enabled', priceColumn: 'prescription_price' },
] as const
export type DocumentServiceType = typeof documentServices[number]['type']
export type DocumentServiceOptions = Record<DocumentServiceType, { enabled: boolean; price: number }>
export function documentServiceOptions(settings: Record<string, unknown>): DocumentServiceOptions {
  return {
    certificate: { enabled: settings.certificate_enabled === true || settings.study_order_enabled === true, price: Number(settings.certificate_enabled || !settings.study_order_enabled ? settings.certificate_price || 0 : settings.study_order_price || 0) },
    fitness: { enabled: settings.fitness_enabled === true, price: Number(settings.fitness_price || 0) },
    prescription: { enabled: settings.prescription_enabled === true, price: Number(settings.prescription_price || 0) },
  }
}
export function documentServiceLabel(type: string | null | undefined): string {
  return documentServices.find(service => service.type === type)?.singular || (type === 'study-order' ? 'Orden de estudios' : 'Solicitud de documento (anterior)')
}
