import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals'

/**
 * Regression guard: the suites must never send real email.
 *
 * test-setup.ts loads the root .env (symlinked into apps/api/) into process.env
 * before anything imports env.ts, so the production RESEND_API_KEY is genuinely
 * present while tests run. The auth routes send on signup/verify/reset, so for a
 * while every local `bun run test` fired ~12 live messages from the production
 * sending domain at addresses that hard-bounce — burning the daily Resend quota
 * and, worse, the domain's bounce reputation.
 *
 * sendEmail() is the single chokepoint, so the NODE_ENV==='test' stop lives
 * there. These tests assert it holds even when a valid-looking key is set.
 */
describe('sendEmail test-environment guard', () => {
  const ORIGINAL_ENV = { ...process.env }
  const send = jest.fn<(...args: unknown[]) => Promise<unknown>>()

  beforeEach(() => {
    jest.resetModules()
    send.mockReset()
    send.mockResolvedValue({ data: { id: 'should-never-happen' }, error: null })
    process.env = { ...ORIGINAL_ENV }

    jest.doMock('resend', () => ({
      Resend: class {
        emails = { send }
      },
    }))
  })

  afterEach(() => {
    process.env = ORIGINAL_ENV
    jest.dontMock('resend')
  })

  function loadEmailModule() {
    return require('../../email')
  }

  it('does not send when NODE_ENV is test, even with an API key present', async () => {
    process.env.NODE_ENV = 'test'
    process.env.RESEND_API_KEY = 're_fake_key_for_tests'

    const { sendEmail } = loadEmailModule()
    const result = await sendEmail({
      to: 'nobody@example.com',
      subject: 'should not be sent',
      html: '<p>nope</p>',
    })

    expect(result).toBe(false)
    expect(send).not.toHaveBeenCalled()
  })

  it('does not send the auth emails either, since they funnel through sendEmail', async () => {
    process.env.NODE_ENV = 'test'
    process.env.RESEND_API_KEY = 're_fake_key_for_tests'

    const { sendVerificationEmail, sendWelcomeEmail, sendPasswordResetEmail } = loadEmailModule()

    await expect(sendVerificationEmail('nobody@example.com', 'tok')).resolves.toBe(false)
    await expect(sendWelcomeEmail('nobody@example.com')).resolves.toBe(false)
    await expect(sendPasswordResetEmail('nobody@example.com', 'tok')).resolves.toBe(false)

    expect(send).not.toHaveBeenCalled()
  })

  it('still sends outside the test environment, so the guard is not over-broad', async () => {
    process.env.NODE_ENV = 'production'
    process.env.RESEND_API_KEY = 're_fake_key_for_tests'
    // env.ts requires the Stripe vars in production; supply placeholders so the
    // module loads and we are testing the email guard, not env validation.
    process.env.STRIPE_SECRET_KEY = 'sk_test_placeholder'
    process.env.STRIPE_WEBHOOK_SECRET = 'whsec_placeholder'
    process.env.NEXTAUTH_SECRET = 'placeholder'
    process.env.INTERNAL_API_AUTH_TOKEN = 'placeholder'
    process.env.DATABASE_URL = 'postgres://u:p@localhost:5432/placeholder'

    const { sendEmail } = loadEmailModule()
    const result = await sendEmail({
      to: 'somebody@example.com',
      subject: 'real send',
      html: '<p>yes</p>',
    })

    expect(result).toBe(true)
    expect(send).toHaveBeenCalledTimes(1)
  })
})
