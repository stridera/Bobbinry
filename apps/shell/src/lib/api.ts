/**
 * Authenticated API Client
 *
 * Wraps fetch with the API base URL and JWT authorization header.
 * Use with the apiToken from the NextAuth session.
 *
 * Automatically handles 401 responses by signing the user out,
 * so stale sessions (e.g. deleted/banned users) are cleared immediately.
 */

import { signOut } from 'next-auth/react'
import { config } from '@/lib/config'

/** Prevent multiple concurrent signOut calls when parallel requests hit 401 */
let signingOut = false

/**
 * Make an authenticated fetch to the API.
 * Prepends the API base URL and sets the Authorization header.
 * On 401 responses, triggers a sign-out to clear the stale session.
 */
export async function apiFetch(
  path: string,
  apiToken: string,
  init?: RequestInit
): Promise<Response> {
  const url = `${config.apiUrl}${path}`
  const res = await fetch(url, {
    ...init,
    headers: {
      ...init?.headers,
      'Authorization': `Bearer ${apiToken}`,
    },
  })

  if (res.status === 401 && !signingOut) {
    signingOut = true
    signOut({ callbackUrl: '/login' })
  }

  return res
}
