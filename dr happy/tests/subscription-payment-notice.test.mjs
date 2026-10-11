import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import vm from 'node:vm'
import ts from 'typescript'
import {
  adminSubscriptionPaymentEmail,
  notifyAdminSubscriptionPayment,
} from '../supabase/functions/_shared/adminSubscriptionPaymentEmail.ts'

const paymentNotice = {
  paymentId: 'mp-payment-123',
  professionalId: 'professional-123',
  professionalName: '<Dra. Demo>',
  professionalUsername: 'demo',
  professionalEmail: 'demo@example.invalid',
  plan: 'semiannual',
  amount: 78000,
  approvedAt: '2026-10-11T15:00:00.000Z',
  expiresAt: '2027-04-09T15:00:00.000Z',
  paymentMethod: 'visa',
}

test('payment email gives the administrator the identifying and accounting details', () => {
  const email = adminSubscriptionPaymentEmail(paymentNotice)
  assert.equal(email.to, 'alan.moodie@hotmail.com')
  assert.equal(email.subject, 'Dr Happy - Pago de suscripción acreditado')
  for (const value of ['Dra. Demo', 'demo@example.invalid', 'ID de pago de Mercado Pago: mp-payment-123', 'Semestral', 'visa']) {
    assert.ok(email.text.includes(value))
  }
  assert.match(email.text, /78\.000/)
  assert.match(email.templateData.message, /&lt;Dra\. Demo&gt;/)
})

test('payment email delivery verifies HTTP and send-email confirmation', async () => {
  await notifyAdminSubscriptionPayment('https://example.invalid', 'service-key', paymentNotice, async (url, request) => {
    assert.equal(url, 'https://example.invalid/functions/v1/send-email')
    assert.equal(new Headers(request.headers).get('apikey'), 'service-key')
    assert.equal(JSON.parse(request.body).to, 'alan.moodie@hotmail.com')
    return new Response('{"success":true}')
  })
  await assert.rejects(
    notifyAdminSubscriptionPayment('https://example.invalid', 'service-key', paymentNotice, async () => new Response('{"success":false}')),
    /No se confirmó el envío/,
  )
})

async function mockWebhook({ failEmail = false } = {}) {
  let handler
  let sentAt = null
  let claim = false
  let attempts = 0
  let emailFails = failEmail
  const emails = []
  const professional = { full_name: 'Profesional Demo', username: 'demo', email: 'demo@example.invalid' }
  const client = {
    from(table) {
      let selected = ''
      let value = ''
      return {
        select(columns) { selected = columns; return this },
        eq(column, nextValue) { value = nextValue; return this },
        async single() {
          if (table === 'subscription_payments' && selected === 'admin_notice_sent_at' && value === 'mp-payment-123') {
            return { data: { admin_notice_sent_at: sentAt }, error: null }
          }
          if (table === 'professionals' && value === 'professional-123') return { data: professional, error: null }
          return { data: null, error: { message: 'Unexpected database lookup' } }
        },
      }
    },
    async rpc(name, args) {
      if (name === 'apply_subscription_payment') return { data: { applied: sentAt === null, expiresAt: paymentNotice.expiresAt }, error: null }
      if (name === 'claim_subscription_payment_notice') {
        attempts += 1
        if (claim || sentAt) return { data: false, error: null }
        claim = true
        return { data: true, error: null }
      }
      if (name === 'complete_subscription_payment_notice') {
        if (!claim) return { data: false, error: null }
        claim = false
        if (args.p_succeeded) sentAt = paymentNotice.approvedAt
        return { data: true, error: null }
      }
      return { data: null, error: { message: `Unexpected RPC ${name}` } }
    },
  }

  const source = (await readFile(new URL('../supabase/functions/mercadopago-webhook/index.ts', import.meta.url), 'utf8'))
    .replace(/^import .*$/gm, '')
  vm.runInNewContext(ts.transpile(source, { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None }), {
    serve: callback => { handler = callback },
    createClient: () => client,
    notifyAdminSubscriptionPayment: async (_url, _key, details) => {
      if (emailFails) throw new Error('Mail provider unavailable')
      emails.push(details)
    },
    corsHeaders: {},
    Deno: { env: { get: name => ({ MP_ACCESS_TOKEN: 'mp-test', SUPABASE_URL: 'https://supabase.invalid', SUPABASE_SERVICE_ROLE_KEY: 'service-key' })[name] } },
    fetch: async url => {
      assert.equal(url, 'https://api.mercadopago.com/v1/payments/mp-payment-123')
      return Response.json({
        status: 'approved',
        external_reference: 'professional-123',
        date_approved: paymentNotice.approvedAt,
        transaction_amount: paymentNotice.amount,
        currency_id: 'ARS',
        payment_method_id: 'visa',
        metadata: { user_id: 'professional-123', plan: 'semiannual' },
      })
    },
    console,
    URL,
    Request,
    Response,
  })
  const call = () => handler(new Request('https://webhook.invalid/?type=payment&id=mp-payment-123', { method: 'GET' }))
  return { call, emails, setEmailFails: value => { emailFails = value }, get sentAt() { return sentAt }, get attempts() { return attempts } }
}

test('approved payments notify once and failed email delivery remains retryable', async () => {
  const flow = await mockWebhook()
  const first = await flow.call()
  assert.equal(first.status, 200)
  assert.equal((await first.json()).adminNotified, true)
  assert.equal(flow.emails.length, 1)
  assert.equal(flow.emails[0].professionalId, 'professional-123')
  assert.equal(flow.sentAt, paymentNotice.approvedAt)
  assert.equal((await flow.call()).status, 200)
  assert.equal(flow.emails.length, 1, 'Duplicate Mercado Pago webhooks do not send duplicate notices')

  const retry = await mockWebhook({ failEmail: true })
  assert.equal((await retry.call()).status, 502)
  assert.equal(retry.sentAt, null, 'Failed delivery is not recorded as sent')
  retry.setEmailFails(false)
  assert.equal((await retry.call()).status, 200)
  assert.equal(retry.emails.length, 1, 'A later provider retry sends the notice')
  assert.equal(retry.sentAt, paymentNotice.approvedAt)
})

test('migration records notification state and restricts claim operations to service role', async () => {
  const migration = await readFile(new URL('../supabase/migrations/20261011010000_admin_subscription_payment_email.sql', import.meta.url), 'utf8')
  assert.match(migration, /admin_notice_sent_at/)
  assert.match(migration, /admin_notice_attempts/)
  assert.match(migration, /claim_subscription_payment_notice/)
  assert.match(migration, /complete_subscription_payment_notice/)
  assert.match(migration, /TO service_role/)
})
