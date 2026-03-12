import { describe, it, expect, beforeAll, afterAll, afterEach } from '@jest/globals'
import { db } from '../../db/connection'
import { entities, bobbinsInstalled, users, subscriptionTiers, subscriptions, chapterPublications } from '../../db/schema'
import { eq } from 'drizzle-orm'
import { processScheduledReleases } from '../../jobs/trigger-scheduler'
import {
  createTestApp,
  createTestToken,
  createTestUser,
  createTestProject,
  cleanupAllTestData
} from '../../__tests__/test-helpers'

describe('Publishing API', () => {
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

  /**
   * Helper: create user (verified), project, install manuscript bobbin via DB,
   * create a chapter entity via API. Returns { user, project, token, chapter }.
   */
  async function setupPublishingScenario() {
    const user = await createTestUser()
    const project = await createTestProject(user.id)
    const token = await createTestToken(user.id)

    // Verify email so requireVerified passes
    await db.update(users).set({ emailVerified: new Date() }).where(eq(users.id, user.id))

    // Install manuscript bobbin via DB (bypasses manifest validation)
    await db.insert(bobbinsInstalled).values({
      projectId: project.id,
      bobbinId: 'manuscript',
      version: '1.0.0',
      manifestJson: {
        id: 'manuscript',
        name: 'Manuscript',
        version: '1.0.0',
        data: {
          collections: [
            { name: 'containers', fields: [] },
            { name: 'content', fields: [] }
          ]
        }
      }
    })

    // Create a chapter entity via API
    const entityRes = await app.inject({
      method: 'POST',
      url: '/api/entities',
      headers: { authorization: `Bearer ${token}` },
      payload: {
        collection: 'content',
        projectId: project.id,
        data: { title: 'Chapter 1', order: 1 }
      }
    })

    const chapter = JSON.parse(entityRes.payload)

    return { user, project, token, chapter }
  }

  // ──────────────────────────────────────────
  // PUBLISH / UNPUBLISH / COMPLETE / REVERT
  // ──────────────────────────────────────────

  describe('Chapter publication workflow', () => {
    it('publishes a chapter', async () => {
      const { project, token, chapter } = await setupPublishingScenario()

      const res = await app.inject({
        method: 'POST',
        url: `/api/projects/${project.id}/chapters/${chapter.id}/publish`,
        headers: { authorization: `Bearer ${token}` },
        payload: { publishStatus: 'published' }
      })

      expect([200, 201]).toContain(res.statusCode)
      const body = JSON.parse(res.payload)
      expect(body.publication).toBeDefined()
      expect(body.publication.publishStatus).toBe('published')
    })

    it('uses the author tier delay for public release timing', async () => {
      const { user, project, token, chapter } = await setupPublishingScenario()

      await db.insert(subscriptionTiers).values({
        authorId: user.id,
        name: 'Supporter',
        tierLevel: 1,
        chapterDelayDays: 30,
        isActive: true
      })

      const before = Date.now()
      const res = await app.inject({
        method: 'POST',
        url: `/api/projects/${project.id}/chapters/${chapter.id}/publish`,
        headers: { authorization: `Bearer ${token}` },
        payload: { publishStatus: 'published' }
      })

      expect([200, 201]).toContain(res.statusCode)
      const body = JSON.parse(res.payload)
      const publicReleaseDate = new Date(body.publication.publicReleaseDate).getTime()
      const expectedMin = before + (29 * 24 * 60 * 60 * 1000)
      expect(publicReleaseDate).toBeGreaterThan(expectedMin)
    })

    it('blocks subscriber access until the scheduled release date', async () => {
      const { user, project, token, chapter } = await setupPublishingScenario()
      const subscriber = await createTestUser({ name: 'Scheduled Subscriber' })

      const [tier] = await db.insert(subscriptionTiers).values({
        authorId: user.id,
        name: 'Instant',
        tierLevel: 1,
        chapterDelayDays: 0,
        isActive: true
      }).returning()

      await db.insert(subscriptions).values({
        subscriberId: subscriber.id,
        authorId: user.id,
        tierId: tier!.id,
        status: 'active',
        currentPeriodStart: new Date(),
        currentPeriodEnd: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)
      })

      const scheduledFor = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString()
      const publishRes = await app.inject({
        method: 'POST',
        url: `/api/projects/${project.id}/chapters/${chapter.id}/publish`,
        headers: { authorization: `Bearer ${token}` },
        payload: { publishStatus: 'scheduled', scheduledFor }
      })

      expect([200, 201]).toContain(publishRes.statusCode)

      const accessRes = await app.inject({
        method: 'GET',
        url: `/api/projects/${project.id}/chapters/${chapter.id}/access?userId=${subscriber.id}`
      })

      expect(accessRes.statusCode).toBe(200)
      const access = JSON.parse(accessRes.payload)
      expect(access.canAccess).toBe(false)
      expect(access.reason).toBe('Chapter not yet available for your tier')
    })

    it('publishes scheduled chapters when their release time arrives', async () => {
      const { project, token, chapter } = await setupPublishingScenario()
      const scheduledFor = new Date(Date.now() - 60 * 1000).toISOString()

      const publishRes = await app.inject({
        method: 'POST',
        url: `/api/projects/${project.id}/chapters/${chapter.id}/publish`,
        headers: { authorization: `Bearer ${token}` },
        payload: { publishStatus: 'scheduled', scheduledFor }
      })

      expect([200, 201]).toContain(publishRes.statusCode)

      await processScheduledReleases()

      const [publication] = await db
        .select({
          publishStatus: chapterPublications.publishStatus,
          lastPublishedAt: chapterPublications.lastPublishedAt,
        })
        .from(chapterPublications)
        .where(eq(chapterPublications.chapterId, chapter.id))
        .limit(1)

      expect(publication).toBeDefined()
      expect(publication!.publishStatus).toBe('published')
      expect(publication!.lastPublishedAt).toBeTruthy()
    })

    it('enforces reader access by subscription delay across tiers', async () => {
      const { user, project, token, chapter } = await setupPublishingScenario()
      const immediateReader = await createTestUser({ name: 'Immediate Reader' })
      const delayedReader = await createTestUser({ name: 'Delayed Reader' })
      const publicReader = await createTestUser({ name: 'Public Reader' })

      const [instantTier, delayedTier] = await db.insert(subscriptionTiers).values([
        {
          authorId: user.id,
          name: 'Instant Access',
          tierLevel: 2,
          chapterDelayDays: 0,
          isActive: true
        },
        {
          authorId: user.id,
          name: 'Week Delay',
          tierLevel: 1,
          chapterDelayDays: 7,
          isActive: true
        }
      ]).returning()

      await db.insert(subscriptions).values([
        {
          subscriberId: immediateReader.id,
          authorId: user.id,
          tierId: instantTier!.id,
          status: 'active',
          currentPeriodStart: new Date(),
          currentPeriodEnd: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)
        },
        {
          subscriberId: delayedReader.id,
          authorId: user.id,
          tierId: delayedTier!.id,
          status: 'active',
          currentPeriodStart: new Date(),
          currentPeriodEnd: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)
        }
      ])

      const publishRes = await app.inject({
        method: 'POST',
        url: `/api/projects/${project.id}/chapters/${chapter.id}/publish`,
        headers: { authorization: `Bearer ${token}` },
        payload: { publishStatus: 'published' }
      })

      expect([200, 201]).toContain(publishRes.statusCode)
      const publication = JSON.parse(publishRes.payload).publication
      expect(publication.publicReleaseDate).toBeDefined()

      const instantReaderRes = await app.inject({
        method: 'GET',
        url: `/api/public/projects/${project.id}/chapters/${chapter.id}?userId=${immediateReader.id}`
      })
      expect(instantReaderRes.statusCode).toBe(200)
      expect(JSON.parse(instantReaderRes.payload).chapter.id).toBe(chapter.id)

      const delayedReaderRes = await app.inject({
        method: 'GET',
        url: `/api/public/projects/${project.id}/chapters/${chapter.id}?userId=${delayedReader.id}`
      })
      expect(delayedReaderRes.statusCode).toBe(403)
      const delayedPayload = JSON.parse(delayedReaderRes.payload)
      expect(delayedPayload.error).toBe('Chapter not yet available for your tier')
      expect(delayedPayload.embargoUntil).toBeDefined()

      const publicReaderRes = await app.inject({
        method: 'GET',
        url: `/api/public/projects/${project.id}/chapters/${chapter.id}?userId=${publicReader.id}`
      })
      expect(publicReaderRes.statusCode).toBe(403)
      const publicPayload = JSON.parse(publicReaderRes.payload)
      expect(publicPayload.error).toBe('Chapter embargoed')
      expect(publicPayload.embargoUntil).toBeDefined()
    })

    it('gets publication status', async () => {
      const { project, token, chapter } = await setupPublishingScenario()

      await app.inject({
        method: 'POST',
        url: `/api/projects/${project.id}/chapters/${chapter.id}/publish`,
        headers: { authorization: `Bearer ${token}` },
        payload: { publishStatus: 'published' }
      })

      const res = await app.inject({
        method: 'GET',
        url: `/api/projects/${project.id}/chapters/${chapter.id}/publication`,
        headers: { authorization: `Bearer ${token}` }
      })

      expect(res.statusCode).toBe(200)
      const body = JSON.parse(res.payload)
      expect(body.publication.publishStatus).toBe('published')
    })

    it('lists publications with status filter', async () => {
      const { project, token, chapter } = await setupPublishingScenario()

      await app.inject({
        method: 'POST',
        url: `/api/projects/${project.id}/chapters/${chapter.id}/publish`,
        headers: { authorization: `Bearer ${token}` },
        payload: { publishStatus: 'published' }
      })

      const res = await app.inject({
        method: 'GET',
        url: `/api/projects/${project.id}/publications?status=published`,
        headers: { authorization: `Bearer ${token}` }
      })

      expect(res.statusCode).toBe(200)
      const body = JSON.parse(res.payload)
      expect(body.publications.length).toBeGreaterThanOrEqual(1)
    })

    it('unpublishes a chapter', async () => {
      const { project, token, chapter } = await setupPublishingScenario()

      await app.inject({
        method: 'POST',
        url: `/api/projects/${project.id}/chapters/${chapter.id}/publish`,
        headers: { authorization: `Bearer ${token}` },
        payload: { publishStatus: 'published' }
      })

      const res = await app.inject({
        method: 'POST',
        url: `/api/projects/${project.id}/chapters/${chapter.id}/unpublish`,
        headers: { authorization: `Bearer ${token}` }
      })

      expect(res.statusCode).toBe(200)
      const body = JSON.parse(res.payload)
      expect(body.publication.publishStatus).toBe('draft')
    })

    it('marks chapter as complete', async () => {
      const { project, token, chapter } = await setupPublishingScenario()

      await app.inject({
        method: 'POST',
        url: `/api/projects/${project.id}/chapters/${chapter.id}/publish`,
        headers: { authorization: `Bearer ${token}` },
        payload: { publishStatus: 'published' }
      })

      const res = await app.inject({
        method: 'POST',
        url: `/api/projects/${project.id}/chapters/${chapter.id}/complete`,
        headers: { authorization: `Bearer ${token}` }
      })

      expect([200, 201]).toContain(res.statusCode)
      const body = JSON.parse(res.payload)
      expect(body.publication.publishStatus).toBe('complete')
    })

    it('reverts to draft', async () => {
      const { project, token, chapter } = await setupPublishingScenario()

      await app.inject({
        method: 'POST',
        url: `/api/projects/${project.id}/chapters/${chapter.id}/publish`,
        headers: { authorization: `Bearer ${token}` },
        payload: { publishStatus: 'published' }
      })

      const res = await app.inject({
        method: 'POST',
        url: `/api/projects/${project.id}/chapters/${chapter.id}/revert-to-draft`,
        headers: { authorization: `Bearer ${token}` }
      })

      expect(res.statusCode).toBe(200)
      const body = JSON.parse(res.payload)
      expect(body.publication.publishStatus).toBe('draft')
    })
  })

  // ──────────────────────────────────────────
  // PUBLISH CONFIG
  // ──────────────────────────────────────────

  describe('Publish config', () => {
    it('gets default config and updates it', async () => {
      const { project, token } = await setupPublishingScenario()

      const getRes = await app.inject({
        method: 'GET',
        url: `/api/projects/${project.id}/publish-config`,
        headers: { authorization: `Bearer ${token}` }
      })
      expect(getRes.statusCode).toBe(200)

      const putRes = await app.inject({
        method: 'PUT',
        url: `/api/projects/${project.id}/publish-config`,
        headers: { authorization: `Bearer ${token}` },
        payload: {
          publishingMode: 'manual',
          enableComments: true,
          enableReactions: true
        }
      })

      expect([200, 201]).toContain(putRes.statusCode)
      const body = JSON.parse(putRes.payload)
      expect(body.config.publishingMode).toBe('manual')
      expect(body.config.enableComments).toBe(true)

      const verifyRes = await app.inject({
        method: 'GET',
        url: `/api/projects/${project.id}/publish-config`,
        headers: { authorization: `Bearer ${token}` }
      })
      expect(JSON.parse(verifyRes.payload).config.publishingMode).toBe('manual')
    })

    it('auto-schedules completed chapters into the next open cadence slot', async () => {
      const { project, token } = await setupPublishingScenario()

      const configRes = await app.inject({
        method: 'PUT',
        url: `/api/projects/${project.id}/publish-config`,
        headers: { authorization: `Bearer ${token}` },
        payload: {
          autoReleaseEnabled: true,
          releaseFrequency: 'weekly',
          releaseDay: 'mon,wed,fri',
          releaseTime: '12:00'
        }
      })

      expect([200, 201]).toContain(configRes.statusCode)

      const createChapter = async (title: string) => {
        const entityRes = await app.inject({
          method: 'POST',
          url: '/api/entities',
          headers: { authorization: `Bearer ${token}` },
          payload: {
            collection: 'content',
            projectId: project.id,
            data: { title, order: Math.floor(Math.random() * 1000) }
          }
        })

        expect(entityRes.statusCode).toBe(200)
        return JSON.parse(entityRes.payload)
      }

      const chapterA = await createChapter('Queued Chapter A')
      const chapterB = await createChapter('Queued Chapter B')

      const [beforeCompleteARes, beforeCompleteBRes] = await Promise.all([
        app.inject({
          method: 'GET',
          url: `/api/projects/${project.id}/chapters/${chapterA.id}/publication`,
          headers: { authorization: `Bearer ${token}` }
        }),
        app.inject({
          method: 'GET',
          url: `/api/projects/${project.id}/chapters/${chapterB.id}/publication`,
          headers: { authorization: `Bearer ${token}` }
        })
      ])

      expect(beforeCompleteARes.statusCode).toBe(404)
      expect(beforeCompleteBRes.statusCode).toBe(404)

      await app.inject({
        method: 'POST',
        url: `/api/projects/${project.id}/chapters/${chapterA.id}/complete`,
        headers: { authorization: `Bearer ${token}` }
      })

      await app.inject({
        method: 'POST',
        url: `/api/projects/${project.id}/chapters/${chapterB.id}/complete`,
        headers: { authorization: `Bearer ${token}` }
      })

      const [publicationARes, publicationBRes] = await Promise.all([
        app.inject({
          method: 'GET',
          url: `/api/projects/${project.id}/chapters/${chapterA.id}/publication`,
          headers: { authorization: `Bearer ${token}` }
        }),
        app.inject({
          method: 'GET',
          url: `/api/projects/${project.id}/chapters/${chapterB.id}/publication`,
          headers: { authorization: `Bearer ${token}` }
        })
      ])

      expect(publicationARes.statusCode).toBe(200)
      expect(publicationBRes.statusCode).toBe(200)

      const publicationA = JSON.parse(publicationARes.payload).publication
      const publicationB = JSON.parse(publicationBRes.payload).publication

      expect(publicationA.publishStatus).toBe('scheduled')
      expect(publicationB.publishStatus).toBe('scheduled')

      const scheduledA = new Date(publicationA.publishedAt)
      const scheduledB = new Date(publicationB.publishedAt)

      expect(scheduledA.getUTCHours()).toBe(12)
      expect(scheduledA.getUTCMinutes()).toBe(0)
      expect([1, 3, 5]).toContain(scheduledA.getUTCDay())
      expect([1, 3, 5]).toContain(scheduledB.getUTCDay())
      expect(scheduledB.getTime()).toBeGreaterThan(scheduledA.getTime())
    })

    it('publishes a scheduled chapter early and moves following chapters up', async () => {
      const { project, token } = await setupPublishingScenario()

      const configRes = await app.inject({
        method: 'PUT',
        url: `/api/projects/${project.id}/publish-config`,
        headers: { authorization: `Bearer ${token}` },
        payload: {
          autoReleaseEnabled: true,
          releaseFrequency: 'weekly',
          releaseDay: 'mon,wed,fri',
          releaseTime: '12:00'
        }
      })

      expect([200, 201]).toContain(configRes.statusCode)

      const createChapter = async (title: string, order: number) => {
        const entityRes = await app.inject({
          method: 'POST',
          url: '/api/entities',
          headers: { authorization: `Bearer ${token}` },
          payload: {
            collection: 'content',
            projectId: project.id,
            data: { title, order }
          }
        })

        expect(entityRes.statusCode).toBe(200)
        return JSON.parse(entityRes.payload)
      }

      const chapterA = await createChapter('Chapter A', 10)
      const chapterB = await createChapter('Chapter B', 20)
      const chapterC = await createChapter('Chapter C', 30)

      for (const chapter of [chapterA, chapterB, chapterC]) {
        const completeRes = await app.inject({
          method: 'POST',
          url: `/api/projects/${project.id}/chapters/${chapter.id}/complete`,
          headers: { authorization: `Bearer ${token}` }
        })

        expect([200, 201]).toContain(completeRes.statusCode)
      }

      const publicationARes = await app.inject({
        method: 'GET',
        url: `/api/projects/${project.id}/chapters/${chapterA.id}/publication`,
        headers: { authorization: `Bearer ${token}` }
      })
      const publicationBRes = await app.inject({
        method: 'GET',
        url: `/api/projects/${project.id}/chapters/${chapterB.id}/publication`,
        headers: { authorization: `Bearer ${token}` }
      })
      const publicationCRes = await app.inject({
        method: 'GET',
        url: `/api/projects/${project.id}/chapters/${chapterC.id}/publication`,
        headers: { authorization: `Bearer ${token}` }
      })

      const publicationA = JSON.parse(publicationARes.payload).publication
      const publicationB = JSON.parse(publicationBRes.payload).publication
      const publicationC = JSON.parse(publicationCRes.payload).publication

      const originalASlot = new Date(publicationA.publishedAt)
      const originalBSlot = new Date(publicationB.publishedAt)
      const originalCSlot = new Date(publicationC.publishedAt)

      expect(originalASlot.getTime()).toBeLessThan(originalBSlot.getTime())
      expect(originalBSlot.getTime()).toBeLessThan(originalCSlot.getTime())

      const publishEarlyRes = await app.inject({
        method: 'POST',
        url: `/api/projects/${project.id}/chapters/${chapterB.id}/publish`,
        headers: { authorization: `Bearer ${token}` },
        payload: {
          publishStatus: 'published',
          publishEarly: true,
        }
      })

      expect([200, 201]).toContain(publishEarlyRes.statusCode)

      const refreshedARes = await app.inject({
        method: 'GET',
        url: `/api/projects/${project.id}/chapters/${chapterA.id}/publication`,
        headers: { authorization: `Bearer ${token}` }
      })
      const refreshedBRes = await app.inject({
        method: 'GET',
        url: `/api/projects/${project.id}/chapters/${chapterB.id}/publication`,
        headers: { authorization: `Bearer ${token}` }
      })
      const refreshedCRes = await app.inject({
        method: 'GET',
        url: `/api/projects/${project.id}/chapters/${chapterC.id}/publication`,
        headers: { authorization: `Bearer ${token}` }
      })

      const refreshedA = JSON.parse(refreshedARes.payload).publication
      const refreshedB = JSON.parse(refreshedBRes.payload).publication
      const refreshedC = JSON.parse(refreshedCRes.payload).publication

      expect(refreshedA.publishStatus).toBe('scheduled')
      expect(new Date(refreshedA.publishedAt).toISOString()).toBe(originalASlot.toISOString())

      expect(refreshedB.publishStatus).toBe('published')
      expect(new Date(refreshedB.lastPublishedAt).getTime()).toBeGreaterThanOrEqual(Date.now() - 60_000)

      expect(refreshedC.publishStatus).toBe('scheduled')
      expect(new Date(refreshedC.publishedAt).toISOString()).toBe(originalBSlot.toISOString())
    })

  })

  // ──────────────────────────────────────────
  // EMBARGO CRUD
  // ──────────────────────────────────────────

  describe('Embargo schedules', () => {
    it('creates, gets, updates, and deletes an embargo', async () => {
      const { project, token, chapter } = await setupPublishingScenario()

      // Create
      const createRes = await app.inject({
        method: 'POST',
        url: `/api/projects/${project.id}/embargoes`,
        headers: { authorization: `Bearer ${token}` },
        payload: {
          entityId: chapter.id,
          publishMode: 'scheduled',
          publicReleaseDate: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString()
        }
      })
      expect(createRes.statusCode).toBe(201)
      const embargo = JSON.parse(createRes.payload).embargo
      expect(embargo.id).toBeDefined()

      // Get
      const getRes = await app.inject({
        method: 'GET',
        url: `/api/projects/${project.id}/chapters/${chapter.id}/embargo`,
        headers: { authorization: `Bearer ${token}` }
      })
      expect(getRes.statusCode).toBe(200)

      // Update
      const updateRes = await app.inject({
        method: 'PUT',
        url: `/api/embargoes/${embargo.id}`,
        headers: { authorization: `Bearer ${token}` },
        payload: { publishMode: 'immediate' }
      })
      expect(updateRes.statusCode).toBe(200)

      // Delete
      const deleteRes = await app.inject({
        method: 'DELETE',
        url: `/api/embargoes/${embargo.id}`,
        headers: { authorization: `Bearer ${token}` }
      })
      expect(deleteRes.statusCode).toBe(200)

      // Verify deleted
      const verifyRes = await app.inject({
        method: 'GET',
        url: `/api/projects/${project.id}/chapters/${chapter.id}/embargo`,
        headers: { authorization: `Bearer ${token}` }
      })
      expect(verifyRes.statusCode).toBe(404)
    })
  })

  // ──────────────────────────────────────────
  // CHAPTER VIEWS / ANALYTICS
  // ──────────────────────────────────────────

  describe('Chapter views and analytics', () => {
    it('tracks a view and returns analytics', async () => {
      const { project, token, chapter } = await setupPublishingScenario()

      // Publish first
      await app.inject({
        method: 'POST',
        url: `/api/projects/${project.id}/chapters/${chapter.id}/publish`,
        headers: { authorization: `Bearer ${token}` },
        payload: { publishStatus: 'published' }
      })

      // Record a view
      const viewRes = await app.inject({
        method: 'POST',
        url: `/api/chapters/${chapter.id}/views`,
        payload: { sessionId: 'test-session-1', deviceType: 'desktop' }
      })
      expect(viewRes.statusCode).toBe(201)

      // Get analytics
      const analyticsRes = await app.inject({
        method: 'GET',
        url: `/api/projects/${project.id}/chapters/${chapter.id}/analytics`,
        headers: { authorization: `Bearer ${token}` }
      })
      expect(analyticsRes.statusCode).toBe(200)
      const analytics = JSON.parse(analyticsRes.payload).analytics
      expect(analytics.totalViews).toBeGreaterThanOrEqual(1)
    })
  })
})
