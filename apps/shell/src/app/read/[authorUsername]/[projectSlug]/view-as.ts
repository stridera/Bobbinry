/**
 * Owner-only "view as" audience preview (`?viewAs=visitor|beta|tier:<id>`).
 *
 * The param has to ride along on every reader API call, or the preview leaks:
 * the codex endpoints gate on the caller's tier level, so an owner who drops
 * the param gets their real Infinity bypass back and sees tier-locked entities
 * mid-preview. It also has to survive in-app navigation, or clicking into an
 * entity silently ends the preview.
 */

/** Append `viewAs` to a URL or href that may already carry a query string. */
export function withViewAs(url: string, viewAs: string | undefined | null): string {
  if (!viewAs) return url
  const separator = url.includes('?') ? '&' : '?'
  return `${url}${separator}viewAs=${encodeURIComponent(viewAs)}`
}
