import { describe, it, expect, afterEach } from '@jest/globals'
import { env } from '../lib/env'

/**
 * `env` reads process.env on every access. Tests (and the boot sequence)
 * rely on being able to set a variable after the module graph is loaded.
 */
describe('env', () => {
  const original = process.env.WEB_ORIGIN
  afterEach(() => {
    if (original === undefined) delete process.env.WEB_ORIGIN
    else process.env.WEB_ORIGIN = original
  })

  it('reflects a variable set after import, and falls back to the default when unset', () => {
    process.env.WEB_ORIGIN = 'https://live.example'
    expect(env.WEB_ORIGIN).toBe('https://live.example')
    delete process.env.WEB_ORIGIN
    expect(env.WEB_ORIGIN).toBe('http://localhost:3100')
  })

  it('exposes every key as an enumerable property', () => {
    expect(Object.keys(env)).toEqual(expect.arrayContaining(['DATABASE_URL', 'NODE_ENV', 'WEB_ORIGIN', 'NEXTAUTH_SECRET']))
  })
})
