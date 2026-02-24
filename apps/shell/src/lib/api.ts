/**
 * Authenticated API Client
 *
 * Wraps fetch with the API base URL and JWT authorization header.
 * Use with the apiToken from the NextAuth session.
 */

import { config } from '@/lib/config'

/**
 * Make an authenticated fetch to the API.
 * Prepends the API base URL and sets the Authorization header.
 */
export function apiFetch(
  path: string,
  apiToken: string,
  init?: RequestInit
): Promise<Response> {
  const url = `${config.apiUrl}${path}`
  return fetch(url, {
    ...init,
    headers: {
      ...init?.headers,
      'Authorization': `Bearer ${apiToken}`,
    },
  })
}
