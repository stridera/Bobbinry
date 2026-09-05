/**
 * Copy only the listed keys whose value is not `undefined`.
 *
 * Use on request bodies before spreading them into `.set()` / `.values()`.
 * Spreading a raw body lets a caller smuggle in any column the table has —
 * including primary/foreign keys such as `projectId` — which is a mass
 * assignment hole. Explicit `null` is preserved so callers can clear a field.
 */
export function pickDefined<T extends object, K extends keyof T>(
  source: T | null | undefined,
  keys: readonly K[],
): Pick<T, K> {
  const out = {} as Pick<T, K>
  if (!source) return out
  for (const key of keys) {
    const value = source[key]
    if (value !== undefined) out[key] = value
  }
  return out
}
