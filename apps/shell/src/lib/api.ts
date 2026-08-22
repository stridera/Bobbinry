/**
 * Authenticated API Client
 *
 * Wraps fetch with the API base URL and JWT authorization header.
 * Use with the apiToken from the NextAuth session.
 *
 * On a 401 it asks the session layer for a renewed token (the API token is
 * re-minted from the still-valid NextAuth cookie) and retries once. Only if
 * that fails — user deleted/banned, cookie itself expired — is the user
 * signed out and sent to /login.
 */

import { config } from '@/lib/config'
import { requestSessionRefresh } from '@/lib/session-refresh'

/**
 * Make an authenticated fetch to the API.
 * Prepends the API base URL and sets the Authorization header.
 * On 401, refreshes the session and retries once with the new token.
 */
export async function apiFetch(
  path: string,
  apiToken: string,
  init?: RequestInit
): Promise<Response> {
  const url = `${config.apiUrl}${path}`
  const doFetch = (token: string) =>
    fetch(url, {
      ...init,
      headers: {
        ...init?.headers,
        'Authorization': `Bearer ${token}`,
      },
    })

  const res = await doFetch(apiToken)
  if (res.status !== 401) return res

  const renewed = await requestSessionRefresh(apiToken)
  if (!renewed) return res
  return doFetch(renewed)
}
