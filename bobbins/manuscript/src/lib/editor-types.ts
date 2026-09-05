/** Shared types for the manuscript editor and its components/hooks. */

export type SaveStatus = 'clean' | 'dirty' | 'saving' | 'saved' | 'error' | 'offline' | 'conflict' | 'auth'

/** Dispatched by the shell once the API token has been renewed after a 401. */
export const AUTH_TOKEN_RENEWED_EVENT = 'bobbinry:auth-token-renewed'

export interface ConflictInfo {
  serverVersion: number
  localVersion: number | null
}

/** Origin to post editor bus messages to when the view is embedded. */
export function getParentOrigin(): string {
  if (typeof window === 'undefined') {
    return '*'
  }
  try {
    return document.referrer ? new URL(document.referrer).origin : window.location.origin
  } catch {
    return window.location.origin
  }
}
