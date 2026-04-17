import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals'
import { BobbinryClient } from '../api/client.js'
import { ApiError, AuthError } from '../lib/errors.js'

const mockFetch = jest.fn() as jest.MockedFunction<typeof fetch>

beforeEach(() => {
  global.fetch = mockFetch
  mockFetch.mockReset()
})

afterEach(() => {
  mockFetch.mockRestore()
})

function jsonResponse(data: any, status = 200): Response {
  const body = JSON.stringify(data)
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: status === 200 ? 'OK' : 'Error',
    headers: new Headers(),
    json: () => Promise.resolve(data),
    text: () => Promise.resolve(body),
    arrayBuffer: () => Promise.resolve(new TextEncoder().encode(body).buffer),
  } as Response
}

describe('BobbinryClient', () => {
  describe('authentication', () => {
    it('throws AuthError when no API key is set for authenticated endpoints', async () => {
      const client = new BobbinryClient({ apiUrl: 'http://test.api' })
      await expect(client.listProjects()).rejects.toThrow(AuthError)
      await expect(client.listProjects()).rejects.toThrow('No API key configured')
    })

    it('sends Authorization header with API key', async () => {
      const client = new BobbinryClient({ apiKey: 'bby_testkey', apiUrl: 'http://test.api' })
      mockFetch.mockResolvedValueOnce(jsonResponse([]))

      await client.listProjects()

      expect(mockFetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          headers: expect.objectContaining({ Authorization: 'Bearer bby_testkey' })
        })
      )
    })

    it('does not require auth for public endpoints', async () => {
      const client = new BobbinryClient({ apiUrl: 'http://test.api' })
      mockFetch.mockResolvedValueOnce(jsonResponse({ projects: [] }))

      await expect(client.discoverProjects()).resolves.toBeDefined()
    })
  })

  describe('projects', () => {
    let client: BobbinryClient

    beforeEach(() => {
      client = new BobbinryClient({ apiKey: 'bby_test', apiUrl: 'http://test.api' })
    })

    it('listProjects calls GET /api/projects', async () => {
      mockFetch.mockResolvedValueOnce(jsonResponse([{ id: 'p1', name: 'My Book' }]))

      const result = await client.listProjects()

      expect(mockFetch).toHaveBeenCalledWith(
        'http://test.api/api/projects',
        expect.objectContaining({ method: 'GET' })
      )
      expect(result[0].name).toBe('My Book')
    })

    it('getProject calls GET /api/projects/:id', async () => {
      mockFetch.mockResolvedValueOnce(jsonResponse({ id: 'p1', name: 'Test' }))

      const result = await client.getProject('p1')

      expect(mockFetch).toHaveBeenCalledWith(
        'http://test.api/api/projects/p1',
        expect.any(Object)
      )
      expect(result.name).toBe('Test')
    })

    it('createProject sends POST with name and description', async () => {
      mockFetch.mockResolvedValueOnce(jsonResponse({ project: { id: 'new', name: 'New Book' } }))

      const result = await client.createProject('New Book', 'A great story')

      expect(mockFetch).toHaveBeenCalledWith(
        'http://test.api/api/projects',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({ name: 'New Book', description: 'A great story' }),
          headers: expect.objectContaining({ 'Content-Type': 'application/json' })
        })
      )
      expect(result.project.name).toBe('New Book')
    })

    it('getProjectBobbins calls GET /api/projects/:id/bobbins', async () => {
      mockFetch.mockResolvedValueOnce(jsonResponse({ bobbins: [{ bobbinId: 'manuscript' }] }))

      const result = await client.getProjectBobbins('p1')

      expect(mockFetch).toHaveBeenCalledWith(
        'http://test.api/api/projects/p1/bobbins',
        expect.any(Object)
      )
      expect(result.bobbins[0].bobbinId).toBe('manuscript')
    })
  })

  describe('entities', () => {
    let client: BobbinryClient

    beforeEach(() => {
      client = new BobbinryClient({ apiKey: 'bby_test', apiUrl: 'http://test.api' })
    })

    it('queryEntities builds correct URL with params', async () => {
      mockFetch.mockResolvedValueOnce(jsonResponse({ entities: [], total: 0 }))

      await client.queryEntities('characters', {
        projectId: 'p1',
        limit: 10,
        offset: 5,
        search: 'hero',
      })

      const url = (mockFetch.mock.calls[0] as any[])[0] as string
      expect(url).toContain('/collections/characters/entities')
      expect(url).toContain('projectId=p1')
      expect(url).toContain('limit=10')
      expect(url).toContain('offset=5')
      expect(url).toContain('search=hero')
    })

    it('queryEntities includes filters as JSON', async () => {
      mockFetch.mockResolvedValueOnce(jsonResponse({ entities: [], total: 0 }))

      await client.queryEntities('content', {
        projectId: 'p1',
        filters: { status: 'draft' },
      })

      const url = (mockFetch.mock.calls[0] as any[])[0] as string
      expect(url).toContain('filters=' + encodeURIComponent('{"status":"draft"}'))
    })

    it('getEntity calls correct URL', async () => {
      mockFetch.mockResolvedValueOnce(jsonResponse({ id: 'e1', title: 'Hero' }))

      const result = await client.getEntity('e1', { projectId: 'p1', collection: 'characters' })

      const url = (mockFetch.mock.calls[0] as any[])[0] as string
      expect(url).toContain('/entities/e1')
      expect(url).toContain('projectId=p1')
      expect(url).toContain('collection=characters')
      expect(result.title).toBe('Hero')
    })

    it('createEntity sends POST to /api/entities', async () => {
      mockFetch.mockResolvedValueOnce(jsonResponse({ id: 'new', title: 'Villain' }))

      await client.createEntity('characters', 'p1', { title: 'Villain' })

      expect(mockFetch).toHaveBeenCalledWith(
        'http://test.api/api/entities',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({ collection: 'characters', projectId: 'p1', data: { title: 'Villain' } })
        })
      )
    })

    it('updateEntity sends PUT with version', async () => {
      mockFetch.mockResolvedValueOnce(jsonResponse({ id: 'e1', title: 'Updated' }))

      await client.updateEntity('e1', {
        collection: 'characters',
        projectId: 'p1',
        data: { title: 'Updated' },
        expectedVersion: 3,
      })

      expect(mockFetch).toHaveBeenCalledWith(
        'http://test.api/api/entities/e1',
        expect.objectContaining({
          method: 'PUT',
          body: JSON.stringify({
            collection: 'characters',
            projectId: 'p1',
            data: { title: 'Updated' },
            expectedVersion: 3,
          })
        })
      )
    })

    it('deleteEntity sends DELETE with query params', async () => {
      mockFetch.mockResolvedValueOnce(jsonResponse(undefined))

      await client.deleteEntity('e1', { projectId: 'p1', collection: 'characters' })

      const [url, opts] = mockFetch.mock.calls[0] as any[]
      expect(url).toContain('/entities/e1')
      expect(url).toContain('projectId=p1')
      expect(url).toContain('collection=characters')
      expect(opts.method).toBe('DELETE')
    })
  })

  describe('error handling', () => {
    let client: BobbinryClient

    beforeEach(() => {
      client = new BobbinryClient({ apiKey: 'bby_test', apiUrl: 'http://test.api' })
    })

    it('throws ApiError with status on HTTP errors', async () => {
      mockFetch.mockResolvedValueOnce(jsonResponse({ error: 'Not Found' }, 404))

      try {
        await client.getProject('missing')
        expect(true).toBe(false) // should not reach
      } catch (err) {
        expect(err).toBeInstanceOf(ApiError)
        expect((err as ApiError).status).toBe(404)
      }
    })

    it('provides hint for 401 errors', async () => {
      mockFetch.mockResolvedValueOnce(jsonResponse({ error: 'Unauthorized' }, 401))

      try {
        await client.listProjects()
        expect(true).toBe(false)
      } catch (err) {
        expect((err as ApiError).hint).toContain('API key is invalid')
      }
    })

    it('provides hint for 403 scope errors', async () => {
      mockFetch.mockResolvedValueOnce(
        jsonResponse({ error: 'Insufficient scope', message: "This API key does not have the 'entities:write' scope" }, 403)
      )

      try {
        await client.createEntity('test', 'p1', {})
        expect(true).toBe(false)
      } catch (err) {
        expect((err as ApiError).hint).toContain('required scope')
      }
    })

    it('provides hint for 429 rate limit errors', async () => {
      mockFetch.mockResolvedValueOnce(jsonResponse({ error: 'Rate limited' }, 429))

      try {
        await client.listProjects()
        expect(true).toBe(false)
      } catch (err) {
        expect((err as ApiError).hint).toContain('Rate limit')
      }
    })

    it('wraps network errors as ApiError with status 0', async () => {
      mockFetch.mockRejectedValueOnce(new Error('ECONNREFUSED'))

      try {
        await client.listProjects()
        expect(true).toBe(false)
      } catch (err) {
        expect(err).toBeInstanceOf(ApiError)
        expect((err as ApiError).status).toBe(0)
        expect((err as ApiError).message).toContain('ECONNREFUSED')
      }
    })
  })

  describe('public endpoints (no auth)', () => {
    let client: BobbinryClient

    beforeEach(() => {
      client = new BobbinryClient({ apiUrl: 'http://test.api' })
    })

    it('discoverProjects calls correct URL', async () => {
      mockFetch.mockResolvedValueOnce(jsonResponse({ projects: [] }))

      await client.discoverProjects({ q: 'fantasy', sort: 'trending', limit: 5 })

      const url = (mockFetch.mock.calls[0] as any[])[0] as string
      expect(url).toContain('/discover/projects')
      expect(url).toContain('q=fantasy')
      expect(url).toContain('sort=trending')
      expect(url).toContain('limit=5')
    })

    it('resolveSlug calls by-slug endpoint', async () => {
      mockFetch.mockResolvedValueOnce(jsonResponse({ project: { id: 'p1' } }))

      await client.resolveSlug('my-book')

      const url = (mockFetch.mock.calls[0] as any[])[0] as string
      expect(url).toContain('/public/projects/by-slug/my-book')
    })

    it('resolveByAuthorAndSlug calls correct endpoint', async () => {
      mockFetch.mockResolvedValueOnce(jsonResponse({ project: { id: 'p1' } }))

      await client.resolveByAuthorAndSlug('author', 'my-book')

      const url = (mockFetch.mock.calls[0] as any[])[0] as string
      expect(url).toContain('/public/projects/by-author-and-slug/author/my-book')
    })

    it('getToc calls correct endpoint', async () => {
      mockFetch.mockResolvedValueOnce(jsonResponse({ chapters: [] }))

      await client.getToc('p1')

      const url = (mockFetch.mock.calls[0] as any[])[0] as string
      expect(url).toContain('/public/projects/p1/toc')
    })

    it('getChapter calls correct endpoint', async () => {
      mockFetch.mockResolvedValueOnce(jsonResponse({ chapter: { title: 'Ch 1' } }))

      await client.getChapter('p1', 'c1')

      const url = (mockFetch.mock.calls[0] as any[])[0] as string
      expect(url).toContain('/public/projects/p1/chapters/c1')
    })
  })

  describe('URL construction', () => {
    it('strips trailing slashes from apiUrl', async () => {
      const client = new BobbinryClient({ apiKey: 'bby_test', apiUrl: 'http://test.api/' })
      mockFetch.mockResolvedValueOnce(jsonResponse([]))

      await client.listProjects()

      const url = (mockFetch.mock.calls[0] as any[])[0] as string
      expect(url).toBe('http://test.api/api/projects')
    })
  })

  describe('stats and profile', () => {
    let client: BobbinryClient

    beforeEach(() => {
      client = new BobbinryClient({ apiKey: 'bby_test', apiUrl: 'http://test.api' })
    })

    it('getStats calls /api/dashboard/stats', async () => {
      mockFetch.mockResolvedValueOnce(jsonResponse({ stats: { projects: { total: 3 } } }))

      const result = await client.getStats()

      expect(mockFetch).toHaveBeenCalledWith(
        'http://test.api/api/dashboard/stats',
        expect.any(Object)
      )
      expect(result.stats.projects.total).toBe(3)
    })

    it('whoami calls /api/membership', async () => {
      mockFetch.mockResolvedValueOnce(jsonResponse({ tier: 'supporter', badges: ['owner'] }))

      const result = await client.whoami()

      expect(mockFetch).toHaveBeenCalledWith(
        'http://test.api/api/membership',
        expect.any(Object)
      )
      expect(result.tier).toBe('supporter')
    })
  })
})
