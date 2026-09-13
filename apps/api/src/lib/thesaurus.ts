/**
 * Thesaurus lookups for the dictionary-panel bobbin.
 *
 * The panel used to call Datamuse straight from the browser. Datamuse itself is
 * healthy and answers CORS for any origin, but a direct request to a
 * third-party host is exactly what tracker blockers, privacy extensions, and
 * filtered networks drop -- and the panel rendered that as "No synonyms found",
 * so the thesaurus worked for some authors and silently not for others.
 * Proxying keeps the browser talking only to our API, the same move
 * lib/dictionary.ts made for definitions.
 *
 * Datamuse has no notion of an unknown word (it just returns an empty list), so
 * unlike the dictionary there is no not-found outcome. Results live in a small
 * in-process cache rather than a table: Datamuse answers from CloudFront
 * quickly, and a restarted machine simply refetches.
 */

export interface ThesaurusResult {
  synonyms: string[]
  antonyms: string[]
}

export type ThesaurusLookup =
  | { status: 'ok'; result: ThesaurusResult }
  | { status: 'unavailable' }

const MAX_SYNONYMS = 20
const MAX_ANTONYMS = 12

const UPSTREAM_TIMEOUT_MS = 5000

const CACHE_TTL_MS = 24 * 60 * 60 * 1000
const CACHE_MAX_ENTRIES = 5000

/** Map iteration order is insertion order, so the first key is the oldest. */
const cache = new Map<string, { result: ThesaurusResult; expiresAt: number }>()

/** Null means the request failed; an empty list means Datamuse knows no related words. */
async function fetchRelated(relation: 'rel_syn' | 'rel_ant', word: string, max: number): Promise<string[] | null> {
  try {
    const response = await fetch(
      `https://api.datamuse.com/words?${relation}=${encodeURIComponent(word)}&max=${max}`,
      {
        signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
        headers: {
          'User-Agent': 'Bobbinry/1.0 (https://bobbinry.com)',
          Accept: 'application/json',
        },
      },
    )
    if (!response.ok) return null
    const body = await response.json()
    if (!Array.isArray(body)) return null
    return (body as Array<{ word?: unknown } | null>)
      .map((entry) => entry?.word)
      .filter((value): value is string => typeof value === 'string' && value.length > 0)
  } catch {
    // Network error, timeout, or malformed JSON -- all retryable.
    return null
  }
}

/** `word` must already be normalized (see normalizeWord in lib/dictionary.ts). */
export async function lookupThesaurus(word: string): Promise<ThesaurusLookup> {
  const cached = cache.get(word)
  if (cached && cached.expiresAt > Date.now()) {
    return { status: 'ok', result: cached.result }
  }

  const [synonyms, antonyms] = await Promise.all([
    fetchRelated('rel_syn', word, MAX_SYNONYMS),
    fetchRelated('rel_ant', word, MAX_ANTONYMS),
  ])

  if (!synonyms && !antonyms) return { status: 'unavailable' }

  const result = { synonyms: synonyms ?? [], antonyms: antonyms ?? [] }

  // Only a complete answer is cached; a half-failed one would pin the missing
  // half for the whole TTL.
  if (synonyms && antonyms) {
    cache.delete(word)
    if (cache.size >= CACHE_MAX_ENTRIES) {
      const oldest = cache.keys().next().value
      if (oldest !== undefined) cache.delete(oldest)
    }
    cache.set(word, { result, expiresAt: Date.now() + CACHE_TTL_MS })
  }

  return { status: 'ok', result }
}

export function clearThesaurusCache(): void {
  cache.clear()
}
