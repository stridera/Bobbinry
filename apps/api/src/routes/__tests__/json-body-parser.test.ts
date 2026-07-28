import { describe, it, expect, beforeAll, afterAll } from '@jest/globals'
import { build } from '../../server'

/**
 * server.ts replaces Fastify's built-in application/json parser, so it also owns the
 * built-in's error semantics. Getting those wrong turned ordinary client requests into
 * 500s across every route — see docs/BUG_annotation_delete_500.md.
 */
describe('application/json body parser', () => {
  let app: any

  beforeAll(async () => {
    app = build({ logger: false })
    await app.ready()
  })

  afterAll(async () => {
    await app.close()
  })

  it('does not 500 when Content-Type is application/json but the body is empty', async () => {
    const response = await app.inject({
      method: 'DELETE',
      url: '/api/public/chapters/00000000-0000-0000-0000-000000000000/annotations/00000000-0000-0000-0000-000000000001',
      headers: { 'content-type': 'application/json' },
    })

    // Reaches the route, which rejects it for lack of auth rather than blowing up
    // in the parser.
    expect(response.statusCode).not.toBe(500)
    expect(response.statusCode).toBe(401)
  })

  it('treats malformed JSON as a 400, not a server error', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      headers: { 'content-type': 'application/json' },
      payload: '{"email": "nope"',
    })

    expect(response.statusCode).toBe(400)
    expect(response.statusCode).not.toBe(500)
  })

  it('still parses well-formed JSON bodies', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      headers: { 'content-type': 'application/json' },
      payload: { email: 'nobody@example.com', password: 'wrong-password' },
    })

    // Parsed fine — rejected on credentials, not on parsing.
    expect(response.statusCode).not.toBe(500)
    expect([400, 401, 404]).toContain(response.statusCode)
  })
})
