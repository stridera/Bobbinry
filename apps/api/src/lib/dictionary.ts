/**
 * Dictionary lookups for the dictionary-panel bobbin.
 *
 * The panel used to call api.dictionaryapi.dev straight from the browser. That
 * host is a free community mirror of Wiktionary sitting behind Cloudflare, and
 * when its origin falls over -- which it does -- only words still warm in the
 * edge cache answer. Everything else gets Cloudflare's 502 page, which carries
 * no CORS headers, so the browser reports it as a CORS failure and the panel
 * had no way to tell "this word doesn't exist" from "the internet is broken".
 *
 * Routing through the API fixes three things at once: we own the CORS contract,
 * we can fall through to Wiktionary directly (the same underlying data, run by
 * Wikimedia), and we can cache a word once so it never depends on an upstream
 * again.
 */

import { convert } from 'html-to-text'
import { and, eq, sql } from 'drizzle-orm'
import { db } from '../db/connection'
import { dictionaryCache } from '../db/schema'

export interface DictionaryPhonetic {
  text?: string
  audio?: string
}

export interface DictionaryDefinition {
  definition: string
  example?: string
}

export interface DictionaryMeaning {
  partOfSpeech?: string
  definitions?: DictionaryDefinition[]
}

export interface DictionaryEntry {
  word: string
  phonetics?: DictionaryPhonetic[]
  meanings?: DictionaryMeaning[]
  sourceUrls?: string[]
}

export type LookupResult =
  | { status: 'ok'; entries: DictionaryEntry[]; source: string }
  | { status: 'not-found' }
  | { status: 'unavailable' }

