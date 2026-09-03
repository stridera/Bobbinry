import { describe, it, expect, beforeAll, afterAll } from '@jest/globals'
import { build } from '../../server'
import { createTestUser, createTestToken, cleanupAllTestData } from '../../__tests__/test-helpers'

describe('Reader bobbins', () => {
  let app: any

  beforeAll(async () => {
    app = build({ logger: false })
    await app.ready()
  })

  afterAll(async () => {
    await cleanupAllTestData()
    await app.close()
  })

  describe('GET /api/public/reader-bobbins', () => {
    it('lists reader-side bobbins from disk manifests without auth', async () => {
      const response = await app.inject({ method: 'GET', url: '/api/public/reader-bobbins' })
      expect(response.statusCode).toBe(200)
      expect(response.headers['cache-control']).toContain('max-age')

      const { bobbins } = JSON.parse(response.payload)
      const ids = bobbins.map((b: any) => b.id)
      expect(ids).toContain('reader-tts')
      expect(ids).not.toContain('manuscript')

      const tts = bobbins.find((b: any) => b.id === 'reader-tts')
      expect(tts.readerBobbinType).toBe('reader')
      expect(tts.name).toBe('Read Aloud')
      const contributions = tts.manifest.extensions.contributions
      expect(contributions).toEqual(
        expect.arrayContaining([expect.objectContaining({ slot: 'reader.toolbar', type: 'panel', entry: 'panels/listen' })])
      )
      // Only the subtree the shell registers is exposed.
      expect(Object.keys(tts.manifest).sort()).toEqual(['extensions', 'id', 'name', 'version'])
    })
  })

  describe('POST /api/users/:userId/reader-bobbins', () => {
    it('records an opt-out row when isEnabled is false', async () => {
      const user = await createTestUser({ email: `reader-tts-${Date.now()}@test.local` })
      const token = await createTestToken(user.id)

      const response = await app.inject({
        method: 'POST',
        url: `/api/users/${user.id}/reader-bobbins`,
        headers: { authorization: `Bearer ${token}` },
        payload: { bobbinId: 'reader-tts', bobbinType: 'reader_enhancement', isEnabled: false },
      })
      expect(response.statusCode).toBe(201)
      const { bobbin } = JSON.parse(response.payload)
      expect(bobbin.bobbinId).toBe('reader-tts')
      expect(bobbin.isEnabled).toBe(false)

      const list = await app.inject({
        method: 'GET',
        url: `/api/users/${user.id}/reader-bobbins`,
        headers: { authorization: `Bearer ${token}` },
      })
      expect(list.statusCode).toBe(200)
      const rows = JSON.parse(list.payload).bobbins
      expect(rows.find((r: any) => r.bobbinId === 'reader-tts')?.isEnabled).toBe(false)
    })

    it('still defaults isEnabled to true', async () => {
      const user = await createTestUser({ email: `reader-tts-default-${Date.now()}@test.local` })
      const token = await createTestToken(user.id)
      const response = await app.inject({
        method: 'POST',
        url: `/api/users/${user.id}/reader-bobbins`,
        headers: { authorization: `Bearer ${token}` },
        payload: { bobbinId: 'reader-tts', bobbinType: 'reader_enhancement' },
      })
      expect(response.statusCode).toBe(201)
      expect(JSON.parse(response.payload).bobbin.isEnabled).toBe(true)
    })
  })
})
