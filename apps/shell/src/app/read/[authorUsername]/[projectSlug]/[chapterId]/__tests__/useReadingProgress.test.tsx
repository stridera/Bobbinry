jest.mock('@bobbinry/sdk', () => ({ trackEvent: jest.fn() }))
jest.mock('@/lib/config', () => ({ config: { apiUrl: 'https://api.test' } }))

import { act, renderHook } from '@testing-library/react'
import { trackEvent } from '@bobbinry/sdk'
import { useReadingProgress } from '../useReadingProgress'

const trackEventMock = trackEvent as jest.Mock

function makeContent(offsetTop: number, scrollHeight: number) {
  const el = document.createElement('div')
  Object.defineProperty(el, 'offsetTop', { value: offsetTop })
  Object.defineProperty(el, 'scrollHeight', { value: scrollHeight })
  return { current: el }
}

function scrollTo(y: number) {
  Object.defineProperty(window, 'scrollY', { value: y, configurable: true })
  window.dispatchEvent(new Event('scroll'))
}

describe('useReadingProgress', () => {
  beforeEach(() => {
    localStorage.clear()
    trackEventMock.mockReset()
    Object.defineProperty(window, 'innerHeight', { value: 500, configurable: true })
    global.fetch = jest.fn().mockResolvedValue({ ok: true }) as unknown as typeof fetch
    Object.defineProperty(navigator, 'sendBeacon', { value: jest.fn(), configurable: true })
    jest.spyOn(window, 'requestAnimationFrame').mockImplementation(cb => { cb(0); return 0 })
  })

  afterEach(() => {
    jest.restoreAllMocks()
  })

  const args = (active = true) => ({
    contentRef: makeContent(100, 1500),
    chapterId: 'ch1',
    projectId: 'p1',
    userId: 'u1',
    apiToken: 'tok',
    active,
  })

  it('derives progress from scroll position and fires completion once', () => {
    const { result } = renderHook(() => useReadingProgress(args()))
    // scrollHeight - innerHeight = 1000px of scrollable prose starting at 100
    act(() => scrollTo(600))
    expect(result.current.progress).toBe(50)

    act(() => scrollTo(1100))
    expect(result.current.progress).toBe(100)
    act(() => scrollTo(1100))
    expect(trackEventMock).toHaveBeenCalledTimes(1)
    expect(trackEventMock).toHaveBeenCalledWith('chapter_completed', { projectId: 'p1', chapterId: 'ch1' })
  })

  it('does nothing while inactive', () => {
    const { result } = renderHook(() => useReadingProgress(args(false)))
    act(() => scrollTo(600))
    expect(result.current.progress).toBe(0)
  })

  it('round-trips a bookmark through localStorage keyed by chapter id', () => {
    const { result } = renderHook(() => useReadingProgress(args()))
    expect(result.current.isBookmarked).toBe(false)

    act(() => scrollTo(600))
    act(() => result.current.saveBookmark())
    expect(result.current.isBookmarked).toBe(true)
    expect(JSON.parse(localStorage.getItem('bobbinry-bookmark-ch1')!)).toMatchObject({ progress: 50 })

    act(() => result.current.removeBookmark())
    expect(result.current.isBookmarked).toBe(false)
    expect(localStorage.getItem('bobbinry-bookmark-ch1')).toBeNull()
  })
})
