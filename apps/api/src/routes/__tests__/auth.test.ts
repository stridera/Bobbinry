import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from '@jest/globals'
import { db } from '../../db/connection'
import { users, emailVerificationTokens, passwordResetTokens } from '../../db/schema'
import { eq } from 'drizzle-orm'
import { createTestApp, createTestToken, createTestUser, createTestUserWithPassword, cleanupAllTestData } from '../../__tests__/test-helpers'

/** Poll DB until a verification token appears for the user (async token creation). */
async function waitForVerificationToken(userId: string, maxMs = 3000): Promise<string> {
  const start = Date.now()
  while (Date.now() - start < maxMs) {
    const [row] = await db
      .select()
      .from(emailVerificationTokens)
      .where(eq(emailVerificationTokens.userId, userId))
      .limit(1)
    if (row) return row.token
    await new Promise(r => setTimeout(r, 100))
  }
  throw new Error('Verification token not found within timeout')
}

/** Poll DB until a password reset token appears for the user. */
async function waitForResetToken(userId: string, maxMs = 3000): Promise<string> {
  const start = Date.now()
  while (Date.now() - start < maxMs) {
    const [row] = await db
      .select()
      .from(passwordResetTokens)
      .where(eq(passwordResetTokens.userId, userId))
      .limit(1)
    if (row) return row.token
    await new Promise(r => setTimeout(r, 100))
  }
  throw new Error('Password reset token not found within timeout')
}

