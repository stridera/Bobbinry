import { createHash, createHmac, timingSafeEqual } from 'crypto'
import { FastifyRequest } from 'fastify'

const MAX_SKEW_MS = 5 * 60 * 1000
const replayCache = new Map<string, number>()

function getSigningSecrets(): string[] {
  const current = process.env.INTERNAL_API_AUTH_TOKEN
  const previous = process.env.INTERNAL_API_AUTH_TOKEN_PREVIOUS
  return [current, previous].filter((value): value is string => Boolean(value))
}

function canonicalPathFromRequest(request: FastifyRequest): string {
  const url = new URL(request.raw.url || '/', 'http://internal.local')
  return `${url.pathname}${url.search}`
}

function serializeBody(body: unknown): string {
  if (!body || typeof body === 'undefined') return ''
  if (typeof body === 'string') return body
  return JSON.stringify(body)
}

function bodyHash(body: unknown): string {
  return createHash('sha256').update(serializeBody(body)).digest('hex')
}

function buildPayload(method: string, path: string, ts: string, hash: string): string {
  return `${method.toUpperCase()}\n${path}\n${ts}\n${hash}`
}

function signatureFor(secret: string, payload: string): string {
  return createHmac('sha256', secret).update(payload).digest('hex')
}

function safeEquals(a: string, b: string): boolean {
  const left = Buffer.from(a)
  const right = Buffer.from(b)
  if (left.length !== right.length) return false
  return timingSafeEqual(left, right)
}

function cleanupReplayCache(now: number): void {
  for (const [sig, seenAt] of replayCache.entries()) {
    if (now - seenAt > MAX_SKEW_MS) {
      replayCache.delete(sig)
    }
  }
}

export type InternalAuthFailure =
  | 'missing_secret'
  | 'missing_headers'
  | 'invalid_timestamp'
  | 'stale_timestamp'
  | 'invalid_signature'
  | 'replay_detected'

export function verifyInternalRequest(request: FastifyRequest): { ok: true } | { ok: false; reason: InternalAuthFailure } {
  const secrets = getSigningSecrets()
  if (secrets.length === 0) {
    if (process.env.NODE_ENV !== 'production') {
      return { ok: true }
    }
    return { ok: false, reason: 'missing_secret' }
  }

  const signatureHeader = request.headers['x-internal-auth-signature']
  const timestampHeader = request.headers['x-internal-auth-ts']
  const signature = Array.isArray(signatureHeader) ? signatureHeader[0] : signatureHeader
  const timestamp = Array.isArray(timestampHeader) ? timestampHeader[0] : timestampHeader
  if (!signature || !timestamp) {
    return { ok: false, reason: 'missing_headers' }
  }

  const tsValue = Number(timestamp)
  if (!Number.isFinite(tsValue)) {
    return { ok: false, reason: 'invalid_timestamp' }
  }

  const now = Date.now()
  if (Math.abs(now - tsValue) > MAX_SKEW_MS) {
    return { ok: false, reason: 'stale_timestamp' }
  }

  const path = canonicalPathFromRequest(request)
  const payload = buildPayload(request.method, path, timestamp, bodyHash(request.body))
  const isValid = secrets.some((secret) => safeEquals(signatureFor(secret, payload), signature))
  if (!isValid) {
    return { ok: false, reason: 'invalid_signature' }
  }

  cleanupReplayCache(now)
  if (replayCache.has(signature)) {
    return { ok: false, reason: 'replay_detected' }
  }
  replayCache.set(signature, now)
  return { ok: true }
}
