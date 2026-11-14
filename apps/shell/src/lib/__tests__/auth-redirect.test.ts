import { safeCallbackPath, loginHref } from '../auth-redirect'

describe('safeCallbackPath', () => {
  it('accepts same-origin relative paths with query and hash', () => {
    expect(safeCallbackPath('/read/alice/book')).toBe('/read/alice/book')
    expect(safeCallbackPath('/read/alice/book?viewAs=beta#support')).toBe('/read/alice/book?viewAs=beta#support')
  })

  it('rejects missing, absolute, protocol-relative and backslash targets', () => {
    expect(safeCallbackPath(null)).toBeNull()
    expect(safeCallbackPath(undefined)).toBeNull()
    expect(safeCallbackPath('')).toBeNull()
    expect(safeCallbackPath('dashboard')).toBeNull()
    expect(safeCallbackPath('https://evil.example/x')).toBeNull()
    expect(safeCallbackPath('//evil.example/x')).toBeNull()
    expect(safeCallbackPath('/\\evil.example/x')).toBeNull()
    expect(safeCallbackPath('/ok\r\nSet-Cookie: a=b')).toBeNull()
  })
})

describe('loginHref', () => {
  it('encodes the return path', () => {
    expect(loginHref('/read/a/b?x=1')).toBe('/login?callbackUrl=%2Fread%2Fa%2Fb%3Fx%3D1')
  })

  it('falls back to plain /login for unsafe or empty paths', () => {
    expect(loginHref(null)).toBe('/login')
    expect(loginHref('//evil.example')).toBe('/login')
  })
})
