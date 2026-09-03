import { act, render } from '@testing-library/react'
import { useReaderBobbins, __resetReaderBobbinRegistrations } from '../useReaderBobbins'

const registerMock = jest.fn()
const unregisterMock = jest.fn()

jest.mock('@/components/ExtensionProvider', () => ({
  useManifestExtensions: () => ({
    registerManifestExtensions: registerMock,
    unregisterManifestExtensions: unregisterMock,
  }),
}))

jest.mock('@/lib/api', () => ({
  apiFetch: (path: string) => (global.fetch as jest.Mock)(`http://api${path}`),
}))

const catalog = {
  bobbins: [
    { id: 'reader-tts', name: 'Read Aloud', description: '', version: '1.0.0', readerBobbinType: 'reader', manifest: { id: 'reader-tts' } },
    { id: 'kindle', name: 'Kindle', description: '', version: '1.0.0', readerBobbinType: 'automation', manifest: { id: 'kindle' } },
  ],
}

function mockFetch(routes: Record<string, unknown>, failCatalog = false) {
  global.fetch = jest.fn(async (url: string) => {
    if (url.includes('/api/public/reader-bobbins')) {
      if (failCatalog) return { ok: false, status: 500, json: async () => ({}) }
      return { ok: true, status: 200, json: async () => catalog }
    }
    for (const [needle, body] of Object.entries(routes)) {
      if (url.includes(needle)) return { ok: true, status: 200, json: async () => body }
    }
    return { ok: false, status: 404, json: async () => ({}) }
  }) as unknown as typeof fetch
}

function Harness(props: { userId?: string; apiToken?: string; sessionStatus: 'loading' | 'authenticated' | 'unauthenticated' }) {
  useReaderBobbins(props)
  return null
}

const flush = () => act(async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve() })

describe('useReaderBobbins', () => {
  beforeEach(() => {
    registerMock.mockReset()
    unregisterMock.mockReset()
    __resetReaderBobbinRegistrations()
  })

  it('registers reader-type bobbins for anonymous readers', async () => {
    mockFetch({})
    render(<Harness sessionStatus="unauthenticated" />)
    await flush()
    expect(registerMock).toHaveBeenCalledTimes(1)
    expect(registerMock).toHaveBeenCalledWith('reader-tts', { id: 'reader-tts' })
    expect(unregisterMock).not.toHaveBeenCalled()
  })

  it('does nothing while the session is loading', async () => {
    mockFetch({})
    render(<Harness sessionStatus="loading" />)
    await flush()
    expect(global.fetch).not.toHaveBeenCalled()
    expect(registerMock).not.toHaveBeenCalled()
  })

  it('skips bobbins the signed-in user disabled', async () => {
    mockFetch({ '/reader-bobbins': { bobbins: [{ bobbinId: 'reader-tts', isEnabled: false }] } })
    render(<Harness sessionStatus="authenticated" userId="u1" apiToken="t" />)
    await flush()
    expect(registerMock).not.toHaveBeenCalled()
  })

  it('unregisters a previously registered bobbin once it is disabled', async () => {
    mockFetch({})
    const { rerender } = render(<Harness sessionStatus="unauthenticated" />)
    await flush()
    expect(registerMock).toHaveBeenCalledTimes(1)

    mockFetch({ '/reader-bobbins': { bobbins: [{ bobbinId: 'reader-tts', isEnabled: false }] } })
    rerender(<Harness sessionStatus="authenticated" userId="u1" apiToken="t" />)
    await flush()
    expect(unregisterMock).toHaveBeenCalledWith('reader-tts')
    expect(registerMock).toHaveBeenCalledTimes(1)
  })

  it('does not register twice across remounts', async () => {
    mockFetch({})
    const first = render(<Harness sessionStatus="unauthenticated" />)
    await flush()
    first.unmount()
    render(<Harness sessionStatus="unauthenticated" />)
    await flush()
    expect(registerMock).toHaveBeenCalledTimes(1)
  })

  it('swallows a catalog failure', async () => {
    mockFetch({}, true)
    render(<Harness sessionStatus="unauthenticated" />)
    await flush()
    expect(registerMock).not.toHaveBeenCalled()
  })
})
