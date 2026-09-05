import { readerThemeClasses } from '../reader-theme'

describe('readerThemeClasses', () => {
  it('flags light as neither dark nor sepia', () => {
    const t = readerThemeClasses('light')
    expect(t.isDark).toBe(false)
    expect(t.isSepia).toBe(false)
    expect(t.wrapper).toBe('bg-white text-gray-900')
    expect(t.proseClass).toBe('prose-gray')
  })

  it('maps dark to inverted prose and gray borders', () => {
    const t = readerThemeClasses('dark')
    expect(t.isDark).toBe(true)
    expect(t.proseClass).toBe('prose-invert')
    expect(t.borderColor).toBe('border-gray-800')
    expect(t.navTheme.border).toBe(t.borderColor)
    expect(t.navTheme.muted).toBe(t.mutedText)
  })

  it('maps sepia to amber tones', () => {
    const t = readerThemeClasses('sepia')
    expect(t.isSepia).toBe(true)
    expect(t.wrapper).toContain('bg-amber-50')
    expect(t.mutedText).toBe('text-amber-700')
    expect(t.proseClass).toBe('prose-amber')
  })
})
