/**
 * Session refresh coordinator.
 *
 * The API token lives inside the NextAuth session and is re-minted by the
 * `jwt` callback whenever the session is (re)fetched. Anything that sees a
 * 401 — `apiFetch`, the SDK's `onUnauthorized` hook, the expiry watchdog —
 * funnels through `requestSessionRefresh()` so that:
 *
 *   - concurrent 401s from parallel requests trigger ONE refresh, not many
 *   - the refresh goes through `useSession().update()` (registered by
 *     SessionValidator) so the React session context actually updates and
 *     every `session.apiToken` consumer re-renders with the new token
 *   - if the refresh can't produce a usable token the user is sent to
 *     /login once, with a callback to where they were
 *
 * Dispatches `bobbinry:auth-token-renewed` on `window` after a successful
 * refresh so non-React code (the manuscript editor's autosave) can retry.
 */

import { signOut } from 'next-auth/react'

export const AUTH_TOKEN_RENEWED_EVENT = 'bobbinry:auth-token-renewed'

/** Returns the fresh API token, or null if the session could not be renewed. */
type Refresher = () => Promise<string | null>

let refresher: Refresher | null = null
let inFlight: Promise<string | null> | null = null
let signingOut = false

/** Registered once by SessionValidator, which owns `useSession().update`. */
export function registerSessionRefresher(fn: Refresher | null) {
  refresher = fn
}

/** Decode the `exp` claim (epoch ms) from a JWT without verifying it. */
export function getTokenExpiry(token: string | undefined | null): number | null {
  if (!token) return null
  try {
    const payload = token.split('.')[1]
    if (!payload) return null
    const json = atob(payload.replace(/-/g, '+').replace(/_/g, '/'))
    const exp = JSON.parse(json)?.exp
    return typeof exp === 'number' ? exp * 1000 : null
  } catch {
    return null
  }
}

/** Send the user to the login page exactly once, preserving where they were. */
export function redirectToLogin() {
  if (signingOut) return
  signingOut = true
  const callbackUrl =
    typeof window !== 'undefined' ? window.location.pathname + window.location.search : '/'
  signOut({ callbackUrl: `/login?callbackUrl=${encodeURIComponent(callbackUrl)}` })
}

/**
 * Ask the server for a renewed session. Deduplicates concurrent callers.
 * Resolves with the new API token, or null (after redirecting to login).
 *
 * @param failedToken the token that just got a 401, if any. If the server
 *   hands back the very same token the session is genuinely dead (user
 *   deleted/banned, secret rotated) and we sign out instead of looping.
 */
export function requestSessionRefresh(failedToken?: string | null): Promise<string | null> {
  if (inFlight) return inFlight
  if (!refresher) {
    // No provider mounted (shouldn't happen inside the app shell) — fall back
    // to the old behaviour rather than silently swallowing the 401.
    redirectToLogin()
    return Promise.resolve(null)
  }

  inFlight = refresher()
    .then((token) => {
      if (!token || (failedToken && token === failedToken)) {
        redirectToLogin()
        return null
      }
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent(AUTH_TOKEN_RENEWED_EVENT, { detail: { token } }))
      }
      return token
    })
    .catch(() => {
      // Network failure during refresh — don't sign out, the user may simply
      // be offline. The caller keeps its local draft; the watchdog retries.
      return null
    })
    .finally(() => {
      inFlight = null
    })

  return inFlight
}
