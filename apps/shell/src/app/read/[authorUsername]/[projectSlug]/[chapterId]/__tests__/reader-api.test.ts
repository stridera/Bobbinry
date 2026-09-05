jest.mock('@/lib/config', () => ({ config: { apiUrl: 'https://api.test' } }))

import { publicFetch, readerApi } from '../reader-api'

const fetchMock = jest.fn()

beforeEach(() => {
  fetchMock.mockReset()
  global.fetch = fetchMock as unknown as typeof fetch
})

function respond(body: unknown, ok = true, status = ok ? 200 : 500) {
  fetchMock.mockResolvedValueOnce({ ok, status, json: async () => body })
}

describe('publicFetch', () => {
  it('prefixes the API origin and adds a bearer header only when a token is present', async () => {
    fetchMock.mockResolvedValue({ ok: true, status: 200 })
    await publicFetch('/public/x')
    await publicFetch('/public/y', 'tok', { headers: { 'Content-Type': 'application/json' } })

    expect(fetchMock.mock.calls[0][0]).toBe('https://api.test/api/public/x')
    expect(fetchMock.mock.calls[0][1].headers).toEqual({})
    expect(fetchMock.mock.calls[1][1].headers).toEqual({
      'Content-Type': 'application/json',
      Authorization: 'Bearer tok',
    })
  })
})

describe('readerApi', () => {
  it('returns null lists on a failed response', async () => {
    respond({}, false, 404)
    expect(await readerApi.fetchComments('c1')).toBeNull()
  })

  it('treats a missing entities bobbin as no names', async () => {
    respond({ installed: false, entities: [{ id: 'e1' }] })
    expect(await readerApi.fetchPublishedEntityNames('p1')).toBeNull()
  })

  it('reports what the reaction toggle did', async () => {
    respond({ action: 'added' })
    expect(await readerApi.toggleReaction('c1', 'tok', 'heart')).toBe('added')
    respond({ action: 'weird' })
    expect(await readerApi.toggleReaction('c1', 'tok', 'heart')).toBeNull()
  })

  it('posts an annotation with the anchor flattened into the API shape', async () => {
    respond({}, true, 201)
    const ok = await readerApi.postAnnotation('c1', 'tok', {
      projectId: 'p1',
      anchor: { paragraphIndex: 2, quote: 'the reactor', charOffset: 5, charLength: 11 },
      annotationType: 'error',
      errorCategory: 'typo',
      content: 'fix',
    })
    expect(ok).toBe(true)
    const body = JSON.parse(fetchMock.mock.calls[0][1].body)
    expect(body).toMatchObject({
      projectId: 'p1', anchorParagraphIndex: 2, anchorQuote: 'the reactor',
      anchorCharOffset: 5, anchorCharLength: 11, annotationType: 'error', errorCategory: 'typo', content: 'fix',
    })
  })
})
