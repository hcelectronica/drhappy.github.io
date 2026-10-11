import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import vm from 'node:vm'
import ts from 'typescript'

const source = await readFile(new URL('../src/App.tsx', import.meta.url), 'utf8')
const start = source.indexOf('  async function handleGoogleLogin()')
const end = source.indexOf('  async function handleStartSubscriptionCheckout', start)
assert(start >= 0 && end > start, 'Google login handler must exist')
const handler = ts.transpileModule(source.slice(start, end), {
  compilerOptions: { target: ts.ScriptTarget.ES2022 },
}).outputText

for (const [origin, pathname] of [
  ['https://drhappy.com.ar', '/'],
  ['https://www.drhappy.com.ar', '/'],
  ['https://drhappy.com.ar', '/index.html'],
  ['http://127.0.0.1:5175', '/'],
  ['http://localhost:5175', '/'],
]) {
  test(`Google returns inside the original app origin: ${origin}${pathname}`, async () => {
    const storage = new Map([['blocked', 'true']])
    let options
    const context = vm.createContext({
      isSupabaseConfigured: true,
      supabase: { auth: { signInWithOAuth: async value => { options = value; return { error: null } } } },
      window: { location: { origin, pathname, search: '?status=approved', hash: '#private' } },
      localStorage: {
        setItem: (key, value) => storage.set(key, value),
        removeItem: key => storage.delete(key),
      },
      GOOGLE_LOGIN_PENDING_KEY: 'pending',
      GOOGLE_AUTO_LOGIN_BLOCKED_KEY: 'blocked',
      setAuthError: message => assert.equal(message, null),
      Date,
    })
    await vm.runInContext(handler + '\nhandleGoogleLogin()', context)
    assert.equal(options.provider, 'google')
    assert.equal(options.options.redirectTo, origin + pathname)
    assert.equal(options.options.queryParams.prompt, 'select_account')
    assert(storage.has('pending'))
    assert(!storage.has('blocked'))
  })
}

test('Google login rejection clears pending intent and surfaces its error', async () => {
  const storage = new Map()
  const errors = []
  const context = vm.createContext({
    isSupabaseConfigured: true,
    supabase: { auth: { signInWithOAuth: async () => ({ error: { message: 'OAuth unavailable' } }) } },
    window: { location: { origin: 'https://drhappy.com.ar', pathname: '/' } },
    localStorage: {
      setItem: (key, value) => storage.set(key, value),
      removeItem: key => storage.delete(key),
    },
    GOOGLE_LOGIN_PENDING_KEY: 'pending',
    GOOGLE_AUTO_LOGIN_BLOCKED_KEY: 'blocked',
    setAuthError: message => errors.push(message),
    Date,
  })
  await vm.runInContext(handler + '\nhandleGoogleLogin()', context)
  assert(!storage.has('pending'))
  assert.match(errors.at(-1), /OAuth unavailable/)
})
