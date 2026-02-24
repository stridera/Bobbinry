/**
 * NextAuth v5 Configuration
 *
 * Handles authentication for the Bobbinry platform.
 * Supports credentials (email/password) and OAuth (Google, GitHub).
 * OAuth users are auto-provisioned in the API database on first login.
 */

import NextAuth from 'next-auth'
import Credentials from 'next-auth/providers/credentials'
import Google from 'next-auth/providers/google'
import GitHub from 'next-auth/providers/github'
import type { User } from 'next-auth'
import { config } from '@/lib/config'

// Type for our user from the API
interface BobbinryUser {
  id: string
  email: string
  name: string | null
}

/**
 * Find or create a user in the API database for OAuth logins.
 * Returns the API user record so we can store the API-side ID in the JWT.
 */
async function findOrCreateOAuthUser(email: string, name: string | null): Promise<BobbinryUser | null> {
  try {
    // Try to log in first (user may already exist from a previous OAuth or credentials signup)
    const lookupRes = await fetch(`${config.apiUrl}/api/users/by-email?email=${encodeURIComponent(email)}`)
    if (lookupRes.ok) {
      return await lookupRes.json()
    }

    // User doesn't exist — create without a password
    const createRes = await fetch(`${config.apiUrl}/api/auth/oauth-provision`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, name })
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

        const user: BobbinryUser = await response.json()

        return {
          id: user.id,
          email: user.email,
          name: user.name || user.email
        }
      } catch (error) {
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

if (process.env.GITHUB_ID && process.env.GITHUB_SECRET) {
  providers.push(
    GitHub({
      clientId: process.env.GITHUB_ID,
      clientSecret: process.env.GITHUB_SECRET,
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
        user.id = apiUser.id
      }
      return true
    },
    async jwt({ token, user }) {
      if (user) {
        token.id = user.id
      }
      return token
    },
    async session({ session, token }) {
      if (session.user) {
        session.user.id = token.id as string
      }
      return session
    }
  },
  session: {
    strategy: 'jwt'
  },
  secret: (() => {
    const secret = process.env.NEXTAUTH_SECRET
    if (!secret && process.env.NODE_ENV === 'production') {
      throw new Error('NEXTAUTH_SECRET must be set in production')
    }
    return secret || 'development-secret-only-for-local-dev'
  })()
})
