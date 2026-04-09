import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals'

describe('API env validator', () => {
  // Each test wants a fresh module so the singleton `env` re-runs validation
  // against whatever process.env we set up.
  const ORIGINAL_ENV = { ...process.env }

  beforeEach(() => {
    jest.resetModules()
    process.env = { ...ORIGINAL_ENV }
  })

  afterEach(() => {
    process.env = ORIGINAL_ENV
  })

  // The env module evaluates `export const env = validateEnv()` at the top
  // level, so loading the module is itself the assertion target — that's
  // exactly the boot path that crashed Fly in the post-mortem.
  function loadEnvModule() {
    return require('../../env')
  }

  it('returns a config in development without requiring secrets', () => {
    process.env.NODE_ENV = 'development'
    delete process.env.STRIPE_SECRET_KEY
    const mod = loadEnvModule()
    expect(mod.env.NODE_ENV).toBe('development')
    expect(mod.env.STRIPE_SECRET_KEY).toBeUndefined()
  })

  it('throws at module load in production when DATABASE_URL is missing', () => {
    process.env.NODE_ENV = 'production'
    delete process.env.DATABASE_URL
    process.env.WEB_ORIGIN = 'https://bobbinry.com'
    process.env.INTERNAL_API_AUTH_TOKEN = 'token'
    process.env.S3_ENDPOINT = 'https://s3.example.com'
    process.env.S3_ACCESS_KEY = 'access'
    process.env.S3_SECRET_KEY = 'secret'
    expect(() => loadEnvModule()).toThrow(/DATABASE_URL/)
  })

  // Regression test for the post-mortem in commit `a590af6`: missing optional
  // Stripe price IDs took the entire API down via a crash loop. They MUST be
  // recoverable — log a warning, return defaults, keep serving.
  it('does NOT throw in production when Stripe price IDs are unset', () => {
    process.env.NODE_ENV = 'production'
    process.env.DATABASE_URL = 'postgres://test'
    process.env.WEB_ORIGIN = 'https://bobbinry.com'
    process.env.INTERNAL_API_AUTH_TOKEN = 'token'
    process.env.S3_ENDPOINT = 'https://s3.example.com'
    process.env.S3_ACCESS_KEY = 'access'
    process.env.S3_SECRET_KEY = 'secret'
    delete process.env.STRIPE_SECRET_KEY
    delete process.env.STRIPE_WEBHOOK_SECRET
    delete process.env.STRIPE_SUPPORTER_MONTHLY_PRICE_ID
    delete process.env.STRIPE_SUPPORTER_YEARLY_PRICE_ID

    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      // Loading the module triggers `export const env = validateEnv()` once.
      // It must not throw when the recommended vars are missing.
      expect(() => loadEnvModule()).not.toThrow()
      // It should warn about the missing recommended vars instead.
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining('STRIPE_SUPPORTER_MONTHLY_PRICE_ID')
      )
    } finally {
      warnSpy.mockRestore()
    }
  })
})
