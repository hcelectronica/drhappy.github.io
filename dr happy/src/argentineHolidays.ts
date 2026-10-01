/**
 * Feriados nacionales de Argentina.
 *
 * Se calculan por año en vez de mantener una tabla fija: los inamovibles quedan
 * en su fecha, Carnaval y Viernes Santo salen de la Pascua y los trasladables
 * siguen la Ley 27.399 (martes y miércoles pasan al lunes anterior; jueves y
 * viernes, al lunes siguiente).
 *
 * No incluye feriados puente con fecha definida por decreto cada año ni
 * feriados provinciales.
 */

const DAY_IN_MS = 86_400_000

const FIXED_HOLIDAYS: Array<{ month: number; day: number; name: string }> = [
  { month: 1, day: 1, name: 'Año Nuevo' },
  { month: 3, day: 24, name: 'Día de la Memoria por la Verdad y la Justicia' },
  { month: 4, day: 2, name: 'Día del Veterano y de los Caídos en Malvinas' },
  { month: 5, day: 1, name: 'Día del Trabajador' },
  { month: 5, day: 25, name: 'Día de la Revolución de Mayo' },
  { month: 6, day: 20, name: 'Paso a la Inmortalidad del General Belgrano' },
  { month: 7, day: 9, name: 'Día de la Independencia' },
  { month: 12, day: 8, name: 'Inmaculada Concepción de María' },
  { month: 12, day: 25, name: 'Navidad' },
]

const MOVABLE_HOLIDAYS: Array<{ month: number; day: number; name: string }> = [
  { month: 6, day: 17, name: 'Paso a la Inmortalidad del General Güemes' },
  { month: 8, day: 17, name: 'Paso a la Inmortalidad del General San Martín' },
  { month: 10, day: 12, name: 'Día del Respeto a la Diversidad Cultural' },
  { month: 11, day: 20, name: 'Día de la Soberanía Nacional' },
]

function toISO(date: Date): string {
  return date.toISOString().slice(0, 10)
}

function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * DAY_IN_MS)
}

/** Domingo de Pascua según el algoritmo de Meeus/Jones/Butcher. */
function easterSunday(year: number): Date {
  const a = year % 19
  const b = Math.floor(year / 100)
  const c = year % 100
  const d = Math.floor(b / 4)
  const e = b % 4
  const f = Math.floor((b + 8) / 25)
  const g = Math.floor((b - f + 1) / 3)
  const h = (19 * a + b - d - g + 15) % 30
  const i = Math.floor(c / 4)
  const k = c % 4
  const l = (32 + 2 * e + 2 * i - h - k) % 7
  const m = Math.floor((a + 11 * h + 22 * l) / 451)
  const month = Math.floor((h + l - 7 * m + 114) / 31)
  const day = ((h + l - 7 * m + 114) % 31) + 1
  return new Date(Date.UTC(year, month - 1, day))
}

function applyMondayRule(year: number, month: number, day: number): string {
  const date = new Date(Date.UTC(year, month - 1, day))
  const weekday = date.getUTCDay()
  if (weekday === 2 || weekday === 3) return toISO(addDays(date, weekday === 2 ? -1 : -2))
  if (weekday === 4 || weekday === 5) return toISO(addDays(date, weekday === 4 ? 4 : 3))
  return toISO(date)
}

const holidaysByYear = new Map<number, Map<string, string>>()

export function getArgentineHolidays(year: number): Map<string, string> {
  const cached = holidaysByYear.get(year)
  if (cached) return cached

  const holidays = new Map<string, string>()
  for (const { month, day, name } of FIXED_HOLIDAYS) {
    holidays.set(toISO(new Date(Date.UTC(year, month - 1, day))), name)
  }

  const easter = easterSunday(year)
  holidays.set(toISO(addDays(easter, -48)), 'Carnaval')
  holidays.set(toISO(addDays(easter, -47)), 'Carnaval')
  holidays.set(toISO(addDays(easter, -2)), 'Viernes Santo')

  for (const { month, day, name } of MOVABLE_HOLIDAYS) {
    holidays.set(applyMondayRule(year, month, day), name)
  }

  holidaysByYear.set(year, holidays)
  return holidays
}

/** Devuelve el nombre del feriado para una fecha `YYYY-MM-DD`, o null si es día hábil. */
export function getHolidayName(dateStr: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) return null
  return getArgentineHolidays(Number(dateStr.slice(0, 4))).get(dateStr) ?? null
}

export function isArgentineHoliday(dateStr: string): boolean {
  return getHolidayName(dateStr) !== null
}
