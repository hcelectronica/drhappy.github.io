import test from 'node:test'
import assert from 'node:assert/strict'
import { hasMedicalToolAccess, hasMedicalToolRowAccess } from '../supabase/functions/_shared/medicalToolAccess.ts'

const now = Date.parse('2026-10-10T12:00:00Z')
const day = 86400000
const physician = { specialty: 'Médico', active: true, subscriptionStatus: 'trial', trialStartedAt: new Date(now - day).toISOString() }

test('physicians receive full access during trial and active subscriptions, without administrator privileges', () => {
  assert.equal(hasMedicalToolAccess(physician, ['attention', 'ledger', 'appointments'], now), true)
  assert.equal(hasMedicalToolAccess({ ...physician, subscriptionStatus: 'active', subscriptionExpiresAt: new Date(now + day).toISOString() }, ['attention'], now), true)
  assert.equal(hasMedicalToolAccess({ ...physician, subscriptionStatus: 'active', subscriptionExpiresAt: null }, ['attention'], now), true)
  assert.equal(hasMedicalToolAccess({ isAdmin: true }, ['attention'], now), true)
  assert.equal(hasMedicalToolAccess({ isAdmin: true, specialty: 'Odontólogo' }, ['attention'], now), true)
})

test('exact seven-day boundary, expired subscriptions, cancellations and malformed dates deny access', () => {
  for (const user of [
    { ...physician, trialStartedAt: new Date(now - 7 * day).toISOString() },
    { ...physician, trialStartedAt: new Date(now + day).toISOString() },
    { ...physician, trialStartedAt: 'invalid' },
    { ...physician, trialStartedAt: null },
    { ...physician, subscriptionStatus: 'expired' },
    { ...physician, subscriptionStatus: 'cancelled' },
    { ...physician, active: false },
    { ...physician, subscriptionStatus: 'active', subscriptionExpiresAt: new Date(now).toISOString() },
    { ...physician, subscriptionStatus: 'active', subscriptionExpiresAt: 'invalid' },
  ]) assert.equal(hasMedicalToolAccess(user, ['attention'], now), false)
  assert.equal(hasMedicalToolAccess({ ...physician, trialStartedAt: new Date(now - 7 * day + 1).toISOString() }, ['attention'], now), true)
})

test('dentists and psychologists receive no new tools, including former pilot emails', () => {
  for (const specialty of ['Odontólogo', 'Odontóloga', 'Médico odontólogo', 'Psicólogo', '']) {
    assert.equal(hasMedicalToolAccess({ ...physician, specialty, subscriptionStatus: 'active' }, ['attention'], now), false)
  }
  assert.equal(hasMedicalToolRowAccess({ specialty: 'Odontólogo', email: 'mudimudialan@gmail.com', subscription_status: 'active' }, ['attention'], now), false)
})

test('enabled modules are respected on frontend and backend; legacy null uses profession defaults', () => {
  assert.equal(hasMedicalToolAccess({ ...physician, enabledModules: ['attention'] }, ['attention'], now), true)
  assert.equal(hasMedicalToolAccess({ ...physician, enabledModules: ['attention'] }, ['attention', 'ledger'], now), false)
  assert.equal(hasMedicalToolAccess({ ...physician, enabledModules: [] }, ['attention'], now), false)
  assert.equal(hasMedicalToolAccess({ ...physician, enabledModules: 'attention' }, ['attention'], now), false)
  assert.equal(hasMedicalToolRowAccess({ specialty: physician.specialty, active: true, subscription_status: 'trial', trial_started_at: physician.trialStartedAt, enabled_modules_json: ['attention'] }, ['attention'], now), true)
  assert.equal(hasMedicalToolRowAccess(null, ['attention'], now), false)
})
