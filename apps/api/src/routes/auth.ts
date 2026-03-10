/**
 * Authentication API Routes
 *
 * Handles user authentication (login, signup, session validation)
 */

import { FastifyPluginAsync, FastifyReply, FastifyRequest } from 'fastify'
import { db } from '../db/connection'
import { users, userProfiles, userBadges, emailVerificationTokens, passwordResetTokens } from '../db/schema'
import { eq } from 'drizzle-orm'
import { randomBytes, scrypt, timingSafeEqual, createHash } from 'crypto'
import { promisify } from 'util'
import { requireAuth } from '../middleware/auth'
import { incrementCounter } from '../lib/metrics'
import { verifyInternalRequest } from '../lib/internal-auth'
import { sendWelcomeEmail, sendVerificationEmail, sendPasswordResetEmail } from '../lib/email'
import { TOTP, Secret } from 'otpauth'
import QRCode from 'qrcode'

const scryptAsync = promisify(scrypt)

/** Flip to false when beta ends to stop auto-assigning beta_tester badge */
const ASSIGN_BETA_BADGE_ON_SIGNUP = true
const LOGIN_WINDOW_MS = 15 * 60 * 1000
const MAX_LOGIN_ATTEMPTS = 8
const lockoutState = new Map<string, { failures: number; firstFailureAt: number; lockedUntil?: number }>()

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase()
}

function shouldThrottleLogin(key: string): number | null {
  const state = lockoutState.get(key)
  if (!state?.lockedUntil) return null
  if (Date.now() < state.lockedUntil) {
    return state.lockedUntil
  }
  lockoutState.delete(key)
  return null
}

function requireInternalRouteAuth(request: FastifyRequest, reply: FastifyReply): boolean {
  const verification = verifyInternalRequest(request)
  if (verification.ok) {
    return true
  }

  incrementCounter('internal_auth.denied', { reason: verification.reason })
  request.log.warn({ reason: verification.reason, path: request.url }, 'Denied internal API auth')
  const status = verification.reason === 'missing_secret' ? 503 : 403
  reply.status(status).send({ error: status === 503 ? 'Internal auth not configured' : 'Forbidden' })
  return false
}

function loginKey(request: FastifyRequest, email: string): string {
  return `${request.ip}:${email}`
}

function recordLoginFailure(key: string): void {
  const now = Date.now()
  const current = lockoutState.get(key)
  if (!current || now - current.firstFailureAt > LOGIN_WINDOW_MS) {
    lockoutState.set(key, { failures: 1, firstFailureAt: now })
    return
  }

  current.failures += 1
  if (current.failures >= MAX_LOGIN_ATTEMPTS) {
    const backoffMs = Math.min(60 * 60 * 1000, 30_000 * 2 ** (current.failures - MAX_LOGIN_ATTEMPTS))
    current.lockedUntil = now + backoffMs
  }
  lockoutState.set(key, current)
}

function clearLoginFailures(key: string): void {
  lockoutState.delete(key)
}

async function createSecureToken(
  table: typeof emailVerificationTokens | typeof passwordResetTokens,
  userId: string,
  ttlMs: number
): Promise<string> {
  await db.delete(table).where(eq(table.userId, userId))

  const token = randomBytes(32).toString('hex')
  const expiresAt = new Date(Date.now() + ttlMs)

  await db.insert(table).values({ userId, token, expiresAt })
  return token
}

function createVerificationToken(userId: string): Promise<string> {
  return createSecureToken(emailVerificationTokens, userId, 24 * 60 * 60 * 1000) // 24 hours
}

function createPasswordResetToken(userId: string): Promise<string> {
  return createSecureToken(passwordResetTokens, userId, 60 * 60 * 1000) // 1 hour
}

async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16).toString('hex')
  const hashBuffer = await scryptAsync(password, salt, 64) as Buffer
  return `${salt}:${hashBuffer.toString('hex')}`
}

function generateBackupCodes(): string[] {
  const codes: string[] = []
  for (let i = 0; i < 8; i++) {
    codes.push(randomBytes(4).toString('hex')) // 8-char hex codes
  }
  return codes
}

function hashBackupCode(code: string): string {
  return createHash('sha256').update(code.toLowerCase().replace(/\s/g, '')).digest('hex')
}

function buildTOTP(email: string, secret: Secret): TOTP {
  return new TOTP({ issuer: 'Bobbinry', label: email, algorithm: 'SHA1', digits: 6, period: 30, secret })
}

