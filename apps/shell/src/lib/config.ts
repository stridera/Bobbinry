/**
 * Client-safe configuration
 *
 * Single source of truth for runtime config that works in both server
 * and client components. NEXT_PUBLIC_* vars are inlined at build time
 * by Next.js, so this is safe to import anywhere.
 *
 * For server-only config (secrets, DATABASE_URL), use ./env.ts instead.
 */

export const config = {
  /** Base URL for the API (no trailing slash) */
  apiUrl: process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4100',
  /** PostHog project key. Unset disables analytics entirely (dev, self-hosters). */
  posthogKey: process.env.NEXT_PUBLIC_POSTHOG_KEY || '',
  /** PostHog ingestion host. EU cloud is https://eu.i.posthog.com */
  posthogHost: process.env.NEXT_PUBLIC_POSTHOG_HOST || 'https://us.i.posthog.com',
} as const
