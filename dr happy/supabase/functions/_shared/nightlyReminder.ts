export function nightlyReminderDate(now: Date): string | null {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Argentina/Buenos_Aires',
    year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hourCycle: 'h23',
  }).formatToParts(now)
  const value = (type: string) => parts.find((part) => part.type === type)?.value
  if (value('hour') !== '22') return null
  const date = new Date(`${value('year')}-${value('month')}-${value('day')}T12:00:00-03:00`)
  date.setUTCDate(date.getUTCDate() + 1)
  return date.toISOString().slice(0, 10)
}

export function reminderMessage(appointment: {
  patientName?: string; scheduledDate: string; scheduledTime: string; location?: string
}, professionalName: string): string {
  return [
    `Hola ${appointment.patientName || ''}. Te recordamos tu turno de mañana.`,
    `Fecha: ${appointment.scheduledDate}. Hora: ${appointment.scheduledTime} hs.`,
    `Profesional: ${professionalName}.`,
    appointment.location ? `Lugar: ${appointment.location}.` : '',
  ].filter(Boolean).join('\n')
}
