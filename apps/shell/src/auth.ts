/**
 * NextAuth v5 Configuration
 *
 * Handles authentication for the Bobbinry platform.
 * For Phase 7, using credentials provider for development.
 * Production will use OAuth providers (GitHub, Google).
 */

import NextAuth from 'next-auth'
import Credentials from 'next-auth/providers/credentials'
import type { User } from 'next-auth'

// Type for our user from the API
interface BobbinryUser {
  id: string
  email: string
  name: string | null
}

export const { handlers, signIn, signOut, auth } = NextAuth({
  providers: [
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
          // In Phase 7, we'll call the API to verify credentials
          // For now, use a simple check (replace with actual API call)
          const response = await fetch(`${process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000'}/api/auth/login`, {
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
          // Auth errors are handled by NextAuth, silent fail
          return null
        }
      }
    })
  ],
  pages: {
    signIn: '/login',
    signOut: '/logout',
    error: '/login',
  },
  callbacks: {
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
