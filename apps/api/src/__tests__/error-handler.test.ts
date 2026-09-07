import { describe, it, expect, beforeAll, afterAll } from '@jest/globals'
import { z } from 'zod'
import { build } from '../server'
import { NotFoundError } from '../lib/errors'

/**
 * The global error handler is the contract that lets routes `throw` instead
 * of hand-rolling try/catch: Zod failures are 400s with the issues, ApiErrors
 * keep their status and code, and anything else is a masked 500 carrying the
 * correlation id.
 */
describe('global error handler', () => {
  let app: ReturnType<typeof build>
  beforeAll(async () => {
    app = build({ logger: false })
    app.post('/__test/zod', async (request) => z.object({ name: z.string() }).strict().parse(request.body))
    app.get('/__test/api-error', async () => { throw new NotFoundError('Widget', 'w1') })
    app.get('/__test/boom', async () => { throw new Error('kaboom: secret detail') })
    await app.ready()
  })
  afterAll(async () => { await app.close() })

  it('turns a thrown ZodError into a 400 with the issues', async () => {
    const res = await app.inject({ method: 'POST', url: '/__test/zod', payload: { name: 1, extra: true } })
    expect(res.statusCode).toBe(400)
    const body = JSON.parse(res.payload)
    expect(body.error).toBe('Invalid request')
    expect(body.issues.map((i: { path: string[] }) => i.path.join('.'))).toEqual(expect.arrayContaining(['name']))
    expect(body.correlationId).toBeTruthy()
  })

  it('keeps an ApiError status and code', async () => {
    const res = await app.inject({ method: 'GET', url: '/__test/api-error' })
    expect(res.statusCode).toBe(404)
    expect(JSON.parse(res.payload)).toMatchObject({ error: 'Widget with id w1 not found', code: 'NOT_FOUND' })
  })

  it('masks unexpected errors as a 500 with a correlation id', async () => {
    const res = await app.inject({ method: 'GET', url: '/__test/boom' })
    expect(res.statusCode).toBe(500)
    const body = JSON.parse(res.payload)
    expect(body.correlationId).toBeTruthy()
    if (process.env.NODE_ENV !== 'development') expect(body.error).toBe('Internal Server Error')
  })
})
