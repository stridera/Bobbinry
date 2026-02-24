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
} as const
