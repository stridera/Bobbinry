/**
 * The API's one logger. Fastify logs requests through this same pino
 * instance, so job, library and request lines share a format, a level and a
 * destination. Everything outside request handlers logs through
 * `moduleLogger('<name>')`; `console.*` is reserved for CLI scripts
 * (seeds, backfills) and is rejected elsewhere by scripts/check-api-boundaries.sh.
 *
 * Reads process.env directly on purpose: env.ts logs through this module, so
 * this module cannot depend on env.ts.
 */
import pino, { type Logger } from 'pino'

const nodeEnv = process.env.NODE_ENV || 'development'

export const logger: Logger = pino({
  level: nodeEnv === 'test' ? 'silent' : (process.env.LOG_LEVEL || 'info'),
  serializers: {
    req: (req) => ({
      method: req.method,
      url: req.url,
      hostname: req.hostname,
      remoteAddress: req.ip,
      headers: {
        'user-agent': req.headers['user-agent'],
        'x-correlation-id': req.headers['x-correlation-id'],
        'content-type': req.headers['content-type'],
      },
    }),
    res: (res) => ({
      statusCode: res.statusCode,
    }),
    err: (err) => ({
      type: err.constructor.name,
      message: err.message,
      stack: nodeEnv === 'development' ? (err.stack || '') : '',
      code: err.code,
      statusCode: err.statusCode,
    }),
  },
})

/** A child logger tagged with the job / library module it speaks for. */
export function moduleLogger(module: string): Logger {
  return logger.child({ module })
}
