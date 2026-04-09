/**
 * Environment variable validation for the Next.js shell.
 *
 * Validates required vars at boot. To make sure this runs early during a
 * server start (and not lazily on first import), `apps/shell/src/auth.ts`
 * imports this module for side effects.
 *
 * Note: the shell does NOT have a database connection — DATABASE_URL is
 * intentionally absent here even though it's in the project's `.env`.
 */

import { PHASE_PRODUCTION_BUILD } from 'next/constants'

interface EnvConfig {
  NODE_ENV: string
  NEXTAUTH_SECRET: string | undefined
  NEXTAUTH_URL: string
  NEXT_PUBLIC_API_URL: string
  NEXT_PUBLIC_APP_URL: string
  NEXT_PUBLIC_BUILD_ID: string
  GOOGLE_ID: string | undefined
  GOOGLE_SECRET: string | undefined
  INTERNAL_API_AUTH_TOKEN: string | undefined
}

const requiredEnvVars = {
  // NOTE: keep this list narrow. A missing var here HARD-CRASHES the shell at
  // boot via the side-effect import in `auth.ts`. Vars with sensible
  // fallbacks (NEXT_PUBLIC_APP_URL falls back to NEXTAUTH_URL) belong in the
  // recommended list, not here. See the post-mortem in
  // `infra/db/migrations/README.md` for what happened when this was wider.
  production: ['NEXTAUTH_SECRET'],
  development: [] as string[],
  test: [] as string[]
} as const

// Vars that are nice-to-have but should not crash the shell if missing.
const recommendedEnvVars: Record<string, string[]> = {
  production: ['NEXT_PUBLIC_APP_URL', 'INTERNAL_API_AUTH_TOKEN'],
}

export function validateEnv(): EnvConfig {
  const nodeEnv = process.env.NODE_ENV || 'development'

  // `next build` runs the app under NODE_ENV=production but without runtime
  // secrets — required-var checks would block builds. Skip them in that phase.
  const isBuildPhase = process.env.NEXT_PHASE === PHASE_PRODUCTION_BUILD
  const required = isBuildPhase
    ? []
    : requiredEnvVars[nodeEnv as keyof typeof requiredEnvVars] || []

  const missing: string[] = []
  for (const varName of required) {
    if (!process.env[varName]) {
      missing.push(varName)
    }
  }

  if (missing.length > 0) {
    throw new Error(
      `Missing required environment variables: ${missing.join(', ')}\n` +
      `Please check your .env file or environment configuration.`
    )
  }

  // Warn (but do NOT throw) for recommended vars. Skip during the build phase
  // since secrets aren't available there anyway.
  if (!isBuildPhase) {
    const recommended = recommendedEnvVars[nodeEnv] || []
    const missingRecommended = recommended.filter((name) => !process.env[name])
    if (missingRecommended.length > 0) {
      console.warn(
        `[env] Recommended environment variables are not set: ${missingRecommended.join(', ')}. ` +
        `Falling back to defaults; the features that depend on these may be degraded.`
      )
    }
  }

  return {
    NODE_ENV: nodeEnv,
    NEXTAUTH_SECRET: process.env.NEXTAUTH_SECRET,
    NEXTAUTH_URL: process.env.NEXTAUTH_URL || 'http://localhost:3100',
    NEXT_PUBLIC_API_URL: process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4100',
    NEXT_PUBLIC_APP_URL: process.env.NEXT_PUBLIC_APP_URL || process.env.NEXTAUTH_URL || 'https://bobbinry.com',
    NEXT_PUBLIC_BUILD_ID: process.env.NEXT_PUBLIC_BUILD_ID || 'dev',
    GOOGLE_ID: process.env.GOOGLE_ID,
    GOOGLE_SECRET: process.env.GOOGLE_SECRET,
    INTERNAL_API_AUTH_TOKEN: process.env.INTERNAL_API_AUTH_TOKEN,
  }
}

export const env = validateEnv()
