import { describe, it, expect } from '@jest/globals'
import { CliError, ApiError, AuthError, ConfigError, formatError } from '../lib/errors.js'

describe('error classes', () => {
  it('CliError has code and hint', () => {
    const err = new CliError('bad thing', 'BAD', 'try this instead')
    expect(err.message).toBe('bad thing')
    expect(err.code).toBe('BAD')
    expect(err.hint).toBe('try this instead')
    expect(err.name).toBe('CliError')
  })

  it('ApiError has status and detail', () => {
    const err = new ApiError(404, 'Not Found', 'Resource does not exist', 'Check the ID')
    expect(err.status).toBe(404)
    expect(err.message).toBe('Not Found')
    expect(err.detail).toBe('Resource does not exist')
    expect(err.hint).toBe('Check the ID')
    expect(err.code).toBe('HTTP_404')
    expect(err.name).toBe('ApiError')
  })

  it('AuthError has default hint', () => {
    const err = new AuthError('No API key')
    expect(err.hint).toContain('bobbinry.com/settings/api-keys')
    expect(err.code).toBe('AUTH_ERROR')
    expect(err.name).toBe('AuthError')
  })

  it('AuthError allows custom hint', () => {
    const err = new AuthError('Expired key', 'Regenerate your key')
    expect(err.hint).toBe('Regenerate your key')
  })

  it('ConfigError has correct code', () => {
    const err = new ConfigError('Invalid config')
    expect(err.code).toBe('CONFIG_ERROR')
    expect(err.name).toBe('ConfigError')
  })
})

describe('formatError', () => {
  describe('JSON mode', () => {
    it('formats CliError as JSON', () => {
      const err = new CliError('fail', 'FAIL_CODE', 'do this')
      const result = JSON.parse(formatError(err, true))
      expect(result).toEqual({
        error: true,
        code: 'FAIL_CODE',
        message: 'fail',
        hint: 'do this',
      })
    })

    it('formats ApiError with status and detail', () => {
      const err = new ApiError(403, 'Forbidden', 'Insufficient scope', 'Add scope')
      const result = JSON.parse(formatError(err, true))
      expect(result).toEqual({
        error: true,
        code: 'HTTP_403',
        message: 'Forbidden',
        status: 403,
        detail: 'Insufficient scope',
        hint: 'Add scope',
      })
    })

    it('formats plain Error', () => {
      const result = JSON.parse(formatError(new Error('oops'), true))
      expect(result).toEqual({
        error: true,
        code: 'UNKNOWN',
        message: 'oops',
      })
    })

    it('formats non-Error values', () => {
      const result = JSON.parse(formatError('string error', true))
      expect(result).toEqual({
        error: true,
        code: 'UNKNOWN',
        message: 'string error',
      })
    })
  })

  describe('pretty mode', () => {
    it('formats CliError with hint', () => {
      const err = new CliError('bad', 'BAD', 'try this')
      const result = formatError(err, false)
      expect(result).toContain('Error: bad')
      expect(result).toContain('Hint: try this')
    })

    it('formats ApiError with detail', () => {
      const err = new ApiError(500, 'Server Error', 'Something broke')
      const result = formatError(err, false)
      expect(result).toContain('Error: Server Error')
      expect(result).toContain('Something broke')
    })

    it('formats plain Error', () => {
      const result = formatError(new Error('boom'), false)
      expect(result).toBe('Error: boom')
    })
  })
})
