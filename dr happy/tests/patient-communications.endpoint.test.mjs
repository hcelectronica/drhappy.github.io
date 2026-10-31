import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import vm from 'node:vm'
import test from 'node:test'
import ts from 'typescript'
import * as helpers from '../supabase/functions/_shared/patientCommunications.ts'

const campaignId = '11111111-2222-4333-8444-555555555555'
const token = '99999999-2222-4333-8444-555555555555'
const source = await readFile(new URL('../supabase/functions/patient-communications/index.ts', import.meta.url), 'utf8')
const js = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText
function fixture() {
  const db = {
    professionals: [{ id: 'owner', is_admin: true, active: true, full_name: 'Fixture' }],
    patient_communication_admins: [{ professional_id: 'owner' }],
    user_workspaces: [{ user_id: 'owner', patients_json: [
      { id: 'own', email: 'one@example.invalid', nombre: 'One', ownerUserId: 'owner' },
      { id: 'foreign', email: 'foreign@example.invalid', ownerUserId: 'another' },
    ] }],
    patient_accounts: [
      { id: 'opt', email: 'opt@example.invalid', active: true, email_verified_at: 'yes', full_name: 'Opt' },
      { id: 'no', email: 'no@example.invalid', active: true, email_verified_at: 'yes', full_name: 'No' },
      { id: 'legacy', email: 'legacy@example.invalid', active: true, email_verified_at: 'yes', full_name: 'Legacy' },
      { id: 'out', email: 'out@example.invalid', active: true, email_verified_at: 'yes', full_name: 'Out' },
      { id: 'unverified', email: 'unverified@example.invalid', active: true, email_verified_at: null },
      { id: 'inactive', email: 'inactive@example.invalid', active: false, email_verified_at: 'yes' },
    ],
    patient_email_preferences: [
      { email: 'opt@example.invalid', token, opted_in: true, opted_out: false },
      { email: 'legacy@example.invalid', token: 'legacy-token', opted_in: false, opted_out: false },
      { email: 'out@example.invalid', token: 'out-token', opted_in: false, opted_out: true },
    ],
    virtual_consult_settings: [{ professional_id: 'owner', slug: 'fixture-doctor', enabled: true }],
    patient_email_campaigns: [], patient_email_recipients: [],
  }
  const state = { identity: 'owner', sent: [], timeout: false }
  function from(table) {
    const filters = []
    let mutation, values, single = false, head = false, start = 0, end = Infinity
    const builder = {
      select(_columns, options) { head = options?.head === true; return builder },
      eq(key, value) { filters.push(row => row[key] === value); return builder },
      not(key, _op, value) { filters.push(row => row[key] !== value && row[key] !== undefined); return builder },
      order() { return builder },
      range(a, b) { start = a; end = b + 1; return builder },
      limit(n) { end = n; return builder },
      maybeSingle() { single = true; return builder }, single() { single = true; return builder },
      update(value) { mutation = 'update'; values = value; return builder },
      upsert(value) { mutation = 'upsert'; values = value; return builder },
      then(resolve, reject) {
        try {
          if (mutation === 'upsert' && !db[table].some(r => r.email === values.email)) db[table].push({ ...values, token, opted_in: false, opted_out: false })
          const rows = db[table].filter(row => filters.every(f => f(row)))
          if (mutation === 'update') rows.forEach(row => Object.assign(row, values))
          const selected = rows.slice(start, end)
          return Promise.resolve({ data: head ? null : single ? selected[0] ?? null : selected, count: rows.length, error: null }).then(resolve, reject)
        } catch (error) { return Promise.reject(error).then(resolve, reject) }
      },
    }
    return builder
  }
  const admin = { from, async rpc(name, args) {
    if (name === 'create_patient_email_campaign') {
      if (!db.patient_email_campaigns.some(c => c.id === args.p_id)) {
        db.patient_email_campaigns.push({ id: args.p_id, professional_id: args.p_professional, audience: args.p_audience,
          template: args.p_template, subject: args.p_subject, message: args.p_message, link: args.p_link, status: 'draft' })
        db.patient_email_recipients.push(...args.p_recipients.map((r, i) => ({ ...r, id: `recipient-${i}`, campaign_id: args.p_id, status: 'pending' })))
      }
      return { data: args.p_id, error: null }
    }
    const claimed = db.patient_email_recipients.filter(r => r.campaign_id === args.p_id && r.status === 'pending').slice(0, 5)
    claimed.forEach(r => { r.status = 'sending' })
    return { data: claimed, error: null }
  } }
  let handler
  vm.runInNewContext(js, {
    exports: {}, Response, Request, URL, URLSearchParams, AbortSignal, console: { error() {} },
    Deno: { env: { get: key => key === 'SUPABASE_URL' ? 'https://fixture.invalid' : 'fixture-key' } },
    require: name => name.includes('server.ts') ? { serve: h => { handler = h } } : name.includes('supabase-js') ? { createClient: () => admin }
      : name.includes('professionalSession') ? { resolveProfessionalId: async () => state.identity }
        : name.includes('cors') ? { corsHeaders: {} }
        : name.includes('patientFolderReferral') ? { patientFolderUrl: async (_admin, id) => {
          assert.equal(id, 'owner'); return 'https://www.drhappy.com.ar/s/aaaaaaaaaa'
        } } : helpers,
    fetch: async (url, init) => {
      assert.equal(url, 'https://fixture.invalid/functions/v1/send-email')
      const message = JSON.parse(init.body)
      assert.equal(typeof message.to, 'string')
      assert.ok(message.to.endsWith('@example.invalid'))
      state.sent.push(message)
      if (state.timeout) throw new Error('Simulated SMTP timeout')
      return Response.json({ success: true, accepted: [message.to] })
    },
  })
  const call = async body => {
    const response = await handler(new Request('https://fixture.invalid', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }))
    return { status: response.status, body: await response.json() }
  }
  const preview = overrides => call({ action: 'preview', audience: 'own', template: 'folder', campaignId, subject: 'Fixture', message: 'Invitation',
    permissionConfirmed: true, all: true, ...overrides })
  return { db, state, call, preview }
}
test('Server authorization ignores claimed requester; registered audience includes verified active accounts without opt-in and respects opt-out', async () => {
  const f = fixture()
  f.state.identity = null
  assert.equal((await f.call({ action: 'contacts', audience: 'own', requesterId: 'owner' })).status, 401)
  f.state.identity = 'another'
  assert.equal((await f.call({ action: 'contacts', audience: 'own' })).status, 403)
  f.state.identity = 'owner'
  assert.deepEqual((await f.call({ action: 'contacts', audience: 'own' })).body.contacts.map(r => r.id), ['own'])
  const contacts = (await f.call({ action: 'contacts', audience: 'folder' })).body.contacts
  assert.equal(contacts.length, 4)
  assert.equal(contacts.find(r => r.id === 'opt').eligible, true)
  assert.equal(contacts.find(r => r.id === 'no').eligible, true)
  assert.equal(contacts.find(r => r.id === 'legacy').eligible, true)
  assert.equal(contacts.find(r => r.id === 'out').eligible, false)
  assert.equal(contacts.find(r => r.id === 'out').reason, 'Solicitó la baja')
  assert.ok(!JSON.stringify(contacts).includes(token))
})
test('Preview fixes destination link and recipients on server, requires permission and explicit sending confirmation', async () => {
  const f = fixture()
  assert.equal((await f.preview({ permissionConfirmed: false })).status, 400)
  assert.equal((await f.preview({ all: false, contactIds: ['foreign'], to: 'outside@example.invalid' })).status, 400)
  assert.equal((await f.preview({ link: 'https://malicious.invalid' })).body.campaign.link, 'https://www.drhappy.com.ar/s/aaaaaaaaaa')
  assert.equal(f.state.sent.length, 0)
  assert.equal((await f.call({ action: 'send-batch', campaignId })).status, 400)
  await f.call({ action: 'send-batch', campaignId, confirm: true })
  await f.call({ action: 'send-batch', campaignId, confirm: true })
  assert.equal(f.state.sent.length, 1)
  assert.equal(f.state.sent[0].to, 'one@example.invalid')
  assert.ok(f.state.sent[0].html.includes('/paciente?unsubscribe='))
})
test('Unsubscribe is token-only, explicit, and honored even after preview', async () => {
  const f = fixture()
  await f.preview({ audience: 'folder', all: false, contactIds: ['opt'] })
  assert.equal((await f.call({ action: 'unsubscribe', token: 'bad' })).status, 400)
  f.state.identity = null
  assert.equal((await f.call({ action: 'unsubscribe', token })).status, 200)
  f.state.identity = 'owner'
  await f.call({ action: 'send-batch', campaignId, confirm: true })
  assert.equal(f.state.sent.length, 0)
  assert.equal(f.db.patient_email_recipients[0].status, 'skipped')
})
test('A deactivated patient or changed virtual destination cannot receive a stale campaign', async () => {
  const f = fixture()
  await f.preview({ audience: 'folder', all: false, contactIds: ['opt'] })
  f.db.patient_accounts[0].active = false
  await f.call({ action: 'send-batch', campaignId, confirm: true })
  assert.equal(f.state.sent.length, 0)
  const v = fixture()
  await v.preview({ template: 'virtual' })
  v.db.virtual_consult_settings[0].enabled = false
  assert.equal((await v.call({ action: 'send-batch', campaignId, confirm: true })).status, 409)
  assert.equal(v.state.sent.length, 0)
})
test('SMTP timeouts remain uncertain and are never automatically resent', async () => {
  const f = fixture()
  await f.preview()
  f.state.timeout = true
  await f.call({ action: 'send-batch', campaignId, confirm: true })
  assert.equal(f.db.patient_email_recipients[0].status, 'uncertain')
  await f.call({ action: 'send-batch', campaignId, confirm: true })
  assert.equal(f.state.sent.length, 1)
})
test('All registered sends include no-preference and legacy opted_in=false accounts without inventing consent', async () => {
  const f = fixture()
  const preview = await f.preview({ audience: 'folder' })
  assert.equal(preview.body.campaign.total, 3)
  assert.equal(f.state.sent.length, 0)
  const result = await f.call({ action: 'send-batch', campaignId, confirm: true })
  assert.equal(result.body.campaign.counts.sent, 3)
  assert.deepEqual(f.state.sent.map(r => r.to).sort(), ['legacy@example.invalid', 'no@example.invalid', 'opt@example.invalid'])
  assert.equal(f.db.patient_email_preferences.find(p => p.email === 'no@example.invalid').opted_in, false)
  assert.equal(f.db.patient_email_preferences.find(p => p.email === 'legacy@example.invalid').opted_in, false)
  assert.equal(f.db.patient_email_preferences.find(p => p.email === 'out@example.invalid').opted_out, true)
})
test('A newly unsubscribed or unverified registered recipient is skipped before sending', async () => {
  for (const change of ['unsubscribe', 'unverify']) {
    const f = fixture()
    await f.preview({ audience: 'folder', all: false, contactIds: ['legacy'] })
    if (change === 'unsubscribe') f.db.patient_email_preferences.find(p => p.email === 'legacy@example.invalid').opted_out = true
    else f.db.patient_accounts.find(p => p.id === 'legacy').email_verified_at = null
    const result = await f.call({ action: 'send-batch', campaignId, confirm: true })
    assert.equal(result.body.campaign.counts.skipped, 1)
    assert.equal(f.state.sent.length, 0)
  }
})
