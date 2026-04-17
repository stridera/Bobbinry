export class CliError extends Error {
  code: string
  hint?: string

  constructor(message: string, code: string, hint?: string) {
    super(message)
    this.name = 'CliError'
    this.code = code
    this.hint = hint
  }
}

export class ApiError extends CliError {
  status: number
  detail?: string

  constructor(status: number, message: string, detail?: string, hint?: string) {
    super(message, `HTTP_${status}`, hint)
    this.name = 'ApiError'
    this.status = status
    this.detail = detail
  }
}

export class ConfigError extends CliError {
  constructor(message: string, hint?: string) {
    super(message, 'CONFIG_ERROR', hint)
    this.name = 'ConfigError'
  }
}

export class AuthError extends CliError {
  constructor(message: string, hint?: string) {
    super(
      message,
      'AUTH_ERROR',
      hint || 'Create an API key at https://bobbinry.com/settings/api-keys and run: bobbinry config set api-key bby_...'
    )
    this.name = 'AuthError'
  }
}

export function formatError(err: unknown, json: boolean): string {
  if (err instanceof CliError) {
    if (json) {
      return JSON.stringify({
        error: true,
        code: err.code,
        message: err.message,
        ...(err instanceof ApiError && { status: err.status, detail: err.detail }),
        ...(err.hint && { hint: err.hint }),
      })
    }
    let msg = `Error: ${err.message}`
    if (err instanceof ApiError && err.detail) {
      msg += `\n  ${err.detail}`
    }
    if (err.hint) {
      msg += `\n  Hint: ${err.hint}`
    }
    return msg
  }

  if (err instanceof Error) {
    if (json) {
      return JSON.stringify({ error: true, code: 'UNKNOWN', message: err.message })
    }
    return `Error: ${err.message}`
  }

  if (json) {
    return JSON.stringify({ error: true, code: 'UNKNOWN', message: String(err) })
  }
  return `Error: ${String(err)}`
}

export function handleError(err: unknown, json: boolean): never {
  process.stderr.write(formatError(err, json) + '\n')
  return process.exit(1) as never
}
