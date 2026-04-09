/**
 * NextAuth v5 Configuration
 *
 * Handles authentication for the Bobbinry platform.
 * Supports credentials (email/password) and OAuth (Google).
 * OAuth users are auto-provisioned in the API database on first login.
 */

// Side-effect import: runs the shell env validator at module load so missing
// required vars fail fast with a clear error instead of crashing on first use.
import '@/lib/env'

import NextAuth from 'next-auth'
import Credentials from 'next-auth/providers/credentials'
import Google from 'next-auth/providers/google'
import { SignJWT } from 'jose'
import type { User } from 'next-auth'
import { config } from '@/lib/config'
import { PHASE_PRODUCTION_BUILD } from 'next/constants'

/** Shared secret used by both NextAuth and the API for JWT verification */
const jwtSecret = new TextEncoder().encode(
  process.env.NEXTAUTH_SECRET || 'development-secret-only-for-local-dev'
)

/** Sign a JWT that the API can verify via its requireAuth middleware */
async function signApiToken(userId: string): Promise<string> {
  return new SignJWT({ id: userId })
    .setProtectedHeader({ alg: 'HS256' })
    .setExpirationTime('7d')
    .sign(jwtSecret)
}

function toHex(buffer: ArrayBuffer): string {
  return Array.from(new Uint8Array(buffer)).map(b => b.toString(16).padStart(2, '0')).join('')
}

async function sha256Hex(data: string): Promise<string> {
  const encoded = new TextEncoder().encode(data)
  const hash = await crypto.subtle.digest('SHA-256', encoded)
  return toHex(hash)
}

async function hmacSha256Hex(key: string, data: string): Promise<string> {
  const enc = new TextEncoder()
  const cryptoKey = await crypto.subtle.importKey('raw', enc.encode(key), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  const sig = await crypto.subtle.sign('HMAC', cryptoKey, enc.encode(data))
  return toHex(sig)
}

async function buildInternalSignedHeaders(method: string, urlString: string, body?: unknown): Promise<Record<string, string>> {
  const signingSecret = process.env.INTERNAL_API_AUTH_TOKEN
  if (!signingSecret) {
    return {}
  }

  const url = new URL(urlString)
  const path = `${url.pathname}${url.search}`
  const timestamp = Date.now().toString()
  const bodySerialized = body ? JSON.stringify(body) : ''
  const bodyDigest = await sha256Hex(bodySerialized)
  const payload = `${method.toUpperCase()}\n${path}\n${timestamp}\n${bodyDigest}`
  const signature = await hmacSha256Hex(signingSecret, payload)

  return {
    'x-internal-auth-ts': timestamp,
    'x-internal-auth-signature': signature
  }
}

// Type for our user from the API
interface BobbinryUser {
  id: string
  email: string
  name: string | null
  emailVerified?: string | null
}

/**
 * Find or create a user in the API database for OAuth logins.
 * Returns the API user record so we can store the API-side ID in the JWT.
 */
async function findOrCreateOAuthUser(email: string, name: string | null): Promise<BobbinryUser | null> {
  try {
    const lookupUrl = `${config.apiUrl}/api/users/by-email?email=${encodeURIComponent(email)}`
    const lookupHeaders = await buildInternalSignedHeaders('GET', lookupUrl)
    // Try to log in first (user may already exist from a previous OAuth or credentials signup)
    const lookupRes = await fetch(lookupUrl, {
      headers: lookupHeaders
    })
    if (lookupRes.ok) {
      return await lookupRes.json()
    }

    // User doesn't exist — create without a password
    const createBody = { email, name }
    const createUrl = `${config.apiUrl}/api/auth/oauth-provision`
    const signedHeaders = await buildInternalSignedHeaders('POST', createUrl, createBody)
    const createRes = await fetch(`${config.apiUrl}/api/auth/oauth-provision`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...signedHeaders },
      body: JSON.stringify(createBody)
    })

    if (createRes.ok) {
      return await createRes.json()
    }

    console.error('[auth] Failed to provision OAuth user:', createRes.status)
    return null
  } catch (error) {
    console.error('[auth] OAuth user provisioning error:', error)
    return null
  }
}

// Build providers list dynamically based on configured env vars
const providers: any[] = [
  Credentials({
    name: 'Credentials',
    credentials: {
      email: { label: 'Email', type: 'email' },
      password: { label: 'Password', type: 'password' }
    },
    async authorize(credentials): Promise<User | null> {
      if (!credentials?.email || !credentials?.password) {
        return null
      }

      try {
        // If totpCode + userId are present, this is step 2 of 2FA login
        const creds = credentials as any
        if (creds.totpCode && creds.userId) {
          const verifyRes = await fetch(`${config.apiUrl}/api/auth/totp/verify`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              userId: creds.userId,
              code: creds.totpCode,
            })
          })

          if (!verifyRes.ok) {
            throw new Error('INVALID_TOTP')
          }

          const { user } = await verifyRes.json()
          return {
            id: user.id,
            email: user.email,
            name: user.name || user.email,
            emailVerified: user.emailVerified ? new Date(user.emailVerified) : null,
          } as any
        }

        const response = await fetch(`${config.apiUrl}/api/auth/login`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            email: credentials.email,
            password: credentials.password
          })
        })

        if (!response.ok) {
          return null
        }

        const data = await response.json()

        // If 2FA is required, throw a special error the login page will catch
        if (data.requiresTwoFactor) {
          throw new Error(`REQUIRES_2FA:${data.userId}`)
        }

        const user: BobbinryUser = data

        return {
          id: user.id,
          email: user.email,
          name: user.name || user.email,
          emailVerified: user.emailVerified ? new Date(user.emailVerified) : null,
        } as any
      } catch (err) {
        // Re-throw our special errors so they propagate to the login page
        if (err instanceof Error && (err.message.startsWith('REQUIRES_2FA:') || err.message === 'INVALID_TOTP')) {
          throw err
        }
        return null
      }
    }
  })
]