/** Fetch TOTP-related fields for authenticated user (only call from auth routes that need it) */
async function getUserTotpData(userId: string) {
  const [row] = await db
    .select({
      passwordHash: users.passwordHash,
      totpSecret: users.totpSecret,
      totpEnabled: users.totpEnabled,
      totpBackupCodes: users.totpBackupCodes,
    })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1)
  return row ?? null
}

const authPlugin: FastifyPluginAsync = async (fastify) => {
  /**
   * Login endpoint
   * POST /auth/login
   */
  fastify.post<{
    Body: {
      email: string
      password: string
    }
  }>('/auth/login', {
    config: {
      rateLimit: {
        max: 20,
        timeWindow: '1 minute'
      }
    }
  }, async (request, reply) => {
    try {
      const { email, password } = request.body

      if (!email || !password) {
        return reply.status(400).send({ error: 'Email and password are required' })
      }

      const normalizedEmail = normalizeEmail(email)
      const authKey = loginKey(request, normalizedEmail)
      const lockedUntil = shouldThrottleLogin(authKey)
      if (lockedUntil) {
        incrementCounter('auth.login.blocked')
        return reply.status(429).send({
          error: 'Too many login attempts',
          retryAt: new Date(lockedUntil).toISOString()
        })
      }

      // Find user by email
      const [user] = await db
        .select()
        .from(users)
        .where(eq(users.email, normalizedEmail))
        .limit(1)

      if (!user || !user.passwordHash) {
        // For security, don't reveal whether user exists
        incrementCounter('auth.login.failed', { reason: 'invalid_credentials' })
        recordLoginFailure(authKey)
        return reply.status(401).send({ error: 'Invalid credentials' })
      }

      // Verify password hash
      const hashParts = user.passwordHash.split(':')
      if (hashParts.length !== 2 || !hashParts[0] || !hashParts[1]) {
        return reply.status(500).send({ error: 'Invalid password hash format' })
      }
      const [salt, storedHash] = hashParts
      const hashBuffer = await scryptAsync(password, salt, 64) as Buffer
      const hash = hashBuffer.toString('hex')
      const storedHashBuffer = Buffer.from(storedHash, 'hex')
      const computedHashBuffer = Buffer.from(hash, 'hex')

      if (storedHashBuffer.length !== computedHashBuffer.length) {
        incrementCounter('auth.login.failed', { reason: 'invalid_credentials' })
        recordLoginFailure(authKey)
        return reply.status(401).send({ error: 'Invalid credentials' })
      }

      const isValid = timingSafeEqual(
        storedHashBuffer,
        computedHashBuffer
      )

      if (!isValid) {
        incrementCounter('auth.login.failed', { reason: 'invalid_credentials' })
        recordLoginFailure(authKey)
        return reply.status(401).send({ error: 'Invalid credentials' })
      }

      clearLoginFailures(authKey)

      // Check if 2FA is enabled
      if (user.totpEnabled) {
        incrementCounter('auth.login.2fa_required')
        return reply.send({
          requiresTwoFactor: true,
          userId: user.id,
        })
      }

      incrementCounter('auth.login.success')
      return reply.send({
        id: user.id,
        email: user.email,
        name: user.name,
        emailVerified: user.emailVerified
      })
    } catch (error) {
      fastify.log.error({ error }, 'Login failed')
      return reply.status(500).send({ error: 'Login failed' })
    }
  })

  /**
   * Signup endpoint
   * POST /auth/signup
   */
  fastify.post<{
    Body: {
      email: string
      password: string
      name?: string
    }
  }>('/auth/signup', {
    config: {
      rateLimit: {
        max: 10,
        timeWindow: '1 minute'
      }
    }
  }, async (request, reply) => {
    try {
      const { email, password, name } = request.body

      if (!email || !password) {
        return reply.status(400).send({ error: 'Email and password are required' })
      }

      const normalizedEmail = normalizeEmail(email)

      // Check if user already exists
      const [existing] = await db
        .select()
        .from(users)
        .where(eq(users.email, normalizedEmail))
        .limit(1)

      if (existing) {
        incrementCounter('auth.signup.failed', { reason: 'duplicate_email' })
        return reply.status(409).send({ error: 'User already exists' })
      }

      // Hash password
      const passwordHash = await hashPassword(password)

      // Create user
      const [newUser] = await db
        .insert(users)
        .values({
          email: normalizedEmail,
          name: name || null,
          passwordHash
        })
        .returning()

      if (!newUser) {
        return reply.status(500).send({ error: 'Failed to create user' })
      }

      // Auto-create a user profile
      await db.insert(userProfiles).values({
        userId: newUser.id,
        displayName: newUser.name || null,
      }).onConflictDoNothing()

      // Auto-assign beta_tester badge
      if (ASSIGN_BETA_BADGE_ON_SIGNUP) {
        await db.insert(userBadges).values({
          userId: newUser.id,
          badge: 'beta_tester',
        }).onConflictDoNothing()
      }

      // Send verification email instead of welcome (welcome sent after verification)
      ;(async () => {
        const token = await createVerificationToken(newUser.id)
        await sendVerificationEmail(newUser.email, token, newUser.name || undefined)
      })().catch(err => {
        fastify.log.warn({ err, userId: newUser.id }, 'Failed to send verification email')
      })

      incrementCounter('auth.signup.success')
      return reply.status(201).send({
        id: newUser.id,
        email: newUser.email,
        name: newUser.name,
        emailVerified: null
      })
    } catch (error) {
      fastify.log.error({ error }, 'Signup failed')
      return reply.status(500).send({ error: 'Signup failed' })
    }
  })

  /**
   * OAuth user provisioning
   * POST /auth/oauth-provision
   *
   * Called by NextAuth during OAuth sign-in to find or create a user
   * without a password. This is a server-to-server call, not user-facing.
   */
  fastify.post<{
    Body: {
      email: string
      name?: string
    }
  }>('/auth/oauth-provision', {
    config: {
      rateLimit: {
        max: 30,
        timeWindow: '1 minute'
      }
    }
  }, async (request, reply) => {
    try {
      if (!requireInternalRouteAuth(request, reply)) return

      const { email, name } = request.body

      if (!email) {
        return reply.status(400).send({ error: 'Email is required' })
      }

      const normalizedEmail = normalizeEmail(email)

      // Check if user already exists
      const [existing] = await db
        .select()
        .from(users)
        .where(eq(users.email, normalizedEmail))
        .limit(1)

      if (existing) {
        // If existing user hasn't been verified yet (e.g. signed up with password, now using OAuth),
        // mark them as verified since OAuth provider verified the email
        if (!existing.emailVerified) {
          await db.update(users).set({ emailVerified: new Date() }).where(eq(users.id, existing.id))
        }
        return reply.send({
          id: existing.id,
          email: existing.email,
          name: existing.name,
          emailVerified: existing.emailVerified || new Date()
        })
      }

      // Create new user without password — OAuth users are auto-verified
      const [newUser] = await db
        .insert(users)
        .values({
          email: normalizedEmail,
          name: name || null,
          passwordHash: null,
          emailVerified: new Date()
        })
        .returning()

      if (!newUser) {
        return reply.status(500).send({ error: 'Failed to create user' })
      }

      // Auto-create a user profile
      await db.insert(userProfiles).values({
        userId: newUser.id,
        displayName: newUser.name || null,
      }).onConflictDoNothing()

      // Auto-assign beta_tester badge
      if (ASSIGN_BETA_BADGE_ON_SIGNUP) {
        await db.insert(userBadges).values({
          userId: newUser.id,
          badge: 'beta_tester',
        }).onConflictDoNothing()
      }

      // Send welcome email (fire-and-forget)
      sendWelcomeEmail(newUser.email, newUser.name || undefined).catch(err => {
        fastify.log.warn({ err, userId: newUser.id }, 'Failed to send welcome email')
      })

      return reply.status(201).send({
        id: newUser.id,
        email: newUser.email,
        name: newUser.name,
        emailVerified: newUser.emailVerified
      })
    } catch (error) {
      fastify.log.error({ error }, 'OAuth provisioning failed')
      return reply.status(500).send({ error: 'OAuth provisioning failed' })
    }
  })

  /**
   * Look up user by email
   * GET /users/by-email?email=...
   *
   * Used by NextAuth to check if an OAuth user already exists.
   */
  fastify.get<{
    Querystring: { email: string }
  }>('/users/by-email', {
    config: {
      rateLimit: {
        max: 60,
        timeWindow: '1 minute'
      }
    }
  }, async (request, reply) => {
    try {
      if (!requireInternalRouteAuth(request, reply)) return

      const { email } = request.query

      if (!email) {
        return reply.status(400).send({ error: 'Email query parameter is required' })
      }

      const normalizedEmail = normalizeEmail(email)

      const [user] = await db
        .select()
        .from(users)
        .where(eq(users.email, normalizedEmail))
        .limit(1)

      if (!user) {
        return reply.status(404).send({ error: 'User not found' })
      }

      return reply.send({
        id: user.id,
        email: user.email,
        name: user.name
      })
    } catch (error) {
      fastify.log.error({ error }, 'User lookup failed')
      return reply.status(500).send({ error: 'User lookup failed' })
    }
  })

  /**
   * Verify email address
   * GET /auth/verify-email?token=...
   *
   * Validates the token, marks user as verified, sends welcome email.
   */
  fastify.get<{
    Querystring: { token: string }
  }>('/auth/verify-email', {
    config: {
      rateLimit: {
        max: 20,
        timeWindow: '1 minute'
      }
    }
  }, async (request, reply) => {
    try {
      const { token } = request.query

      if (!token) {
        return reply.status(400).send({ error: 'Token is required' })
      }

      // Find the token
      const [record] = await db
        .select()
        .from(emailVerificationTokens)
        .where(eq(emailVerificationTokens.token, token))
        .limit(1)

      if (!record) {
        return reply.status(400).send({ error: 'Invalid or expired verification link' })
      }

      if (record.expiresAt < new Date()) {
        // Clean up expired token
        await db.delete(emailVerificationTokens).where(eq(emailVerificationTokens.id, record.id))
        return reply.status(400).send({ error: 'Verification link has expired. Please request a new one.' })
      }

      // Mark user as verified + delete tokens in parallel; RETURNING gives us user info for welcome email
      const [[user]] = await Promise.all([
        db.update(users).set({ emailVerified: new Date() }).where(eq(users.id, record.userId)).returning({ id: users.id, email: users.email, name: users.name }),
        db.delete(emailVerificationTokens).where(eq(emailVerificationTokens.userId, record.userId)),
      ])

      // Send welcome email now that they're verified
      if (user) {
        sendWelcomeEmail(user.email, user.name || undefined).catch(err => {
          fastify.log.warn({ err, userId: record.userId }, 'Failed to send welcome email after verification')
        })
      }

      incrementCounter('auth.email_verified')
      return reply.send({ success: true, message: 'Email verified successfully', userId: record.userId })
    } catch (error) {
      fastify.log.error({ error }, 'Email verification failed')
      return reply.status(500).send({ error: 'Verification failed' })
    }
  })

  /**
   * Resend verification email
   * POST /auth/resend-verification
   *
   * Requires authentication. Generates a new token and sends a verification email.
   */
  fastify.post('/auth/resend-verification', {
    preHandler: requireAuth,
    config: {
      rateLimit: {
        max: 3,
        timeWindow: '1 minute'
      }
    }
  }, async (request, reply) => {
    try {
      const user = request.user!

      if (user.emailVerified) {
        return reply.status(400).send({ error: 'Email is already verified' })
      }

      const token = await createVerificationToken(user.id)

      sendVerificationEmail(user.email, token, user.name || undefined).catch(err => {
        fastify.log.warn({ err, userId: user.id }, 'Failed to send verification email')
      })

      return reply.send({ success: true, message: 'Verification email sent' })
    } catch (error) {
      fastify.log.error({ error }, 'Resend verification failed')
      return reply.status(500).send({ error: 'Failed to resend verification email' })
    }
  })

  /**
   * Forgot password — request a password reset email
   * POST /auth/forgot-password
   */
  fastify.post<{
    Body: { email: string }
  }>('/auth/forgot-password', {
    config: {
      rateLimit: {
        max: 5,
        timeWindow: '1 minute'
      }
    }
  }, async (request, reply) => {
    try {
      const { email } = request.body

      if (!email) {
        return reply.status(400).send({ error: 'Email is required' })
      }

      const normalizedEmail = normalizeEmail(email)

      // Look up user — must have a passwordHash (skip OAuth-only)
      const [user] = await db
        .select()
        .from(users)
        .where(eq(users.email, normalizedEmail))
        .limit(1)

      if (user?.passwordHash) {
        const token = await createPasswordResetToken(user.id)
        sendPasswordResetEmail(user.email, token, user.name || undefined).catch(err => {
          fastify.log.warn({ err, userId: user.id }, 'Failed to send password reset email')
        })
      }

      // Always return success — don't leak email existence
      incrementCounter('auth.forgot_password')
      return reply.send({ success: true, message: 'If an account exists with that email, a reset link has been sent.' })
    } catch (error) {
      fastify.log.error({ error }, 'Forgot password failed')
      return reply.status(500).send({ error: 'Failed to process request' })
    }
  })

  /**
   * Reset password — set a new password using a reset token
   * POST /auth/reset-password
   */
  fastify.post<{
    Body: { token: string; password: string }
  }>('/auth/reset-password', {
    config: {
      rateLimit: {
        max: 10,
        timeWindow: '1 minute'
      }
    }
  }, async (request, reply) => {
    try {
      const { token, password } = request.body

      if (!token || !password) {
        return reply.status(400).send({ error: 'Token and password are required' })
      }

      if (password.length < 8) {
        return reply.status(400).send({ error: 'Password must be at least 8 characters' })
      }

      // Find the token
      const [record] = await db
        .select()
        .from(passwordResetTokens)
        .where(eq(passwordResetTokens.token, token))
        .limit(1)

      if (!record) {
        return reply.status(400).send({ error: 'Invalid or expired reset link' })
      }

      if (record.expiresAt < new Date()) {
        await db.delete(passwordResetTokens).where(eq(passwordResetTokens.id, record.id))
        return reply.status(400).send({ error: 'Reset link has expired. Please request a new one.' })
      }

      // Hash new password and update user
      const passwordHash = await hashPassword(password)

      await Promise.all([
        db.update(users).set({ passwordHash }).where(eq(users.id, record.userId)),
        db.delete(passwordResetTokens).where(eq(passwordResetTokens.userId, record.userId)),
      ])

      incrementCounter('auth.password_reset')
      return reply.send({ success: true, message: 'Password has been reset successfully.' })
    } catch (error) {
      fastify.log.error({ error }, 'Password reset failed')
      return reply.status(500).send({ error: 'Failed to reset password' })
    }
  })

  /**
   * TOTP setup — generate a secret and QR code
   * POST /auth/totp/setup
   */
  fastify.post('/auth/totp/setup', {
    preHandler: requireAuth,
  }, async (request, reply) => {
    try {
      const user = request.user!
      const totpData = await getUserTotpData(user.id)

      if (!totpData?.passwordHash) {
        return reply.status(400).send({ error: 'Two-factor authentication is only available for password-based accounts' })
      }

      if (totpData.totpEnabled) {
        return reply.status(400).send({ error: 'Two-factor authentication is already enabled' })
      }

      // Generate a new TOTP secret
      const secret = new Secret({ size: 20 })
      const totp = buildTOTP(user.email, secret)
      const otpauthUrl = totp.toString()

      // Store secret on user (not yet enabled)
      await db.update(users).set({ totpSecret: secret.base32 }).where(eq(users.id, user.id))

      // Generate QR code data URI
      const qrCodeDataUri = await QRCode.toDataURL(otpauthUrl)

      return reply.send({
        secret: secret.base32,
        qrCode: qrCodeDataUri,
        otpauthUrl,
      })
    } catch (error) {
      fastify.log.error({ error }, 'TOTP setup failed')
      return reply.status(500).send({ error: 'Failed to set up two-factor authentication' })
    }
  })

  /**
   * TOTP enable — verify code and activate 2FA
   * POST /auth/totp/enable
   */
  fastify.post<{
    Body: { code: string }
  }>('/auth/totp/enable', {
    preHandler: requireAuth,
  }, async (request, reply) => {
    try {
      const user = request.user!
      const { code } = request.body

      if (!code) {
        return reply.status(400).send({ error: 'Verification code is required' })
      }

      const totpData = await getUserTotpData(user.id)

      if (!totpData?.totpSecret) {
        return reply.status(400).send({ error: 'Please set up two-factor authentication first' })
      }

      if (totpData.totpEnabled) {
        return reply.status(400).send({ error: 'Two-factor authentication is already enabled' })
      }

      // Verify the code
      const delta = buildTOTP(user.email, Secret.fromBase32(totpData.totpSecret)).validate({ token: code, window: 1 })
      if (delta === null) {
        return reply.status(400).send({ error: 'Invalid verification code' })
      }

      // Generate backup codes
      const backupCodes = generateBackupCodes()
      const hashedCodes = backupCodes.map(hashBackupCode)

      await db.update(users).set({
        totpEnabled: true,
        totpBackupCodes: JSON.stringify(hashedCodes),
      }).where(eq(users.id, user.id))

      incrementCounter('auth.totp.enabled')
      return reply.send({
        success: true,
        backupCodes, // Return plain-text codes for user to save
      })
    } catch (error) {
      fastify.log.error({ error }, 'TOTP enable failed')
      return reply.status(500).send({ error: 'Failed to enable two-factor authentication' })
    }
  })

  /**
   * TOTP disable — verify code and deactivate 2FA
   * POST /auth/totp/disable
   */
  fastify.post<{
    Body: { code: string }
  }>('/auth/totp/disable', {
    preHandler: requireAuth,
  }, async (request, reply) => {
    try {
      const user = request.user!
      const { code } = request.body

      if (!code) {
        return reply.status(400).send({ error: 'Verification code is required' })
      }

      const totpData = await getUserTotpData(user.id)

      if (!totpData?.totpEnabled || !totpData.totpSecret) {
        return reply.status(400).send({ error: 'Two-factor authentication is not enabled' })
      }

      // Verify the code
      const delta = buildTOTP(user.email, Secret.fromBase32(totpData.totpSecret)).validate({ token: code, window: 1 })
      if (delta === null) {
        return reply.status(400).send({ error: 'Invalid verification code' })
      }

      await db.update(users).set({
        totpSecret: null,
        totpEnabled: false,
        totpBackupCodes: null,
      }).where(eq(users.id, user.id))

      incrementCounter('auth.totp.disabled')
      return reply.send({ success: true, message: 'Two-factor authentication has been disabled.' })
    } catch (error) {
      fastify.log.error({ error }, 'TOTP disable failed')
      return reply.status(500).send({ error: 'Failed to disable two-factor authentication' })
    }
  })

  /**
   * TOTP verify — verify code during login
   * POST /auth/totp/verify
   */
  fastify.post<{
    Body: { userId: string; code: string }
  }>('/auth/totp/verify', {
    config: {
      rateLimit: {
        max: 10,
        timeWindow: '1 minute'
      }
    }
  }, async (request, reply) => {
    try {
      const { userId, code } = request.body

      if (!userId || !code) {
        return reply.status(400).send({ error: 'User ID and code are required' })
      }

      const [user] = await db
        .select({
          id: users.id,
          email: users.email,
          name: users.name,
          emailVerified: users.emailVerified,
          totpSecret: users.totpSecret,
          totpEnabled: users.totpEnabled,
          totpBackupCodes: users.totpBackupCodes,
        })
        .from(users)
        .where(eq(users.id, userId))
        .limit(1)

      if (!user || !user.totpEnabled || !user.totpSecret) {
        return reply.status(400).send({ error: 'Invalid request' })
      }

      const userResponse = { id: user.id, email: user.email, name: user.name, emailVerified: user.emailVerified }

      // Try TOTP code first
      const delta = buildTOTP(user.email, Secret.fromBase32(user.totpSecret)).validate({ token: code, window: 1 })
      if (delta !== null) {
        incrementCounter('auth.totp.verified')
        return reply.send({ valid: true, user: userResponse })
      }

      // Try backup code
      if (user.totpBackupCodes) {
        const hashedCodes: string[] = JSON.parse(user.totpBackupCodes)
        const inputHash = hashBackupCode(code)
        const codeIndex = hashedCodes.indexOf(inputHash)

        if (codeIndex !== -1) {
          // Remove used backup code
          hashedCodes.splice(codeIndex, 1)
          await db.update(users).set({
            totpBackupCodes: JSON.stringify(hashedCodes),
          }).where(eq(users.id, user.id))

          incrementCounter('auth.totp.backup_used')
          return reply.send({ valid: true, user: userResponse })
        }
      }

      incrementCounter('auth.totp.failed')
      return reply.status(401).send({ error: 'Invalid code' })
    } catch (error) {
      fastify.log.error({ error }, 'TOTP verification failed')
      return reply.status(500).send({ error: 'Verification failed' })
    }
  })

  /**
   * Get current user session
   * GET /auth/session
   *
   * Requires valid JWT token in Authorization header.
   * Returns the authenticated user's information.
   */
  fastify.get('/auth/session', {
    preHandler: requireAuth
  }, async (request, reply) => {
    try {
      const user = request.user!

      return reply.send({
        user: {
          id: user.id,
          email: user.email,
          name: user.name,
          emailVerified: user.emailVerified
        }
      })
    } catch (error) {
      fastify.log.error({ error }, 'Session check failed')
      return reply.status(500).send({ error: 'Session check failed' })
    }
  })
}

export default authPlugin
