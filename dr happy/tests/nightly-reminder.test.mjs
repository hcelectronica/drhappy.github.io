import test from 'node:test'
import assert from 'node:assert/strict'
import { nightlyReminderDate, reminderMessage } from '../supabase/functions/_shared/nightlyReminder.ts'

test('runs at 22 Argentina and selects tomorrow, including month/year boundaries', () => {
  assert.equal(nightlyReminderDate(new Date('2026-10-03T00:59:59Z')), null)
  assert.equal(nightlyReminderDate(new Date('2026-10-03T01:00:00Z')), '2026-10-03')
  assert.equal(nightlyReminderDate(new Date('2026-10-03T01:59:59Z')), '2026-10-03')
  assert.equal(nightlyReminderDate(new Date('2026-10-03T02:00:00Z')), null)
  assert.equal(nightlyReminderDate(new Date('2027-01-01T01:00:00Z')), '2027-01-01')
  assert.equal(nightlyReminderDate(new Date('2028-03-01T01:00:00Z')), '2028-03-01')
})

test('message contains tomorrow, patient, date, time, professional and location', () => {
  const message = reminderMessage({
    patientName: 'Paciente de prueba', scheduledDate: '2026-10-03',
    scheduledTime: '16:00', location: 'Consultorio de prueba',
  }, 'Profesional de prueba')
  for (const value of ['mañana', '2026-10-03', '16:00', 'Profesional de prueba', 'Consultorio de prueba']) {
    assert.ok(message.includes(value))
  }
  assert.ok(!message.includes('24 horas'))
  assert.ok(!message.includes('2 horas'))
})
