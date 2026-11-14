/**
 * Helpers for round-tripping a user through /login and back.
 *
 * Pure and dependency-free so both the edge middleware and client components
 * can import it.
 */

/**
 * Returns `raw` when it is a same-origin relative path that is safe to
 * redirect to, otherwise null. Rejects protocol-relative (`//host`) and
 * backslash (`/\host`) forms that browsers normalise into external URLs, and
 * anything containing control characters.
 */
export function safeCallbackPath(raw: string | null | undefined): string | null {
  if (!raw || typeof raw !== 'string') return null
  if (!raw.startsWith('/')) return null
  if (raw.startsWith('//') || raw.startsWith('/\\')) return null
  if (/[\u0000-\u001f\u007f]/.test(raw)) return null
  return raw
}

/** `/login` link that returns the user to `path` after signing in. */
export function loginHref(path: string | null | undefined): string {
  const safe = safeCallbackPath(path)
  return safe ? `/login?callbackUrl=${encodeURIComponent(safe)}` : '/login'
}
