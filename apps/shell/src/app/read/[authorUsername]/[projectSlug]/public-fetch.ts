/**
 * The public reader's request primitive. Reader endpoints are optional-auth:
 * anonymous readers get public chapters, signed-in readers get their beta and
 * subscriber perks, so the bearer header is attached only when a token is
 * present. `lib/api.ts#apiFetch` requires a token and refreshes on 401, which
 * is the wrong shape here. Every reader module fetches through this one
 * function so the contract (origin, headers, credentials) lives in one place.
 */
import { config } from '@/lib/config'

export function publicFetch(path: string, token?: string | null, init: RequestInit = {}): Promise<Response> {
  const headers: Record<string, string> = { ...(init.headers as Record<string, string> | undefined) }
  if (token) headers['Authorization'] = `Bearer ${token}`
  return fetch(`${config.apiUrl}/api${path}`, { ...init, headers })
}
