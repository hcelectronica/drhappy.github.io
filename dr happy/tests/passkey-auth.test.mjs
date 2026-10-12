import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import vm from 'node:vm'
import ts from 'typescript'

const professional = {
  id: 'professional-a',
  username: 'doctor',
  full_name: 'Doctora Prueba',
  specialty: 'Médica',
  license_number: '123',
  dni: null,
  email: 'doctor@example.invalid',
  network_memberships_json: [],
  is_admin: false,
  active: true,
  enabled_modules_json: [],
  trial_started_at: null,
  subscription_status: 'trial',
  subscription_expires_at: null,
}

function createHarness({ credentials = [] } = {}) {
  const tables = {
    professionals: [professional],
    professional_passkeys: [...credentials],
    professional_passkey_challenges: [],
  }
  const writes = []
  let sessionCount = 0
  let generatedAuthenticationOptions = null
  let serveHandler

  class Query {
    constructor(table) {
      this.table = table
      this.operation = 'select'
      this.filters = []
      this.value = null
      this.returning = false
    }
    select() { this.returning = true; return this }
    insert(value) { this.operation = 'insert'; this.value = value; writes.push({ table: this.table, value }); return this }
    update(value) { this.operation = 'update'; this.value = value; writes.push({ table: this.table, value }); return this }
    delete() { this.operation = 'delete'; return this }
    eq(key, value) { this.filters.push((row) => row[key] === value); return this }
    lt(key, value) { this.filters.push((row) => row[key] < value); return this }
    gt(key, value) { this.filters.push((row) => row[key] > value); return this }
    order() { return this }
    maybeSingle() { return this.run(true) }
    then(resolve, reject) { return this.run(false).then(resolve, reject) }
    async run(single) {
      const rows = tables[this.table]
      const matches = rows.filter((row) => this.filters.every((filter) => filter(row)))
      if (this.operation === 'insert') {
        if (this.table === 'professional_passkeys' && rows.some((row) => row.credential_id === this.value.credential_id)) {
          return { data: null, error: { code: '23505', message: 'duplicate credential' } }
        }
        const row = { id: crypto.randomUUID(), ...this.value }
        rows.push(row)
        return { data: this.returning ? row : null, error: null }
      }
      if (this.operation === 'delete') {
        for (const row of matches) rows.splice(rows.indexOf(row), 1)
        return { data: this.returning ? (matches[0] ?? null) : null, error: null }
      }
      if (this.operation === 'update') {
        const row = matches[0]
        if (row) Object.assign(row, this.value)
        return { data: this.returning ? (row ?? null) : null, error: null }
      }
      return { data: single ? (matches[0] ?? null) : matches, error: null }
    }
  }

  const admin = { from: (table) => new Query(table) }
  const sourcePromise = readFile(new URL('../supabase/functions/passkey-auth/index.ts', import.meta.url), 'utf8')
  const harnessPromise = sourcePromise.then((source) => {
    const executable = source
      .replace(/^import[\s\S]*?from\s+['"][^'"]+['"];?\s*/gm, '')
    vm.runInNewContext(ts.transpile(executable, {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.None,
    }), {
      serve: (handler) => { serveHandler = handler },
      createClient: () => admin,
      corsHeaders: {},
      resolveProfessionalId: async (request) => request.headers.get('x-drhappy-session') === 'valid-session'
        ? professional.id
        : null,
      createProfessionalSession: async () => { sessionCount += 1; return 'issued-session' },
      generateRegistrationOptions: async () => ({ challenge: 'registration-challenge' }),
      generateAuthenticationOptions: async (options) => {
        generatedAuthenticationOptions = options
        return { challenge: 'authentication-challenge' }
      },
      verifyRegistrationResponse: async (options) => {
        assert.equal(options.expectedOrigin, 'https://www.drhappy.com.ar')
        assert.equal(options.expectedRPID, 'www.drhappy.com.ar')
        assert.equal(options.requireUserVerification, true)
        return {
          verified: true,
          registrationInfo: {
            credential: { id: 'credential-a', publicKey: new Uint8Array([1, 2, 3]), counter: 0, transports: ['internal'] },
            credentialDeviceType: 'singleDevice',
            credentialBackedUp: false,
          },
        }
      },
      verifyAuthenticationResponse: async (options) => {
        assert.equal(options.expectedChallenge, 'authentication-challenge')
        assert.equal(options.expectedOrigin, 'https://www.drhappy.com.ar')
        assert.deepEqual(Array.from(options.credential.publicKey), [1, 2, 3])
        assert.equal(options.requireUserVerification, true)
        return { verified: true, authenticationInfo: { newCounter: 1 } }
      },
      Deno: { env: { get: (name) => ({
        SUPABASE_URL: 'https://example.invalid',
        SUPABASE_SERVICE_ROLE_KEY: 'service-role-test',
        ENABLE_EMAIL_VERIFICATION: 'false',
      })[name] ?? null } },
      crypto,
      TextEncoder,
      Request,
      Response,
      URL,
      btoa,
      atob,
      console: { error() {}, warn() {} },
      Date,
    })
  })

  return {
    tables,
    writes,
    get generatedAuthenticationOptions() { return generatedAuthenticationOptions },
    get sessionCount() { return sessionCount },
    request: async (body, { origin = 'https://www.drhappy.com.ar', token } = {}) => {
      await harnessPromise
      const headers = { 'content-type': 'application/json', origin }
      if (token) headers['x-drhappy-session'] = token
      const response = await serveHandler(new Request('https://example.invalid', {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
      }))
      return { status: response.status, body: await response.json() }
    },
  }
}