if (process.env.GOOGLE_ID && process.env.GOOGLE_SECRET) {
  providers.push(
    Google({
      clientId: process.env.GOOGLE_ID,
      clientSecret: process.env.GOOGLE_SECRET,
    })
  )
}


export const { handlers, signIn, signOut, auth } = NextAuth({
  trustHost: true,
  providers,
  pages: {
    signIn: '/login',
    signOut: '/logout',
    error: '/login',
  },
  debug: process.env.NODE_ENV === 'development',
  callbacks: {
    async signIn({ user, account }) {
      // For OAuth logins, find or create the user in the API database
      if (account?.provider !== 'credentials' && user.email) {
        const apiUser = await findOrCreateOAuthUser(user.email, user.name ?? null)
        if (!apiUser) {
          return false // Deny sign-in if we can't provision
        }
        // Store the API-side user ID so the jwt callback can pick it up
        user.id = apiUser.id;
        (user as any).emailVerified = apiUser.emailVerified || new Date()
      }
      return true
    },
    async jwt({ token, user, trigger, session: updateData }) {
      if (user) {
        token.id = user.id
        token.apiToken = await signApiToken(user.id)
        token.emailVerified = !!(user as any).emailVerified
        // Use profile displayName as the canonical display name
        try {
          const profileRes = await fetch(`${config.apiUrl}/api/users/${user.id}/profile`)
          if (profileRes.ok) {
            const { profile } = await profileRes.json()
            if (profile?.displayName) {
              token.name = profile.displayName
            }
          }
        } catch {}
      }
      // Handle session updates (e.g. after profile displayName change)
      if (trigger === 'update' && updateData?.name) {
        token.name = updateData.name
      }
      // Handle email verification refresh via explicit update trigger
      if (trigger === 'update' && updateData?.emailVerified !== undefined) {
        token.emailVerified = !!updateData.emailVerified
      }
      // Handle membership refresh via explicit update trigger
      if (trigger === 'update' && updateData?.membershipTier !== undefined) {
        token.membershipTier = updateData.membershipTier
        token.badges = updateData.badges ?? token.badges
        token.membershipFetchedAt = Date.now()
      }
      // Refresh membership periodically (every 5 minutes) or on first load
      const MEMBERSHIP_TTL = 5 * 60 * 1000
      const lastFetched = (token.membershipFetchedAt as number) || 0
      const now = Date.now()
      if (token.apiToken && (now - lastFetched > MEMBERSHIP_TTL)) {
        try {
          const membershipRes = await fetch(`${config.apiUrl}/api/membership`, {
            headers: { Authorization: `Bearer ${token.apiToken}` },
          })
          if (membershipRes.ok) {
            const data = await membershipRes.json()
            token.membershipTier = data.tier || 'free'
            token.badges = data.badges || []
            if (data.emailVerified !== undefined) {
              token.emailVerified = data.emailVerified
            }
            if (data.hasPassword !== undefined) {
              token.hasPassword = data.hasPassword
            }
          }
        } catch {}
        // Round to nearest TTL window to avoid constant token churn
        token.membershipFetchedAt = Math.floor(now / MEMBERSHIP_TTL) * MEMBERSHIP_TTL
      }
      // Default values if never fetched
      if (!token.membershipTier) token.membershipTier = 'free'
      if (!token.badges) token.badges = []
      if (token.emailVerified === undefined) token.emailVerified = false
      if (token.hasPassword === undefined) token.hasPassword = false
      return token
    },
    async session({ session, token }) {
      if (session.user) {
        session.user.id = token.id as string
        session.user.membershipTier = (token.membershipTier as 'free' | 'supporter') || 'free'
        session.user.badges = (token.badges as string[]) || []
        ;(session.user as any).emailVerified = !!token.emailVerified
        session.user.hasPassword = !!token.hasPassword
      }
      session.apiToken = token.apiToken as string
      return session
    }
  },
  session: {
    strategy: 'jwt'
  },
  secret: (() => {
    const secret = process.env.NEXTAUTH_SECRET
    const isBuildPhase = process.env.NEXT_PHASE === PHASE_PRODUCTION_BUILD
    if (!secret && process.env.NODE_ENV === 'production' && !isBuildPhase) {
      throw new Error('NEXTAUTH_SECRET must be set in production')
    }
    return secret || 'development-secret-only-for-local-dev'
  })()
})
