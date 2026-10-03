jest.mock('@/lib/api', () => ({ apiFetch: jest.fn() }))

import { apiFetch } from '@/lib/api'
import { fetchAllContentEntities } from '../content-entities'

const apiFetchMock = apiFetch as jest.Mock
const rows = (from: number, n: number) => Array.from({ length: n }, (_, i) => ({ id: `c${from + i}` }))
const page = (entities: unknown[], total?: number) =>
  Promise.resolve({ ok: true, json: async () => ({ entities, total }) })

describe('fetchAllContentEntities', () => {
  beforeEach(() => apiFetchMock.mockReset())

  it('pages with increasing offsets until total is reached', async () => {
    apiFetchMock
      .mockReturnValueOnce(page(rows(0, 500), 1100))
      .mockReturnValueOnce(page(rows(500, 500), 1100))
      .mockReturnValueOnce(page(rows(1000, 100), 1100))
    const all = await fetchAllContentEntities('p1', 'tok')
    expect(all).toHaveLength(1100)
    expect(apiFetchMock.mock.calls.map(([path]) => path.match(/offset=(\d+)/)[1])).toEqual(['0', '500', '1000'])
  })

  it('stops after one request when everything fits in a page', async () => {
    apiFetchMock.mockReturnValueOnce(page(rows(0, 3), 3))
    expect(await fetchAllContentEntities('p1', 'tok')).toHaveLength(3)
    expect(apiFetchMock).toHaveBeenCalledTimes(1)
  })

  it('stops on an empty page even if total is larger', async () => {
    apiFetchMock.mockReturnValueOnce(page(rows(0, 500), 900)).mockReturnValueOnce(page([], 900))
    expect(await fetchAllContentEntities('p1', 'tok')).toHaveLength(500)
  })

  it('treats a short page as the end when total is missing', async () => {
    apiFetchMock.mockReturnValueOnce(page(rows(0, 10)))
    expect(await fetchAllContentEntities('p1', 'tok')).toHaveLength(10)
    expect(apiFetchMock).toHaveBeenCalledTimes(1)
  })

  it('returns an empty list on a non-ok response', async () => {
    apiFetchMock.mockReturnValueOnce(Promise.resolve({ ok: false, json: async () => ({}) }))
    expect(await fetchAllContentEntities('p1', 'tok')).toEqual([])
  })

  it('throws rather than returning a partial list when a later page fails', async () => {
    apiFetchMock
      .mockReturnValueOnce(page(rows(0, 500), 1100))
      .mockReturnValueOnce(Promise.resolve({ ok: false, status: 500, json: async () => ({}) }))
    await expect(fetchAllContentEntities('p1', 'tok')).rejects.toThrow('Failed to load chapters (500)')
  })
})
