import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from '@jest/globals'
import { createHash, createHmac } from 'crypto'
import { build } from '../../server'
import { db } from '../../db/connection'
import { users } from '../../db/schema'
import { sql } from 'drizzle-orm'

function internalHeaders(
  method: string,
  pathWithQuery: string,
  body: unknown = undefined
): Record<string, string> {
  const secret = process.env.INTERNAL_API_AUTH_TOKEN!
  const ts = Date.now().toString()
  const serialized = body ? JSON.stringify(body) : ''
  const digest = createHash('sha256').update(serialized).digest('hex')
  const payload = `${method.toUpperCase()}\n${pathWithQuery}\n${ts}\n${digest}`
  const signature = createHmac('sha256', secret).update(payload).digest('hex')
  return {
    'x-internal-auth-ts': ts,
    'x-internal-auth-signature': signature
  }
}

describe('Internal Auth Routes', () => {
  let app: any

  beforeAll(async () => {
    process.env.INTERNAL_API_AUTH_TOKEN = 'test-internal-secret'
    app = build({ logger: false })
    await app.ready()
  })

  afterAll(async () => {
    await app.close()
  })

  beforeEach(async () => {
    await db.insert(users).values({ email: 'internal-auth@example.com', name: 'Internal Auth' })
  })

  afterEach(async () => {
    await db.delete(users).where(sql`true`)
  })

  it('rejects user lookup without internal auth headers', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/users/by-email?email=internal-auth@example.com'
    })

    expect(response.statusCode).toBe(403)
  })

  it('allows user lookup with valid signed internal auth headers', async () => {
    const path = '/api/users/by-email?email=internal-auth@example.com'
    const response = await app.inject({
      method: 'GET',
      url: path,
      headers: internalHeaders('GET', path)
    })

    expect(response.statusCode).toBe(200)
    const payload = JSON.parse(response.payload)
    expect(payload.email).toBe('internal-auth@example.com')
  })
})