describe('Auth API', () => {
  let app: any

  beforeAll(async () => {
    app = await createTestApp()
  })

  afterAll(async () => {
    await app.close()
  })

  afterEach(async () => {
    await cleanupAllTestData()
  })

  // ──────────────────────────────────────────
  // SIGNUP
  // ──────────────────────────────────────────

  describe('POST /api/auth/signup', () => {
    it('creates a user with email and password', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/auth/signup',
        payload: { email: 'signup@test.local', password: 'password123', name: 'Signup User' }
      })

      expect(res.statusCode).toBe(201)
      const body = JSON.parse(res.payload)
      expect(body.id).toBeDefined()
      expect(body.email).toBe('signup@test.local')
      expect(body.name).toBe('Signup User')
      expect(body.passwordHash).toBeUndefined()
      expect(body.password).toBeUndefined()
    })

    it('returns 400 for missing email', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/auth/signup',
        payload: { password: 'password123' }
      })

      expect(res.statusCode).toBe(400)
    })

    it('returns 409 for duplicate email', async () => {
      await app.inject({
        method: 'POST',
        url: '/api/auth/signup',
        payload: { email: 'dup@test.local', password: 'password123' }
      })

      const res = await app.inject({
        method: 'POST',
        url: '/api/auth/signup',
        payload: { email: 'dup@test.local', password: 'password123' }
      })

      expect(res.statusCode).toBe(409)
    })

    it('does not require auth token', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/auth/signup',
        payload: { email: 'noauth@test.local', password: 'password123' }
      })

      expect(res.statusCode).toBe(201)
    })
  })

  // ──────────────────────────────────────────
  // LOGIN
  // ──────────────────────────────────────────

  describe('POST /api/auth/login', () => {
    beforeEach(async () => {
      await app.inject({
        method: 'POST',
        url: '/api/auth/signup',
        payload: { email: 'login@test.local', password: 'password123', name: 'Login User' }
      })
    })

    it('returns 200 with user data on correct credentials', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/auth/login',
        payload: { email: 'login@test.local', password: 'password123' }
      })

      expect(res.statusCode).toBe(200)
      const body = JSON.parse(res.payload)
      expect(body.email).toBe('login@test.local')
      expect(body.name).toBe('Login User')
      expect(body.passwordHash).toBeUndefined()
    })

    it('returns 401 for wrong password', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/auth/login',
        payload: { email: 'login@test.local', password: 'wrongpassword' }
      })

      expect(res.statusCode).toBe(401)
    })

    it('returns 401 for nonexistent email', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/auth/login',
        payload: { email: 'nobody@test.local', password: 'password123' }
      })

      expect(res.statusCode).toBe(401)
    })
  })

  // ──────────────────────────────────────────
  // EMAIL VERIFICATION
  // ──────────────────────────────────────────

  describe('Email verification flow', () => {
    it('verifies email via token from DB', async () => {
      const signupRes = await app.inject({
        method: 'POST',
        url: '/api/auth/signup',
        payload: { email: 'verify@test.local', password: 'password123' }
      })
      const userId = JSON.parse(signupRes.payload).id

      // Token is created asynchronously — poll for it
      const token = await waitForVerificationToken(userId)

      const res = await app.inject({
        method: 'GET',
        url: `/api/auth/verify-email?token=${token}`
      })

      expect(res.statusCode).toBe(200)
      const body = JSON.parse(res.payload)
      expect(body.success).toBe(true)

      // User should now be verified
      const [user] = await db
        .select()
        .from(users)
        .where(eq(users.id, userId))
        .limit(1)
      expect(user!.emailVerified).not.toBeNull()
    })
  })

  describe('POST /api/auth/resend-verification', () => {
    it('returns 200 for authenticated unverified user', async () => {
      const signupRes = await app.inject({
        method: 'POST',
        url: '/api/auth/signup',
        payload: { email: 'resend@test.local', password: 'password123' }
      })
      const userId = JSON.parse(signupRes.payload).id
      const token = await createTestToken(userId)

      const res = await app.inject({
        method: 'POST',
        url: '/api/auth/resend-verification',
        headers: { authorization: `Bearer ${token}` }
      })

      expect(res.statusCode).toBe(200)
    })

    it('returns 400 for already verified user', async () => {
      // Create user via DB and manually verify to avoid async token race
      const user = await createTestUser({ email: 'already-verified@test.local' })
      await db.update(users).set({ emailVerified: new Date() }).where(eq(users.id, user.id))

      const authToken = await createTestToken(user.id)
      const res = await app.inject({
        method: 'POST',
        url: '/api/auth/resend-verification',
        headers: { authorization: `Bearer ${authToken}` }
      })

      expect(res.statusCode).toBe(400)
    })
  })

  // ──────────────────────────────────────────
  // SESSION
  // ──────────────────────────────────────────

  describe('GET /api/auth/session', () => {
    it('returns user data with valid token', async () => {
      // Use DB-created user (no async side-effects)
      const user = await createTestUser({ name: 'Session User' })
      const token = await createTestToken(user.id)

      const res = await app.inject({
        method: 'GET',
        url: '/api/auth/session',
        headers: { authorization: `Bearer ${token}` }
      })

      expect(res.statusCode).toBe(200)
      const body = JSON.parse(res.payload)
      expect(body.user).toBeDefined()
      expect(body.user.id).toBe(user.id)
    })

    it('returns 401 without token', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/auth/session'
      })

      expect(res.statusCode).toBe(401)
    })
  })

  // ──────────────────────────────────────────
  // FORGOT / RESET PASSWORD
  // ──────────────────────────────────────────

  describe('POST /api/auth/forgot-password', () => {
    it('always returns 200 (no email leak)', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/auth/forgot-password',
        payload: { email: 'nonexistent@test.local' }
      })

      expect(res.statusCode).toBe(200)
    })

    it('inserts token in DB for existing user', async () => {
      const user = await createTestUserWithPassword('password123', { email: 'forgot@test.local' })

      const forgotRes = await app.inject({
        method: 'POST',
        url: '/api/auth/forgot-password',
        payload: { email: 'forgot@test.local' }
      })
      expect(forgotRes.statusCode).toBe(200)

      // Token created asynchronously — poll for it
      const tokenValue = await waitForResetToken(user.id)
      expect(tokenValue).toBeDefined()
    })
  })

  describe('POST /api/auth/reset-password', () => {
    it('resets password with valid token', async () => {
      const user = await createTestUserWithPassword('oldpassword123', { email: 'reset@test.local' })

      await app.inject({
        method: 'POST',
        url: '/api/auth/forgot-password',
        payload: { email: 'reset@test.local' }
      })

      const tokenValue = await waitForResetToken(user.id)

      const res = await app.inject({
        method: 'POST',
        url: '/api/auth/reset-password',
        payload: { token: tokenValue, password: 'newpassword123' }
      })

      expect(res.statusCode).toBe(200)

      // Verify new password works
      const loginRes = await app.inject({
        method: 'POST',
        url: '/api/auth/login',
        payload: { email: 'reset@test.local', password: 'newpassword123' }
      })
      expect(loginRes.statusCode).toBe(200)
    })

    it('returns 400 for invalid token', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/auth/reset-password',
        payload: { token: 'invalidtoken123', password: 'newpassword123' }
      })

      expect(res.statusCode).toBe(400)
    })

    it('returns 400 for short password', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/auth/reset-password',
        payload: { token: 'sometoken', password: 'short' }
      })

      expect(res.statusCode).toBe(400)
    })
  })

  // ──────────────────────────────────────────
  // TOTP 2FA LIFECYCLE
  // ──────────────────────────────────────────

  describe('TOTP 2FA lifecycle', () => {
    it('setup → enable → verify → disable full lifecycle', async () => {
      // Create user with password hash (TOTP requires password-based account)
      const user = await createTestUserWithPassword('password123', { email: 'totp@test.local' })
      const userId = user.id
      const authToken = await createTestToken(userId)

      // 1. Setup TOTP
      const setupRes = await app.inject({
        method: 'POST',
        url: '/api/auth/totp/setup',
        headers: { authorization: `Bearer ${authToken}` }
      })

      expect(setupRes.statusCode).toBe(200)
      const setupBody = JSON.parse(setupRes.payload)
      expect(setupBody.secret).toBeDefined()
      expect(setupBody.qrCode).toBeDefined()
      expect(setupBody.otpauthUrl).toBeDefined()

      // 2. Generate a valid TOTP code
      const { TOTP, Secret } = await import('otpauth')
      const totp = new TOTP({
        secret: Secret.fromBase32(setupBody.secret),
        algorithm: 'SHA1',
        digits: 6,
        period: 30
      })
      const code = totp.generate()

      // 3. Enable TOTP
      const enableRes = await app.inject({
        method: 'POST',
        url: '/api/auth/totp/enable',
        headers: { authorization: `Bearer ${authToken}` },
        payload: { code }
      })

      expect(enableRes.statusCode).toBe(200)
      const enableBody = JSON.parse(enableRes.payload)
      expect(enableBody.success).toBe(true)
      expect(enableBody.backupCodes).toBeDefined()
      expect(enableBody.backupCodes.length).toBe(8)

      // 4. Verify TOTP during login
      const verifyCode = totp.generate()
      const verifyRes = await app.inject({
        method: 'POST',
        url: '/api/auth/totp/verify',
        payload: { userId, code: verifyCode }
      })

      expect(verifyRes.statusCode).toBe(200)
      const verifyBody = JSON.parse(verifyRes.payload)
      expect(verifyBody.valid).toBe(true)

      // 5. Disable TOTP
      const disableCode = totp.generate()
      const disableRes = await app.inject({
        method: 'POST',
        url: '/api/auth/totp/disable',
        headers: { authorization: `Bearer ${authToken}` },
        payload: { code: disableCode }
      })

      expect(disableRes.statusCode).toBe(200)
      expect(JSON.parse(disableRes.payload).success).toBe(true)
    })
  })
})
