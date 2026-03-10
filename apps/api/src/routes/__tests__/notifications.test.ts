import { describe, it, expect, beforeAll, afterAll, afterEach } from '@jest/globals'
import { db } from '../../db/connection'
import { notifications } from '../../db/schema'
import {
  createTestApp,
  createTestToken,
  createTestUser,
  cleanupAllTestData
} from '../../__tests__/test-helpers'

describe('Notifications API', () => {
  let app: any

  beforeAll(async () => {
    app = await createTestApp()
  })

  afterAll(async () => {
    await app.close()
  })

  afterEach(async () => {
    await cleanupAllTestData()
  })

  async function insertNotification(recipientId: string, overrides: Partial<{
    actorId: string | null
    type: string
    title: string
    body: string
    isRead: boolean
    createdAt: Date
  }> = {}) {
    const [n] = await db.insert(notifications).values({
      recipientId,
      actorId: overrides.actorId ?? null,
      type: overrides.type ?? 'new_chapter',
      title: overrides.title ?? 'Test notification',
      body: overrides.body ?? 'Test body',
      isRead: overrides.isRead ?? false,
      createdAt: overrides.createdAt ?? new Date(),
    }).returning()
    return n!
  }

  // ──────────────────────────────────────────
  // LIST
  // ──────────────────────────────────────────

  describe('GET /api/notifications', () => {
    it('returns paginated notifications ordered by createdAt DESC', async () => {
      const user = await createTestUser()
      const token = await createTestToken(user.id)

      const older = await insertNotification(user.id, {
        title: 'Older',
        createdAt: new Date('2025-01-01')
      })
      const newer = await insertNotification(user.id, {
        title: 'Newer',
        createdAt: new Date('2025-06-01')
      })

      const res = await app.inject({
        method: 'GET',
        url: '/api/notifications',
        headers: { authorization: `Bearer ${token}` }
      })

      expect(res.statusCode).toBe(200)
      const body = JSON.parse(res.payload)
      expect(body.notifications.length).toBe(2)
      expect(body.notifications[0].title).toBe('Newer')
      expect(body.notifications[1].title).toBe('Older')
    })

    it('respects limit and offset', async () => {
      const user = await createTestUser()
      const token = await createTestToken(user.id)

      for (let i = 0; i < 5; i++) {
        await insertNotification(user.id, {
          title: `Notif ${i}`,
          createdAt: new Date(Date.now() + i * 1000)
        })
      }

      const res = await app.inject({
        method: 'GET',
        url: '/api/notifications?limit=2&offset=1',
        headers: { authorization: `Bearer ${token}` }
      })

      expect(res.statusCode).toBe(200)
      const body = JSON.parse(res.payload)
      expect(body.notifications.length).toBe(2)
    })
  })

  // ──────────────────────────────────────────
  // UNREAD COUNT
  // ──────────────────────────────────────────

  describe('GET /api/notifications/unread-count', () => {
    it('returns correct unread count', async () => {
      const user = await createTestUser()
      const token = await createTestToken(user.id)

      await insertNotification(user.id, { isRead: false })
      await insertNotification(user.id, { isRead: false })
      await insertNotification(user.id, { isRead: true })

      const res = await app.inject({
        method: 'GET',
        url: '/api/notifications/unread-count',
        headers: { authorization: `Bearer ${token}` }
      })

      expect(res.statusCode).toBe(200)
      expect(JSON.parse(res.payload).count).toBe(2)
    })
  })

  // ──────────────────────────────────────────
  // MARK AS READ
  // ──────────────────────────────────────────

  describe('PUT /api/notifications/:id/read', () => {
    it('marks a single notification as read', async () => {
      const user = await createTestUser()
      const token = await createTestToken(user.id)
      const notif = await insertNotification(user.id)

      const res = await app.inject({
        method: 'PUT',
        url: `/api/notifications/${notif.id}/read`,
        headers: { authorization: `Bearer ${token}` }
      })

      expect(res.statusCode).toBe(200)
      expect(JSON.parse(res.payload).success).toBe(true)

      // Verify unread count is now 0
      const countRes = await app.inject({
        method: 'GET',
        url: '/api/notifications/unread-count',
        headers: { authorization: `Bearer ${token}` }
      })
      expect(JSON.parse(countRes.payload).count).toBe(0)
    })

    it('returns 404 for nonexistent notification', async () => {
      const user = await createTestUser()
      const token = await createTestToken(user.id)

      const res = await app.inject({
        method: 'PUT',
        url: '/api/notifications/00000000-0000-0000-0000-000000000000/read',
        headers: { authorization: `Bearer ${token}` }
      })

      expect(res.statusCode).toBe(404)
    })

    it('returns 400 for invalid UUID', async () => {
      const user = await createTestUser()
      const token = await createTestToken(user.id)

      const res = await app.inject({
        method: 'PUT',
        url: '/api/notifications/not-a-uuid/read',
        headers: { authorization: `Bearer ${token}` }
      })

      expect(res.statusCode).toBe(400)
    })
  })

  // ──────────────────────────────────────────
  // MARK ALL AS READ
  // ──────────────────────────────────────────

  describe('PUT /api/notifications/read-all', () => {
    it('marks all notifications as read', async () => {
      const user = await createTestUser()
      const token = await createTestToken(user.id)

      await insertNotification(user.id)
      await insertNotification(user.id)
      await insertNotification(user.id)

      const res = await app.inject({
        method: 'PUT',
        url: '/api/notifications/read-all',
        headers: { authorization: `Bearer ${token}` }
      })

      expect(res.statusCode).toBe(200)

      const countRes = await app.inject({
        method: 'GET',
        url: '/api/notifications/unread-count',
        headers: { authorization: `Bearer ${token}` }
      })
      expect(JSON.parse(countRes.payload).count).toBe(0)
    })
  })

  // ──────────────────────────────────────────
  // AUTH & ISOLATION
  // ──────────────────────────────────────────

  describe('Auth and isolation', () => {
    it('returns 401 without token', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/notifications'
      })

      expect(res.statusCode).toBe(401)
    })

    it('user A cannot see user B notifications', async () => {
      const userA = await createTestUser()
      const userB = await createTestUser()
      const tokenA = await createTestToken(userA.id)

      await insertNotification(userB.id, { title: 'B secret' })

      const res = await app.inject({
        method: 'GET',
        url: '/api/notifications',
        headers: { authorization: `Bearer ${tokenA}` }
      })

      expect(res.statusCode).toBe(200)
      const body = JSON.parse(res.payload)
      expect(body.notifications.length).toBe(0)
    })

    it('user A cannot mark user B notification as read', async () => {
      const userA = await createTestUser()
      const userB = await createTestUser()
      const tokenA = await createTestToken(userA.id)

      const notif = await insertNotification(userB.id)

      const res = await app.inject({
        method: 'PUT',
        url: `/api/notifications/${notif.id}/read`,
        headers: { authorization: `Bearer ${tokenA}` }
      })

      // Returns 404 because query filters by recipientId
      expect(res.statusCode).toBe(404)
    })
  })
})
