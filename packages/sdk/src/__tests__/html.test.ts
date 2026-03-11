import { getSanitizedHtmlProps, sanitizeHtml } from '../html'

describe('sanitizeHtml', () => {
  it('removes script tags and inline event handlers', () => {
    const result = sanitizeHtml('<p onclick="alert(1)">Hello<script>alert(2)</script></p>')

    expect(result).toBe('<p>Hello</p>')
  })

  it('strips javascript urls while preserving safe links', () => {
    const result = sanitizeHtml('<a href="javascript:alert(1)">Bad</a><a href="https://example.com">Good</a>')

    expect(result).toContain('<a>Bad</a>')
    expect(result).toContain('href="https://example.com"')
  })

  it('returns sanitized html props for React rendering', () => {
    expect(getSanitizedHtmlProps('<strong>Safe</strong>')).toEqual({
      __html: '<strong>Safe</strong>',
    })
  })
})
