import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import ts from 'typescript'

const source = readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8')
const ast = ts.createSourceFile('App.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
function find(name, node = ast) {
  if (ts.isFunctionDeclaration(node) && node.name?.text === name) return node
  return ts.forEachChild(node, child => find(name, child))
}
const declaration = name => {
  const node = find(name)
  assert(node, name)
  return node.getText(ast)
}
const user = { id: 'new-professional', fullName: 'Profesional Nuevo', specialty: 'Medicina', licenseNumber: 'TEST', email: 'new@example.invalid' }
function context() {
  const context = { DEFAULT_DAILY_PATIENT_LIMIT: 10, normalizeStoredFile: () => null, normalizeStringList: () => [] }
  vm.runInNewContext(ts.transpile(declaration('profileFromSeed') + '\n' + declaration('normalizeRemoteProfile')), context)
  return context
}

test('new professional profile has its own identity and no inherited days, hours, fees or links', () => {
  const c = context()
  const profile = c.profileFromSeed(user)
  assert.equal(profile.fullName, user.fullName)
  assert.equal(profile.email, user.email)
  assert.equal(profile.appointmentDays.length, 0)
  assert.equal(profile.appointmentStartTime, '')
  assert.equal(profile.appointmentEndTime, '')
  assert.equal(profile.appointmentAmountToCharge, undefined)
  assert.equal(profile.paymentLink, undefined)
  for (const raw of [null, {}, { fullName: user.fullName }]) {
    const p = c.normalizeRemoteProfile(raw, profile)
    assert.equal(p.appointmentDays.length, 0)
    assert.equal(p.appointmentStartTime, '')
    assert.equal(p.appointmentEndTime, '')
  }
})

test('configured and deliberately empty schedules survive normalization even in partial profiles', () => {
  const c = context()
  const fallback = c.profileFromSeed(user)
  const existing = { appointmentDays: [2, 5], appointmentStartTime: '14:00', appointmentEndTime: '18:00', appointmentAmountToCharge: 15000 }
  const profile = c.normalizeRemoteProfile(existing, fallback)
  assert.deepEqual(Array.from(profile.appointmentDays), existing.appointmentDays)
  assert.equal(profile.appointmentStartTime, '14:00')
  assert.equal(profile.appointmentEndTime, '18:00')
  assert.equal(profile.appointmentAmountToCharge, 15000)
  assert.equal(profile.fullName, user.fullName)
  const empty = c.normalizeRemoteProfile({ ...existing, appointmentDays: [], appointmentStartTime: '', appointmentEndTime: '' }, fallback)
  assert.equal(empty.appointmentDays.length, 0)
  assert.equal(empty.appointmentStartTime, '')
})

test('a cloud account with no workspace never imports cached patients, profile or appointments', async () => {
  const c = context()
  const storage = new Map()
  const calls = []
  Object.assign(c, {
    isSupabaseConfigured: true, supabase: {},
    readProfessionalSession: () => ({ userId: user.id }),
    sessionGenerationRef: { current: 0 }, workspaceSaveFailedRef: { current: false },
    readJsonStorage: () => ({ fullName: 'Otra cuenta', appointmentDays: [1, 2, 4] }),
    profileStorageKey: id => `profile-${id}`,
    appointmentsStorageKey: id => `appointments-${id}`,
    treatmentLedgerStorageKey: id => `ledger-${id}`,
    patientIndexStorageKey: id => `patients-${id}`,
    patientGlobalStorageKey: id => `patient-${id}`,
    loadAccessiblePatientsForUser: () => ({ patientsList: [{ id: 'foreign' }], availablePatientsList: [{ id: 'foreign' }] }),
    normalizeAppointmentRecord: value => value,
    normalizeTreatmentLedgerEntry: value => value,
    SESSION_USER_KEY: 'active', SESSION_USER_CACHE_KEY: 'cached-user',
    localStorage: { setItem: (key, value) => storage.set(key, value), removeItem: key => storage.delete(key) },
    loadWorkspaceData: async () => ({ success: true, professional: { id: user.id }, workspace: null }),
    readPatientArchives: () => [], clearArchivedPatientCaches: () => {},
    persistWorkspaceRemote: async (...params) => { calls.push(params); return true },
    linkAppointmentsToPatients: (appointments) => appointments,
  })

  c.readJsonStorage = (key, fallback) => key.startsWith('profile-') ? { fullName: 'Otra cuenta' }
    : key.startsWith('appointments-') ? [{ scheduledDate: '2026-11-12', scheduledTime: '09:00' }]
      : key.startsWith('ledger-') ? [{ id: 'foreign-ledger' }] : fallback
  for (const name of declaration('loadWorkspaceForUser').matchAll(/\b(set[A-Z]\w*)\(/g)) c[name[1]] = () => {}
  vm.runInNewContext(ts.transpile(declaration('loadWorkspaceForUser')), c)
  await c.loadWorkspaceForUser(user)
  assert.equal(calls.length, 1)
  assert.equal(calls[0][0], user.id)
  assert.equal(calls[0][1].fullName, user.fullName)
  assert.equal(calls[0][1].appointmentDays.length, 0)
  assert.equal(calls[0][2].length, 0)
  assert.equal(calls[0][3].length, 0)
  assert.equal(storage.get(`ledger-${user.id}`), '[]')
  c.loadWorkspaceData = async () => ({ success: true, professional: { id: user.id }, workspace: { user_id: 'other-professional', profile_json: {} } })
  await assert.rejects(c.loadWorkspaceForUser(user), /no corresponde a tu cuenta/)
  assert.equal(calls.length, 1, 'A mismatched workspace is never saved into the current account')
})

test('invitation link state is reset on account change and late responses cannot restore an old token', async () => {
  assert.match(declaration('loadWorkspaceForUser'), /setInviteToken\(null\)/)
  let finish
  const writes = []
  const generation = { current: 1 }
  const c = {
    activeUserId: 'first', sessionGenerationRef: generation,
    localStorage: { getItem: () => 'second' }, SESSION_USER_KEY: 'active',
    getPatientInviteLink: () => new Promise(resolve => { finish = resolve }),
    setInviteBusy: () => {}, setInviteError: () => {},
    setInviteToken: token => writes.push(token), setInviteCopied: () => {},
  }
  vm.runInNewContext(ts.transpile(declaration('loadInviteLink')), c)
  const pending = c.loadInviteLink()
  generation.current = 2
  finish({ success: true, token: 'old-account-token' })
  await pending
  assert.equal(writes.length, 0)
})
