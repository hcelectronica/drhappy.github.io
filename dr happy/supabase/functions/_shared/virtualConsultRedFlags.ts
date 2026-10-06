// Señales de alarma que impiden tomar una consulta virtual paga: el paciente debe ir a una guardia.
// La página pública usa la misma lista para avisar antes de enviar; el servidor siempre vuelve a verificar.
export const RED_FLAG_PATTERNS = [
  'dolor de pecho', 'dolor en el pecho', 'dolor precordial', 'opresion en el pecho', 'puntada en el pecho',
  'falta de aire', 'no puedo respirar', 'dificultad para respirar', 'me ahogo', 'ahogo',
  'desmayo', 'me desmaye', 'perdi el conocimiento', 'perdida de conocimiento', 'convulsion',
  'hemorragia', 'sangrado abundante', 'sangra mucho', 'vomito con sangre', 'vomitos con sangre', 'sangre en el vomito',
  'paralisis', 'no puedo mover', 'cara torcida', 'boca torcida', 'no puedo hablar', 'dificultad para hablar',
  'suicid', 'quitarme la vida', 'matarme', 'no quiero vivir', 'sobredosis', 'intoxicacion', 'envenen',
  'peor dolor de cabeza', 'dolor de cabeza muy fuerte', 'dolor de cabeza intenso y subito',
  'bebe con fiebre', 'recien nacido con fiebre', 'fractura expuesta', 'quemadura grave',
  'embarazada y sangr', 'embarazo y sangr', 'reaccion alergica grave', 'se me cierra la garganta', 'anafilaxia',
]

export function normalizeForRedFlags(value: string): string {
  return value.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\s+/g, ' ')
}

export function findRedFlag(value: string): string | null {
  const normalized = normalizeForRedFlags(value)
  return RED_FLAG_PATTERNS.find((pattern) => normalized.includes(pattern)) ?? null
}
