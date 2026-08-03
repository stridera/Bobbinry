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

describe('sanitizeHtml without DOMParser', () => {
  // Node has never shipped DOMParser, so this is the path taken by SSR, Server
  // Components, route handlers, Workers and edge runtimes. The suite runs under
  // jsdom, which provides DOMParser, so it has to be removed to reach it.
  const realDOMParser = globalThis.DOMParser

  beforeEach(() => {
    // @ts-expect-error -- deliberately simulating a DOM-less runtime
    delete globalThis.DOMParser
  })

  afterEach(() => {
    globalThis.DOMParser = realDOMParser
  })

  it('takes the fallback path', () => {
    expect(typeof DOMParser).toBe('undefined')
    // Formatting is dropped rather than preserved — the fallback is plain text.
    expect(sanitizeHtml('<p>Hello</p>')).toBe('Hello')
  })

  it('neutralizes an unquoted event handler', () => {
    // The old regex required quotes around the value, so this leaked verbatim.
    const result = sanitizeHtml('<img src=x onerror=alert(1)>')

    expect(result).not.toContain('<img')
    expect(result).not.toContain('onerror=')
  })

  it('neutralizes an unclosed script tag', () => {
    // The old regex needed a closing </script> to match, so this leaked too.
    const result = sanitizeHtml('<script>alert(1)')

    expect(result).not.toContain('<script')
    expect(result).toBe('alert(1)')
  })

  it('neutralizes a nested-tag filter bypass', () => {
    const result = sanitizeHtml('<scr<script>ipt>alert(1)</script>')

    expect(result).not.toContain('<script')
  })

  it('leaves no unescaped angle brackets for any payload', () => {
    const payloads = [
      '<img src=x onerror=alert(1)>',
      '<script>alert(1)',
      '<scr<script>ipt>alert(1)</script>',
      '<svg/onload=alert(1)>',
      '<a href=javascript:alert(1)>x</a>',
      '<iframe src="javascript:alert(1)">',
      '<div style="background:url(javascript:alert(1))">x</div>',
      '<body onload=alert(1)>',
    ]

    for (const payload of payloads) {
      const result = sanitizeHtml(payload)
      // Nothing the browser could parse as a tag survives, so no markup from
      // the payload can execute when injected via dangerouslySetInnerHTML.
      expect(result).not.toMatch(/<[a-z/!]/i)
    }
  })
})
