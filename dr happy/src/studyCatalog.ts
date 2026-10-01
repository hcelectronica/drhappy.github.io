// Procedimientos activos verificados en Snowstorm Test del Ministerio de Salud (rama MAIN, idioma es).
// https://snowstorm-test.msal.gob.ar/swagger-ui.html — selección frecuente, no catálogo completo de la extensión argentina.
export const STUDY_CATALOG = [
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
] as const

export interface OrderedStudy {
  term: string
  code?: string
}
