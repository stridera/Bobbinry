import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals'
import { BobbinryAPI, EntityAPI, MessageBus } from '../index'

// Mock global.fetch
const mockFetch = jest.fn() as jest.MockedFunction<typeof fetch>

beforeEach(() => {
  global.fetch = mockFetch
  mockFetch.mockReset()
})

afterEach(() => {
  mockFetch.mockRestore()
})

function jsonResponse(data: any, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: status === 200 ? 'OK' : 'Error',
    json: () => Promise.resolve(data),
    text: () => Promise.resolve(JSON.stringify(data)),
  } as Response
}

describe('BobbinryAPI', () => {
  let api: BobbinryAPI

  beforeEach(() => {
    api = new BobbinryAPI('http://test.api/api')
  })

  it('constructs URLs correctly', () => {
    expect(api.apiBaseUrl).toBe('http://test.api/api')
  })

  it('includes auth header after setAuthToken', () => {
    api.setAuthToken('my-jwt')
    const headers = api.getAuthHeaders()
    expect(headers['Authorization']).toBe('Bearer my-jwt')
  })

  it('omits auth header when no token set', () => {
    const headers = api.getAuthHeaders()
    expect(headers['Authorization']).toBeUndefined()
  })

  it('merges extra headers', () => {
    api.setAuthToken('tok')
    const headers = api.getAuthHeaders({ 'Content-Type': 'application/json' })
    expect(headers['Content-Type']).toBe('application/json')
    expect(headers['Authorization']).toBe('Bearer tok')
  })

  it('getProject fetches and returns JSON', async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse({ id: 'p1', name: 'My Project' }))

    const result = await api.getProject('p1')

    expect(mockFetch).toHaveBeenCalledWith(
      'http://test.api/api/projects/p1',
      expect.objectContaining({ headers: expect.any(Object) })
    )
    expect(result.name).toBe('My Project')
  })

  it('getProject throws on non-ok response', async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse({}, 500))

    await expect(api.getProject('bad')).rejects.toThrow('Failed to fetch project')
  })

  it('installBobbin sends POST with correct body', async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse({ success: true }))

    await api.installBobbin('p1', 'name: Test', 'yaml')

    expect(mockFetch).toHaveBeenCalledWith(
      'http://test.api/api/projects/p1/bobbins/install',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ manifestContent: 'name: Test', manifestType: 'yaml' })
      })
    )
  })
})

describe('EntityAPI', () => {
  let api: BobbinryAPI
  let entities: EntityAPI

  beforeEach(() => {
    api = new BobbinryAPI('http://test.api/api')
    api.setAuthToken('tok')
    entities = new EntityAPI(api, 'proj-1')
  })

  it('query builds URL with params', async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse({ entities: [{ id: '1' }], total: 1 }))

    const result = await entities.query({ collection: 'books', limit: 10, offset: 0, search: 'foo' })

    const calledUrl = (mockFetch.mock.calls[0] as any[])[0] as string
    expect(calledUrl).toContain('/collections/books/entities')
    expect(calledUrl).toContain('projectId=proj-1')
    expect(calledUrl).toContain('limit=10')
    expect(calledUrl).toContain('search=foo')
    expect(result.data).toEqual([{ id: '1' }])
    expect(result.total).toBe(1)
  })

  it('get returns entity on success', async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse({ id: 'e1', title: 'Hello' }))

    const result = await entities.get('books', 'e1')
    expect(result).toEqual({ id: 'e1', title: 'Hello' })

    const calledUrl = (mockFetch.mock.calls[0] as any[])[0] as string
    expect(calledUrl).toContain('/entities/e1')
    expect(calledUrl).toContain('collection=books')
  })

  it('get returns null on 404', async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse({}, 404))

    const result = await entities.get('books', 'missing')
    expect(result).toBeNull()
  })

  it('get throws on other errors', async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse({}, 500))

    await expect(entities.get('books', 'e1')).rejects.toThrow('Failed to get entity')
  })

  it('create sends POST with data', async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse({ id: 'new', title: 'New' }))

    const result = await entities.create('books', { title: 'New' })

    expect(result).toEqual({ id: 'new', title: 'New' })
    expect(mockFetch).toHaveBeenCalledWith(
      'http://test.api/api/entities',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ collection: 'books', projectId: 'proj-1', data: { title: 'New' } })
      })
    )
  })

  it('update sends PUT', async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse({ id: 'e1', title: 'Updated' }))

    const result = await entities.update('books', 'e1', { title: 'Updated' })

    expect(result.title).toBe('Updated')
    const [url, opts] = mockFetch.mock.calls[0] as any[]
    expect(url).toBe('http://test.api/api/entities/e1')
    expect(opts.method).toBe('PUT')
  })

  it('delete sends DELETE', async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse(null))

    await entities.delete('books', 'e1')

    const [url, opts] = mockFetch.mock.calls[0] as any[]
    expect(url).toContain('/entities/e1')
    expect(opts.method).toBe('DELETE')
  })
})

describe('MessageBus', () => {
  it('dispatches messages to listeners by type', () => {
    const bus = new MessageBus('test-component')
    const handler = jest.fn()

    bus.on('HELLO', handler)

    // Simulate a window message (origin must match window.location.origin)
    window.dispatchEvent(new MessageEvent('message', {
      origin: window.location.origin,
      data: { type: 'HELLO', source: 'other', target: 'test-component', data: { greeting: 'hi' } }
    }))

    expect(handler).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'HELLO', data: { greeting: 'hi' } })
    )
  })

  it('ignores messages for other targets', () => {
    const bus = new MessageBus('my-view')
    const handler = jest.fn()

    bus.on('UPDATE', handler)

    window.dispatchEvent(new MessageEvent('message', {
      origin: window.location.origin,
      data: { type: 'UPDATE', source: 'shell', target: 'other-view', data: {} }
    }))

    expect(handler).not.toHaveBeenCalled()
  })

  it('handles broadcast messages (target: *)', () => {
    const bus = new MessageBus('any-view')
    const handler = jest.fn()

    bus.on('BROADCAST', handler)

    window.dispatchEvent(new MessageEvent('message', {
      origin: window.location.origin,
      data: { type: 'BROADCAST', source: 'shell', target: '*', data: { msg: 'all' } }
    }))

    expect(handler).toHaveBeenCalled()
  })

  it('off removes a listener', () => {
    const bus = new MessageBus('test')
    const handler = jest.fn()

    bus.on('EVT', handler)
    bus.off('EVT', handler)

    window.dispatchEvent(new MessageEvent('message', {
      origin: window.location.origin,
      data: { type: 'EVT', source: 's', target: 'test', data: {} }
    }))

    expect(handler).not.toHaveBeenCalled()
  })

  it('send posts message to window', () => {
    const postSpy = jest.spyOn(window, 'postMessage')
    const bus = new MessageBus('sender')

    bus.send('receiver', 'PING', { val: 1 })

    expect(postSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'PING',
        source: 'sender',
        target: 'receiver',
        data: { val: 1 }
      }),
      window.location.origin
    )

    postSpy.mockRestore()
  })
})
