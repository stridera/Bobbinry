import { describe, it, expect, jest, beforeEach, afterAll } from '@jest/globals'
import { clearThesaurusCache, lookupThesaurus } from '../../thesaurus'

// ---------------------------------------------------------------------------
// Upstream stubs. Datamuse serves synonyms and antonyms from the same endpoint,
// told apart by the rel_syn / rel_ant query parameter.
// ---------------------------------------------------------------------------

const realFetch = globalThis.fetch

type StubResponse = { status: number; body?: unknown } | 'network-error'

function stubFetch(routes: { synonyms: StubResponse; antonyms: StubResponse }) {
  globalThis.fetch = jest.fn((url: unknown) => {
    const target = String(url).includes('rel_syn=') ? routes.synonyms : routes.antonyms
    if (target === 'network-error') return Promise.reject(new TypeError('fetch failed'))
    return Promise.resolve({
      ok: target.status >= 200 && target.status < 300,
      status: target.status,
      json: async () => target.body,
    })
  }) as unknown as typeof fetch
}

const SYNONYMS_OK: StubResponse = { status: 200, body: [{ word: 'glad', score: 900 }, { word: 'content', score: 800 }] }
const ANTONYMS_OK: StubResponse = { status: 200, body: [{ word: 'sad', score: 700 }] }
const DOWN: StubResponse = { status: 503 }

beforeEach(() => {
  jest.clearAllMocks()
  clearThesaurusCache()
})

afterAll(() => {
  globalThis.fetch = realFetch
})

describe('lookupThesaurus', () => {
  it('returns synonyms and antonyms as plain word lists', async () => {
    stubFetch({ synonyms: SYNONYMS_OK, antonyms: ANTONYMS_OK })
    const lookup = await lookupThesaurus('happy')

    expect(lookup).toEqual({ status: 'ok', result: { synonyms: ['glad', 'content'], antonyms: ['sad'] } })
  })

  it('treats a word Datamuse has nothing for as an empty result, not a failure', async () => {
    stubFetch({ synonyms: { status: 200, body: [] }, antonyms: { status: 200, body: [] } })
    expect(await lookupThesaurus('zzzqqx')).toEqual({ status: 'ok', result: { synonyms: [], antonyms: [] } })
  })

  it('reports unavailable when Datamuse is down or unreachable', async () => {
    // The distinction is load-bearing: the panel only offers a retry, and only
    // says "unavailable" rather than "no synonyms", for this outcome.
    stubFetch({ synonyms: DOWN, antonyms: DOWN })
    expect((await lookupThesaurus('happy')).status).toBe('unavailable')

    stubFetch({ synonyms: 'network-error', antonyms: 'network-error' })
    expect((await lookupThesaurus('happy')).status).toBe('unavailable')
  })

  it('treats an unexpected body as a failed request', async () => {
    stubFetch({ synonyms: { status: 200, body: { error: 'nope' } }, antonyms: DOWN })
    expect((await lookupThesaurus('happy')).status).toBe('unavailable')
  })

  it('keeps the half that answered when the other request fails', async () => {
    stubFetch({ synonyms: SYNONYMS_OK, antonyms: DOWN })
    expect(await lookupThesaurus('happy')).toEqual({ status: 'ok', result: { synonyms: ['glad', 'content'], antonyms: [] } })
  })

  it('caches a complete result', async () => {
    stubFetch({ synonyms: SYNONYMS_OK, antonyms: ANTONYMS_OK })
    await lookupThesaurus('happy')
    await lookupThesaurus('happy')

    expect(globalThis.fetch).toHaveBeenCalledTimes(2)
  })

  it('does not cache a partial result', async () => {
    stubFetch({ synonyms: SYNONYMS_OK, antonyms: DOWN })
    await lookupThesaurus('happy')
    await lookupThesaurus('happy')

    expect(globalThis.fetch).toHaveBeenCalledTimes(4)
  })
})