test('passkey enrollment requires an existing professional session and trusted origin', async () => {
  const h = createHarness()
  const unauthorized = await h.request({ action: 'registration-options' })
  assert.equal(unauthorized.status, 401)

  const untrustedOrigin = await h.request({ action: 'registration-options' }, {
    origin: 'https://attacker.example',
    token: 'valid-session',
  })
  assert.equal(untrustedOrigin.status, 400)
  assert.equal(h.tables.professional_passkey_challenges.length, 0)

  const options = await h.request({ action: 'registration-options' }, { token: 'valid-session' })
  assert.equal(options.status, 200)
  assert.equal(options.body.options.challenge, 'registration-challenge')
  assert.equal(h.tables.professional_passkey_challenges[0].expected_origin, 'https://www.drhappy.com.ar')
  assert.equal(h.tables.professional_passkey_challenges[0].rp_id, 'www.drhappy.com.ar')

  const registration = await h.request({
    action: 'registration-verify',
    challenge: 'registration-challenge',
    response: { id: 'credential-a' },
  }, { token: 'valid-session' })
  assert.equal(registration.status, 200)
  assert.equal(h.tables.professional_passkeys.length, 1)
  assert.equal(h.tables.professional_passkeys[0].public_key, 'AQID')
  assert.equal(h.tables.professional_passkeys[0].sign_count, 0)
})

test('passkey login creates one server session and consumes its challenge once', async () => {
  const h = createHarness({
    credentials: [{
      id: 'passkey-row',
      professional_id: professional.id,
      credential_id: 'credential-a',
      public_key: 'AQID',
      sign_count: 0,
      transports: ['internal'],
    }],
  })
  const options = await h.request({ action: 'authentication-options' })
  assert.equal(options.status, 200)
  assert.equal(h.generatedAuthenticationOptions.allowCredentials, undefined)
  assert.equal(h.tables.professional_passkey_challenges[0].professional_id, null)

  const body = {
    action: 'authentication-verify',
    challenge: 'authentication-challenge',
    response: { id: 'credential-a' },
  }
  const login = await h.request(body)
  assert.equal(login.status, 200)
  assert.equal(login.body.sessionToken, 'issued-session')
  assert.equal(login.body.professional.id, professional.id)
  assert.equal(h.sessionCount, 1)
  assert.equal(h.tables.professional_passkeys[0].sign_count, 1)

  const replay = await h.request(body)
  assert.equal(replay.status, 400)
  assert.equal(h.sessionCount, 1)
})

test('passkey login does not issue a session when no credential is registered', async () => {
  const h = createHarness()
  const options = await h.request({ action: 'authentication-options' })
  assert.equal(options.status, 200)
  const result = await h.request({
    action: 'authentication-verify',
    challenge: 'authentication-challenge',
    response: { id: 'unknown-credential' },
  })
  assert.equal(result.status, 401)
  assert.equal(h.sessionCount, 0)
  assert.equal(h.tables.professional_passkey_challenges.length, 0)
})
