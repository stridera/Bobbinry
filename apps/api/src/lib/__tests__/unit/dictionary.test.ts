import { describe, it, expect, jest, beforeEach, afterAll } from '@jest/globals'

// The system under test imports the db for its cache helpers; those aren't
// exercised here, so a stub keeps this a pure unit test with no connection.
jest.mock('../../../db/connection', () => ({ db: {} }))

import { lookupFromUpstream, normalizeWord } from '../../dictionary'

// ---------------------------------------------------------------------------
// Upstream stubs. `fetch` is replaced per-test so the source chain can be
// driven through outages without touching the network.
// ---------------------------------------------------------------------------

const realFetch = globalThis.fetch

interface StubResponse {
  status: number
  body?: unknown
}

/** Cloudflare's 502 page — what the panel saw as an unexplained CORS failure. */
const GATEWAY_ERROR: StubResponse = { status: 502 }
const NOT_FOUND: StubResponse = { status: 404 }

function stubFetch(routes: { dictionaryapi: StubResponse; wiktionary: StubResponse }) {
  globalThis.fetch = jest.fn((url: unknown) => {
    const target = String(url).includes('dictionaryapi.dev') ? routes.dictionaryapi : routes.wiktionary
    return Promise.resolve({
      ok: target.status >= 200 && target.status < 300,
      status: target.status,
      json: async () => target.body,
    })
  }) as unknown as typeof fetch
}

const FREE_DICTIONARY_OK: StubResponse = {
  status: 200,
  body: [{ word: 'abate', meanings: [{ partOfSpeech: 'verb', definitions: [{ definition: 'To lessen.' }] }] }],
}

const WIKTIONARY_OK: StubResponse = {
  status: 200,
  body: {
    en: [{
      partOfSpeech: 'Verb',
      definitions: [
        // Parsoid output: a TemplateStyles <style> block, an <ol> wrapper, and a
        // parent sense whose only child repeats it verbatim.
        { definition: '<style data-mw="x">.mw-parser-output{font-size:smaller}</style>\n<ol><li>To <a href="/wiki/lessen">lessen</a> in force.</li></ol>' },
        { definition: 'To <a href="/wiki/lessen">lessen</a> in force.', examples: ['to <b>abate</b> a writ'] },
      ],
    }],
    // Other languages share the endpoint and must not leak into results.
    es: [{ partOfSpeech: 'Verbo', definitions: [{ definition: 'Spanish sense.' }] }],
  },
}

beforeEach(() => {
  jest.clearAllMocks()
})

afterAll(() => {
  globalThis.fetch = realFetch
})

describe('normalizeWord', () => {
  it('accepts words, rejecting anything that could reshape the upstream path', () => {
    expect(normalizeWord('Abate')).toBe('abate')
    expect(normalizeWord('  ember  ')).toBe('ember')
    expect(normalizeWord("mother's")).toBe("mother's")
    expect(normalizeWord('well-worn')).toBe('well-worn')

    expect(normalizeWord('123')).toBeNull()
    expect(normalizeWord('two words')).toBeNull()
    expect(normalizeWord('../../etc/passwd')).toBeNull()
    expect(normalizeWord('a'.repeat(200))).toBeNull()
    expect(normalizeWord('')).toBeNull()
  })
})

describe('lookupFromUpstream', () => {
  it('uses the primary source when it answers', async () => {
    stubFetch({ dictionaryapi: FREE_DICTIONARY_OK, wiktionary: GATEWAY_ERROR })
    const result = await lookupFromUpstream('abate')

    expect(result.status).toBe('ok')
    if (result.status !== 'ok') return
    expect(result.source).toBe('dictionaryapi')
    // Wiktionary is never consulted once the primary succeeds.
    expect(globalThis.fetch).toHaveBeenCalledTimes(1)
  })

  it('falls back to Wiktionary when the primary is down', async () => {
    // This is the reported outage: dictionaryapi.dev 502s per-word depending on
    // what happens to be warm in its edge cache.
    stubFetch({ dictionaryapi: GATEWAY_ERROR, wiktionary: WIKTIONARY_OK })
    const result = await lookupFromUpstream('abate')

    expect(result.status).toBe('ok')
    if (result.status !== 'ok') return
    expect(result.source).toBe('wiktionary')
    expect(result.entries[0].sourceUrls?.[0]).toBe('https://en.wiktionary.org/wiki/abate')
  })

  it('reports unavailable — never not-found — when every source is down', async () => {
    // The distinction is load-bearing: not-found gets cached, unavailable
    // must not be, or an outage would outlive itself.
    stubFetch({ dictionaryapi: GATEWAY_ERROR, wiktionary: GATEWAY_ERROR })
    expect((await lookupFromUpstream('abate')).status).toBe('unavailable')
  })

  it('keeps looking when one source lacks a word the other has', async () => {
    // dictionaryapi.dev's scrape lags Wiktionary, so its 404 is not authoritative.
    stubFetch({ dictionaryapi: NOT_FOUND, wiktionary: WIKTIONARY_OK })
    const result = await lookupFromUpstream('abate')

    expect(result.status).toBe('ok')
    if (result.status !== 'ok') return
    expect(result.source).toBe('wiktionary')
  })

  it('reports not-found only once every source agrees', async () => {
    stubFetch({ dictionaryapi: NOT_FOUND, wiktionary: NOT_FOUND })
    expect((await lookupFromUpstream('zzzqqxnotaword')).status).toBe('not-found')
  })

  it('treats an empty result as not-found rather than an empty entry', async () => {
    stubFetch({ dictionaryapi: { status: 200, body: [] }, wiktionary: { status: 200, body: { es: [] } } })
    expect((await lookupFromUpstream('abate')).status).toBe('not-found')
  })

  describe('Wiktionary normalization', () => {
    it('renders Parsoid HTML into the shape the panel already displays', async () => {
      stubFetch({ dictionaryapi: GATEWAY_ERROR, wiktionary: WIKTIONARY_OK })
      const result = await lookupFromUpstream('abate')
      if (result.status !== 'ok') throw new Error('expected ok')

      const meanings = result.entries[0].meanings || []
      expect(meanings).toHaveLength(1)
      expect(meanings[0].partOfSpeech).toBe('verb')

      const definitions = meanings[0].definitions || []
      // The <ol> wrapper and its identical child collapse to one sense.
      expect(definitions).toHaveLength(1)
      expect(definitions[0].definition).toBe('To lessen in force.')
      expect(definitions[0].example).toBe('to abate a writ')
    })

    it('strips TemplateStyles CSS and list markers out of definitions', async () => {
      stubFetch({ dictionaryapi: GATEWAY_ERROR, wiktionary: WIKTIONARY_OK })
      const result = await lookupFromUpstream('abate')
      if (result.status !== 'ok') throw new Error('expected ok')

      const text = JSON.stringify(result.entries[0].meanings)
      expect(text).not.toContain('font-size')
      expect(text).not.toContain('mw-parser-output')
      expect(text).not.toMatch(/^\W*\d+\./)
    })

    it('ignores non-English sections sharing the response', async () => {
      stubFetch({ dictionaryapi: GATEWAY_ERROR, wiktionary: WIKTIONARY_OK })
      const result = await lookupFromUpstream('abate')
      if (result.status !== 'ok') throw new Error('expected ok')

      expect(JSON.stringify(result.entries[0].meanings)).not.toContain('Spanish sense')
    })
  })
})