/** Words only. Guards the upstream path segment and bounds the cache key. */
const WORD_RE = /^[a-z][a-z'-]{0,63}$/

/** Definitions don't change; the TTL exists to pick up upstream corrections. */
const HIT_TTL_DAYS = 30

/** Shorter, because a miss is more often a transient gap than a permanent one. */
const MISS_TTL_DAYS = 1

const UPSTREAM_TIMEOUT_MS = 5000

/** Bounds the stored payload -- Wiktionary returns a lot for common words. */
const MAX_MEANINGS = 6
const MAX_DEFINITIONS = 6

const HTML_TO_TEXT_OPTIONS = {
  wordwrap: false as const,
  selectors: [
    // Wiktionary inlines TemplateStyles <style> blocks into definition HTML;
    // without this they'd land in the text as raw CSS.
    { selector: 'style', format: 'skip' },
    { selector: 'script', format: 'skip' },
    { selector: 'a', options: { ignoreHref: true } },
  ],
}

export function normalizeWord(raw: string): string | null {
  const word = (raw || '').trim().toLowerCase()
  return WORD_RE.test(word) ? word : null
}

function toPlainText(html: string): string {
  return convert(html || '', HTML_TO_TEXT_OPTIONS)
    .replace(/\s+/g, ' ')
    // Trim before stripping the marker, not after: the collapse above leaves a
    // leading space that would stop the anchored match.
    .trim()
    // Nested <ol><li> in Wiktionary definitions survives conversion as a leading
    // "1. " marker that means nothing once the list is flattened. Removing it
    // also lets the dedupe below collapse a parent sense onto its only child,
    // which otherwise differ by exactly this prefix.
    .replace(/^\d+\.\s*/, '')
    .trim()
}

/**
 * Distinguishes "no such word" from "upstream is down". Only the latter is
 * worth retrying, and only the former is worth caching as a negative.
 */
async function getJson(url: string): Promise<{ status: 'ok'; body: unknown } | { status: 'not-found' } | { status: 'unavailable' }> {
  try {
    const response = await fetch(url, {
      signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
      headers: {
        // Wikimedia asks for a contactable UA on API traffic.
        'User-Agent': 'Bobbinry/1.0 (https://bobbinry.com)',
        Accept: 'application/json',
      },
    })
    if (response.status === 404) return { status: 'not-found' }
    if (!response.ok) return { status: 'unavailable' }
    return { status: 'ok', body: await response.json() }
  } catch {
    // Network error, timeout, or malformed JSON -- all retryable.
    return { status: 'unavailable' }
  }
}

async function fetchFreeDictionary(word: string): Promise<LookupResult> {
  const result = await getJson(`https://api.dictionaryapi.dev/api/v2/entries/en/${encodeURIComponent(word)}`)
  if (result.status !== 'ok') return result

  const entries = Array.isArray(result.body) ? result.body as DictionaryEntry[] : []
  if (!entries.length) return { status: 'not-found' }
  return { status: 'ok', entries, source: 'dictionaryapi' }
}

interface WiktionarySection {
  partOfSpeech?: string
  language?: string
  definitions?: Array<{ definition?: string; examples?: string[] }>
}

/**
 * Wikimedia's own REST endpoint. Same source data as dictionaryapi.dev, but
 * the definitions arrive as Parsoid HTML and are keyed by language code, so
 * they need flattening into the shape the panel already renders.
 */
async function fetchWiktionary(word: string): Promise<LookupResult> {
  const result = await getJson(`https://en.wiktionary.org/api/rest_v1/page/definition/${encodeURIComponent(word)}`)
  if (result.status !== 'ok') return result

  const sections = (result.body as Record<string, WiktionarySection[]> | null)?.en
  if (!Array.isArray(sections) || !sections.length) return { status: 'not-found' }

  // Keyed by definition text so a duplicate can enrich the sense already kept
  // rather than just being dropped.
  const seen = new Map<string, DictionaryDefinition>()
  const meanings: DictionaryMeaning[] = []

  for (const section of sections.slice(0, MAX_MEANINGS)) {
    const definitions: DictionaryDefinition[] = []

    for (const entry of section.definitions || []) {
      const definition = toPlainText(entry.definition || '')
      if (!definition) continue

      const example = toPlainText(entry.examples?.[0] || '')

      // Wiktionary nests a parent sense around its sub-senses, so the same text
      // appears twice. The wrapper comes first and carries no examples, so the
      // duplicate is where the example lives -- take it before discarding.
      const existing = seen.get(definition)
      if (existing) {
        if (!existing.example && example) existing.example = example
        continue
      }

      const record: DictionaryDefinition = example ? { definition, example } : { definition }
      seen.set(definition, record)
      definitions.push(record)
      if (definitions.length >= MAX_DEFINITIONS) break
    }

    if (definitions.length) {
      const partOfSpeech = section.partOfSpeech?.toLowerCase()
      meanings.push(partOfSpeech ? { partOfSpeech, definitions } : { definitions })
    }
  }

  if (!meanings.length) return { status: 'not-found' }

  return {
    status: 'ok',
    source: 'wiktionary',
    entries: [{
      word,
      meanings,
      sourceUrls: [`https://en.wiktionary.org/wiki/${encodeURIComponent(word)}`],
    }],
  }
}

const SOURCES = [fetchFreeDictionary, fetchWiktionary]

/**
 * Tries each source in order. A source reporting not-found is not authoritative
 * on its own -- dictionaryapi.dev's scrape lags Wiktionary and misses words the
 * upstream has -- so the chain continues and only reports not-found when every
 * source agrees. That costs one extra request per unknown word, once, since the
 * negative is then cached.
 */
export async function lookupFromUpstream(word: string): Promise<LookupResult> {
  let sawNotFound = false

  for (const source of SOURCES) {
    const result = await source(word)
    if (result.status === 'ok') return result
    if (result.status === 'not-found') sawNotFound = true
  }

  return sawNotFound ? { status: 'not-found' } : { status: 'unavailable' }
}

export interface CachedLookup {
  entries: DictionaryEntry[] | null
  source: string
  notFound: boolean
}

export async function readCache(word: string): Promise<CachedLookup | null> {
  const [row] = await db
    .select({
      payload: dictionaryCache.payload,
      source: dictionaryCache.source,
      notFound: dictionaryCache.notFound,
    })
    .from(dictionaryCache)
    .where(and(
      eq(dictionaryCache.word, word),
      // TTL is evaluated in SQL so a stale row simply doesn't match, rather
      // than being read back and compared against a possibly-skewed clock.
      sql`${dictionaryCache.fetchedAt} > now() - (
        CASE WHEN ${dictionaryCache.notFound}
          THEN ${MISS_TTL_DAYS} * interval '1 day'
          ELSE ${HIT_TTL_DAYS} * interval '1 day'
        END
      )`
    ))
    .limit(1)

  if (!row) return null
  return {
    entries: (row.payload as DictionaryEntry[] | null) ?? null,
    source: row.source,
    notFound: row.notFound,
  }
}

export async function writeCache(word: string, value: CachedLookup): Promise<void> {
  await db
    .insert(dictionaryCache)
    .values({
      word,
      payload: value.entries,
      source: value.source,
      notFound: value.notFound,
      fetchedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: dictionaryCache.word,
      set: {
        payload: value.entries,
        source: value.source,
        notFound: value.notFound,
        fetchedAt: new Date(),
      },
    })
}
