import { classifiedBmiLabel, mergeClinicalPathologies } from './clinicalFollowUp.ts'
import type { PatientClinicalBaseline } from './clinicalFollowUp'

export const clinicalChecklist = [
  'Tabaquismo', 'Hipertensión', 'Diabetes', 'Hipotiroidismo', 'Celiaquía', 'Hiperplasia de próstata',
] as const

export function hasClinicalCondition(text: string, condition: string): boolean {
  return text.split('\n').some(line => line.trim().toLocaleLowerCase('es') === condition.toLocaleLowerCase('es'))
}

export function toggleClinicalCondition(text: string, condition: string, checked: boolean): string {
  if (checked) return hasClinicalCondition(text, condition) ? text : [text.trim(), condition].filter(Boolean).join('\n')
  return text.split('\n').filter(line => line.trim().toLocaleLowerCase('es') !== condition.toLocaleLowerCase('es')).join('\n')
}

export function allergyDetails(text: string): string | null {
  const lines = text.split('\n').filter(line => /^\s*Alergias:/i.test(line))
  return lines.length ? lines.map(line => line.replace(/^\s*Alergias:\s*/i, '').trim()).filter(Boolean).join('; ') : null
}

export function setAllergyDetails(text: string, details: string | null): string {
  const other = text.split('\n').filter(line => !/^\s*Alergias:/i.test(line)).join('\n').trim()
  return [other, details === null ? '' : `Alergias: ${details.replace(/\r?\n/g, '; ').trim()}`].filter(Boolean).join('\n')
}

interface FirstAttentionBaseline extends PatientClinicalBaseline {
  apellido: string
  nombre: string
  dni: string
  birthDate: string
  direccion?: string
  telefono?: string
  email?: string
  obraSocial: string
  numeroAfiliado: string
  plan: string
  patologiasConocidas: string
  patologiasCronicas: string
  ultimaInternacion: string
  cirugiasPrevias: string
  diagnosticoPrincipal?: string
}

export function firstAttentionSummary(patient: FirstAttentionBaseline, appointmentText = ''): string {
  const lines: Array<[string, string | undefined]> = [
    ['Paciente', `${patient.apellido}, ${patient.nombre}`],
    ['DNI', patient.dni],
    ['Fecha de nacimiento', patient.birthDate],
    ['Dirección', patient.direccion],
    ['Teléfono / WhatsApp', patient.telefono],
    ['Correo electrónico', patient.email],
    ['Obra social', patient.obraSocial],
    ['Plan', patient.plan],
    ['Número de afiliado', patient.numeroAfiliado],
    ['Patologías / antecedentes', mergeClinicalPathologies(patient.patologiasConocidas, patient.patologiasCronicas)],
    ['Última internación', patient.ultimaInternacion],
    ['Cirugías previas', patient.cirugiasPrevias],
    ['Medicación habitual (antecedente, no nueva indicación)', patient.medicacionHabitual],
    ['Peso inicial (kg)', patient.pesoInicial],
    ['Talla (cm)', patient.tallaCm],
    ['Tensión arterial inicial (mmHg)', patient.tensionArterial],
    ['IMC inicial', patient.pesoInicial && patient.tallaCm ? classifiedBmiLabel(patient.pesoInicial, patient.tallaCm, patient.birthDate, patient.pesoInicialFecha || '') : ''],
    ['Diagnóstico principal consignado', patient.diagnosticoPrincipal],
    ['Turno asociado', appointmentText],
  ]
  return ['Registro de la primera carga de la ficha. Datos consignados por el profesional.',
    ...lines.filter(([, value]) => value?.trim()).map(([label, value]) => `${label}: ${value}`),
  ].join('\n')
}
