/**
 * NextAuth v5 TypeScript Module Augmentation
 *
 * Extends @auth/core types to include custom user properties.
 * In next-auth v5, Session/User are defined in @auth/core/types
 * and re-exported by next-auth.
 */

import 'next-auth'
import '@auth/core/types'

declare module '@auth/core/types' {
  interface Session {
    user: {
      id: string
      email: string
      name?: string | null
      image?: string | null
      membershipTier: 'free' | 'supporter'
      badges: string[]
      emailVerified: boolean
    }
    apiToken: string
  }

  interface User {
    id: string
    email: string
    name?: string | null
  }
}

declare module 'next-auth' {
  interface Session {
    user: {
      id: string
      email: string
      name?: string | null
      image?: string | null
      membershipTier: 'free' | 'supporter'
      badges: string[]
      emailVerified: boolean
    }
    apiToken: string
  }

  interface User {
    id: string
    email: string
    name?: string | null
  }
}

declare module 'next-auth/jwt' {
  interface JWT {
    id: string
    apiToken: string
    membershipTier: 'free' | 'supporter'
    badges: string[]
    emailVerified: boolean
  }
}
