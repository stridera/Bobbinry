import { act, renderHook } from '@testing-library/react'
import { readStoredPrefs, useReaderPrefs } from '../useReaderPrefs'
import { READER_PREFS_KEY } from '../types'

describe('useReaderPrefs', () => {
  beforeEach(() => {
    localStorage.clear()
    document.documentElement.classList.remove('dark')
    window.matchMedia = jest.fn().mockReturnValue({ matches: false }) as unknown as typeof window.matchMedia
  })

  it('reads saved prefs synchronously on first render', () => {
    localStorage.setItem(READER_PREFS_KEY, JSON.stringify({
      fontSize: 'large', readerTheme: 'sepia', readerWidth: 'wide',
      entityHighlightStyle: 'underline', entityInfoDisplay: 'popup', entityPeekOnHover: 'off',
    }))
    const { result } = renderHook(() => useReaderPrefs())
    expect(result.current.prefs).toEqual({
      fontSize: 'large', readerTheme: 'sepia', readerWidth: 'wide',
      entityHighlightStyle: 'underline', entityInfoDisplay: 'popup', entityPeekOnHover: false,
    })
  })

  it('falls back to document dark mode when no theme is saved', () => {
    document.documentElement.classList.add('dark')
    expect(readStoredPrefs().readerTheme).toBe('dark')
  })

  it('ignores garbage values and malformed JSON', () => {
    localStorage.setItem(READER_PREFS_KEY, JSON.stringify({ fontSize: 'huge', readerWidth: 'giant', readerTheme: 'neon' }))
    expect(readStoredPrefs()).toMatchObject({ fontSize: 'medium', readerWidth: 'standard', readerTheme: 'light' })

    localStorage.setItem(READER_PREFS_KEY, '{not json')
    expect(readStoredPrefs().fontSize).toBe('medium')
  })

  it('persists a change in the stored string shape and keeps other keys', () => {
    localStorage.setItem(READER_PREFS_KEY, JSON.stringify({ readerTheme: 'dark', unrelated: 'kept' }))
    const { result } = renderHook(() => useReaderPrefs())

    act(() => result.current.setPref('fontSize', 'xlarge'))
    act(() => result.current.setPref('entityPeekOnHover', false))

    expect(result.current.prefs.fontSize).toBe('xlarge')
    expect(result.current.prefs.entityPeekOnHover).toBe(false)
    expect(JSON.parse(localStorage.getItem(READER_PREFS_KEY)!)).toEqual({
      readerTheme: 'dark', unrelated: 'kept', fontSize: 'xlarge', entityPeekOnHover: 'off',
    })
  })
})
