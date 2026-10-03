import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import vm from 'node:vm'
import ts from 'typescript'
import { readProfessionalSession, storeProfessionalSession, restoreProfessionalSessionToken, clearProfessionalSession,
  createProfessionalFetch, PROFESSIONAL_SESSION_KEY, GOOGLE_AUTO_LOGIN_BLOCKED_KEY } from '../src/professionalSession.ts'

function storage() {
  const data = new Map()
  return { getItem: (key) => data.get(key) ?? null, setItem: (key, value) => data.set(key, String(value)),
    removeItem: (key) => data.delete(key), clear: () => data.clear() }
}
globalThis.localStorage = storage()
globalThis.sessionStorage = storage()

test('mobile session survives closure of the tab and restores the same account', () => {
  localStorage.clear()
  sessionStorage.clear()
  storeProfessionalSession('account-a', 'token-a')
  sessionStorage.clear()
  assert.deepEqual(readProfessionalSession(), { userId: 'account-a', token: 'token-a' })
  assert.equal(restoreProfessionalSessionToken(), 'token-a')
  assert.equal(sessionStorage.getItem('drhappy-professional-session'), 'token-a')
  storeProfessionalSession('account-b', 'token-b')
  assert.deepEqual(readProfessionalSession(), { userId: 'account-b', token: 'token-b' })
  clearProfessionalSession()
  assert.equal(readProfessionalSession(), null)
  assert.equal(restoreProfessionalSessionToken(), null)
  assert.equal(localStorage.getItem(GOOGLE_AUTO_LOGIN_BLOCKED_KEY), 'true')
})

test('bound record takes precedence over torn legacy keys during account switches', () => {
  localStorage.clear()
  storeProfessionalSession('account-a', 'token-a')
  localStorage.setItem('drhappy-active-user', 'account-b')
  localStorage.setItem('drhappy-professional-session', 'token-b')
  assert.deepEqual(readProfessionalSession(), { userId: 'account-a', token: 'token-a' })
  localStorage.removeItem(PROFESSIONAL_SESSION_KEY)
  assert.deepEqual(readProfessionalSession(), { userId: 'account-b', token: 'token-b' })
  localStorage.setItem(PROFESSIONAL_SESSION_KEY, '{"token":"bad"}')
  assert.throws(() => readProfessionalSession(), /no es válida/)
  localStorage.clear()
})

test('all functions restore durable token even when sessionStorage was lost', async () => {
  let sent
  const send = createProfessionalFetch(async (_url, init) => { sent = init; return new Response('{}') },
    () => ({ userId: 'a', token: 'durable-token' }))
  await send('https://example.invalid/functions/v1/workspace-data', { method: 'POST' })
  assert.equal(sent.headers.get('x-drhappy-session'), 'durable-token')
  await assert.rejects(send('https://example.invalid/functions/v1/workspace-data', {
    headers: { 'x-drhappy-session': 'other-account-token' },
  }), /sesión cambió/)
})

test('responses from old accounts or signed out sessions cannot supply data', async () => {
  for (const next of [null, { userId: 'b', token: 'b-token' }, { userId: 'a', token: 'new-token' }]) {
    let current = { userId: 'a', token: 'a-token' }
    let finish
    const send = createProfessionalFetch(() => new Promise((resolve) => { finish = resolve }), () => current)
    const pending = send('https://example.invalid/functions/v1/workspace-data')
    current = next
    finish(new Response(JSON.stringify({ patients: ['private-old-account'] })))
    await assert.rejects(pending, /cuenta anterior/)
  }
})

test('Google login does not receive a professional token and non functions requests stay untouched', async () => {
  let init
  const send = createProfessionalFetch(async (_url, options) => { init = options; return new Response('{}') },
    () => ({ userId: 'a', token: 'a-token' }))
  await send('https://example.invalid/functions/v1/auth-professional')
  assert.equal(init.headers.has('x-drhappy-session'), false)
  await send('https://example.invalid/auth/v1/token', { method: 'POST' })
  assert.deepEqual(init, { method: 'POST' })
})

async function resolver(data, error = null) {
  const source = await readFile(new URL('../supabase/functions/_shared/professionalSession.ts', import.meta.url), 'utf8')
  const module = { exports: {} }
  vm.runInNewContext(ts.transpile(source.replace(/^import .*$/gm, ''), {
    target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS,
  }), { exports: module.exports, crypto, TextEncoder, Date, Deno: { env: { get: () => '' } } })
  let googleCalls = 0
  const query = { select() { return query }, eq() { return query }, is() { return query }, gt() { return query },
    maybeSingle: async () => ({ data, error }) }
  return {
    get googleCalls() { return googleCalls },
    resolve: (request) => module.exports.resolveProfessionalId(request, {
      from: () => query, auth: { getUser: async () => { googleCalls++; return { data: { user: null } } } },
    }),
  }
}

test('invalid explicit professional token never falls back to another Google account', async () => {
  const h = await resolver(null)
  assert.equal(await h.resolve(new Request('https://example.invalid', {
    headers: { 'x-drhappy-session': 'expired-account-a', Authorization: 'Bearer google-account-b' },
  })), null)
  assert.equal(h.googleCalls, 0)
})

test('valid custom session controls identity and validation outages are explicit', async () => {
  const h = await resolver({ professional_id: 'account-a', professionals: { active: true } })
  assert.equal(await h.resolve(new Request('https://example.invalid', {
    headers: { 'x-drhappy-session': 'a-token', Authorization: 'Bearer google-account-b' },
  })), 'account-a')
  assert.equal(h.googleCalls, 0)
  const unavailable = await resolver(null, { message: 'Database unavailable' })
  await assert.rejects(unavailable.resolve(new Request('https://example.invalid', {
    headers: { 'x-drhappy-session': 'a-token' },
  })), /No se pudo validar/)
})
