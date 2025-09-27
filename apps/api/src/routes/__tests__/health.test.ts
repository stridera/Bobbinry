import { describe, it, expect, beforeAll, afterAll } from '@jest/globals'
import { build } from '../../server'

describe('Health API', () => {
  let app: any

  beforeAll(async () => {
    app = build({ logger: false })
    await app.ready()
  })

  afterAll(async () => {
    await app.close()
  })

  describe('GET /health', () => {
    it('should return health status', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/health'
      })

      expect(response.statusCode).toBe(200)
      const result = JSON.parse(response.payload)
      expect(result.status).toBe('ok')
      expect(result.timestamp).toBeDefined()
    })
  })
})