import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import ts from 'typescript'
import { GlucoseInputError, parseGlucoseReading, parseDiabetesTreatment } from '../supabase/functions/_shared/patientGlucose.ts'
import { communicationHtml, uniqueContacts, validContactEmail, COMMUNICATION_TEMPLATES } from '../supabase/functions/_shared/patientCommunications.ts'

const now = Date.now()
const reading = { value: 110, measuredAt: new Date(now).toISOString(), context: 'fasting', method: 'capillary', note: '' }
const treatment = { diabetesType: 'type2', diagnosedYear: 2020, usesInsulin: false, insulins: [], medications: [{ name: 'Metformina', dose: '500 mg', schedule: 'Con la cena' }], notes: '' }
test('Glucose validates numeric boundaries, timestamp, context and method', () => {
  for (const value of [1, 110, 1000]) assert.equal(parseGlucoseReading({ ...reading, value }, now).value, value)
  for (const value of [0, -1, 1001, 5.5, '110', NaN, Infinity, null]) assert.throws(() => parseGlucoseReading({ ...reading, value }, now), GlucoseInputError)
  for (const measuredAt of ['', 'bad', new Date(now + 300001).toISOString(), new Date(now - 367 * 86400000).toISOString()]) assert.throws(() => parseGlucoseReading({ ...reading, measuredAt }, now), GlucoseInputError)
  for (const change of [{ context: 'constructor' }, { method: 'unknown' }, { note: 'x'.repeat(301) }]) assert.throws(() => parseGlucoseReading({ ...reading, ...change }, now), GlucoseInputError)
  assert.equal(parseGlucoseReading(reading, now).measured_at, reading.measuredAt)
  assert.equal(parseGlucoseReading({ ...reading, note: '  Síntoma  ' }, now).note, 'Síntoma')
})
test('Treatment supports multiple insulin schedules with concomitant medication', () => {
  const mixed = { ...treatment, usesInsulin: true, insulins: [
    { name: 'Basal', units: 16.5, schedule: '22 h' }, { name: 'Rápida', units: 4, schedule: 'Antes de almorzar, según indicación' },
  ] }
  assert.deepEqual(parseDiabetesTreatment(mixed), mixed)
  assert.deepEqual(parseDiabetesTreatment(treatment), treatment)
  for (let i = 1; i <= 10000; i++) assert.equal(parseDiabetesTreatment({ ...mixed, insulins: [{ ...mixed.insulins[0], units: i / 10 }] }).insulins[0].units, i / 10)
  for (const units of [0, -1, 1001, 0.15, '5', NaN, Infinity]) assert.throws(() => parseDiabetesTreatment({ ...mixed, insulins: [{ ...mixed.insulins[0], units }] }), GlucoseInputError)
  for (const change of [
    { diagnosedYear: 1899 }, { diagnosedYear: new Date().getFullYear() + 1 }, { diagnosedYear: 2020.5 }, { diabetesType: 'constructor' },
    { usesInsulin: true }, { insulins: mixed.insulins }, { medications: [{ name: '', dose: '5', schedule: '22 h' }] },
    { medications: Array(21).fill(treatment.medications[0]) }, { notes: 'x'.repeat(501) },
  ]) assert.throws(() => parseDiabetesTreatment({ ...treatment, ...change }), GlucoseInputError)
  assert.throws(() => parseDiabetesTreatment({ ...mixed, insulins: Array(11).fill(mixed.insulins[0]) }), GlucoseInputError)
})
test('Clinical summary preserves time, context and prescribed dose without changing the record', async () => {
  const source = (await readFile(new URL('../src/glucoseSummaryText.ts', import.meta.url), 'utf8'))
    .replaceAll("'../supabase/functions/_shared/patientGlucose'", JSON.stringify(new URL('../supabase/functions/_shared/patientGlucose.ts', import.meta.url).href))
  const js = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText
  const { glucoseSummaryText } = await import(`data:text/javascript;base64,${Buffer.from(js).toString('base64')}`)
  const record = { readings: [{ ...reading, id: '1' }], totalReadings: 1, treatment, updatedAt: reading.measuredAt }
  const before = JSON.stringify(record), result = glucoseSummaryText(record)
  for (const text of ['110 mg/dL', 'En ayunas', 'Glucómetro', '500 mg', 'Con la cena', 'no verificado']) assert.ok(result.includes(text), text)
  assert.equal(JSON.stringify(record), before)
  assert.ok(!result.includes('promedio'))
})
test('Emails normalize and deduplicate, rejecting multiple recipients and header injection', () => {
  const rows = [' One@Example.invalid ', 'one@example.invalid', 'bad', 'a@b.com,c@d.com', 'a@b.com\r\nBcc:x@y.com', 'two@example.invalid']
    .map((email, i) => ({ id: `${i}`, email, name: 'Fixture', eligible: true, reason: '' }))
  assert.deepEqual(uniqueContacts(rows).map(r => r.email), ['one@example.invalid', 'two@example.invalid'])
  for (const email of ['name <a@b.com>', 'a@b.com;b@c.com', 'a\n@b.com', 'x'.repeat(255)]) assert.equal(validContactEmail(email), false)
})
test('Email templates escape content and keep links and unsubscribe separate from health data', () => {
  const html = communicationHtml({ name: '<img onerror="alert(1)">', sender: "Doctor's", subject: '<script>', message: 'texto & "comillas"',
    template: 'folder', link: 'https://www.drhappy.com.ar/paciente', unsubscribe: 'https://www.drhappy.com.ar/paciente?unsubscribe=fixture' })
  assert.ok(!html.includes('<script>') && !html.includes('<img'))
  assert.ok(html.includes('&lt;img') && html.includes('texto &amp; &quot;comillas&quot;'))
  assert.ok(html.includes('no comparte automáticamente') && html.includes('unsubscribe=fixture'))
  assert.match(COMMUNICATION_TEMPLATES.virtual.message, /pago.*no obligatorio/)
})
