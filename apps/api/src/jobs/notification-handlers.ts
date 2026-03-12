/**
 * Notification Handlers
 *
 * Listens for domain events and creates in-app notification records.
 * Also sends email notifications based on user preferences.
 *
 * Respects:
 * - Per-user notification preferences (emailNewChapter, etc.)
 * - Per-project mute flag (projectFollows.muted)
 * - Embargo schedules: defers free-follower notification until public release
 */

import { db } from '../db/connection'
import {
  notifications,
  projects,
  entities,
  users,
  projectFollows,
  userNotificationPreferences,
  embargoSchedules,
  subscriptions,
} from '../db/schema'
import { eq, and } from 'drizzle-orm'
import { serverEventBus, DomainEvent } from '../lib/event-bus'
import { sendNewChapterEmail } from '../lib/email'

async function handleContentPublished(event: DomainEvent): Promise<void> {
  const { isPublished } = event.payload
  if (!isPublished) return // skip unpublish events

  const projectId = event.projectId
  const chapterId = event.entityId
  if (!projectId || !chapterId) return

  // Fetch project + chapter + author info
  const [[project], [chapter]] = await Promise.all([
    db.select({
      id: projects.id,
      name: projects.name,
      ownerId: projects.ownerId,
      shortUrl: projects.shortUrl,
    }).from(projects).where(eq(projects.id, projectId)).limit(1),
    db.select({
      id: entities.id,
      entityData: entities.entityData,
    }).from(entities).where(eq(entities.id, chapterId)).limit(1),
  ])

  if (!project || !chapter) return

  const [author] = await db
    .select({ id: users.id, name: users.name })
    .from(users)
    .where(eq(users.id, project.ownerId))
    .limit(1)

  if (!author) return

  // Check if this content has an embargo (tiered release)
  const [embargo] = await db
    .select({ publishMode: embargoSchedules.publishMode, publicReleaseDate: embargoSchedules.publicReleaseDate })
    .from(embargoSchedules)
    .where(and(eq(embargoSchedules.projectId, projectId), eq(embargoSchedules.entityId, chapterId)))
    .limit(1)

  const hasEmbargo = embargo && embargo.publishMode === 'tiered' && embargo.publicReleaseDate

  // Get all followers of this project (with muted status)
  const followers = await db
    .select({ followerId: projectFollows.followerId, muted: projectFollows.muted })
    .from(projectFollows)
    .where(eq(projectFollows.projectId, projectId))

  if (followers.length === 0) return

  const authorName = author.name || 'An author'
  const chapterData = chapter.entityData as Record<string, unknown>
  const chapterTitle = (chapterData?.title as string) || 'Untitled Chapter'
  const projectTitle = project.name || 'Untitled Project'
  const chapterUrl = `/${project.shortUrl || projectId}/read/${chapterId}`

  // If embargoed, determine which followers have immediate access (active subscribers)
  let followerIdsToNotify: Set<string>
  if (hasEmbargo) {
    // Get active subscribers for this author — they have immediate access
    const activeSubs = await db
      .select({ subscriberId: subscriptions.subscriberId })
      .from(subscriptions)
      .where(and(
        eq(subscriptions.authorId, project.ownerId),
        eq(subscriptions.status, 'active')
      ))

    const subscriberIds = new Set(activeSubs.map(s => s.subscriberId))
    // Only notify followers who are also subscribers (they get immediate access)
    followerIdsToNotify = new Set(
      followers.map(f => f.followerId).filter(id => subscriberIds.has(id))
    )
  } else {
    // No embargo — notify all followers
    followerIdsToNotify = new Set(followers.map(f => f.followerId))
  }

  // Build muted set for skipping emails
  const mutedFollowerIds = new Set(followers.filter(f => f.muted).map(f => f.followerId))

  // Batch insert notification records for followers who should be notified
  const notifyFollowers = followers.filter(f => followerIdsToNotify.has(f.followerId))
  if (notifyFollowers.length > 0) {
    const notificationValues = notifyFollowers.map(f => ({
      recipientId: f.followerId,
      actorId: author.id,
      type: 'new_chapter' as const,
      title: `New chapter in "${projectTitle}"`,
      body: chapterTitle,
      metadata: {
        projectId,
        projectTitle,
        chapterId,
        chapterTitle,
        url: chapterUrl,
      },
    }))

    await db.insert(notifications).values(notificationValues)
  }

  // Send emails to followers who should be notified, aren't muted, and have emailNewChapter enabled
  for (const follower of notifyFollowers) {
    if (mutedFollowerIds.has(follower.followerId)) continue

    ;(async () => {
      const [prefs] = await db
        .select({ emailNewChapter: userNotificationPreferences.emailNewChapter })
        .from(userNotificationPreferences)
        .where(eq(userNotificationPreferences.userId, follower.followerId))
        .limit(1)

      // Default to true if no preferences set
      if (prefs && !prefs.emailNewChapter) return

      const [followerUser] = await db
        .select({ email: users.email })
        .from(users)
        .where(eq(users.id, follower.followerId))
        .limit(1)

      if (followerUser) {
        await sendNewChapterEmail(
          followerUser.email,
          authorName,
          projectTitle,
          chapterTitle,
          chapterUrl,
          follower.followerId
        )
      }
    })().catch(err => {
      console.warn('[notifications] Failed to send new chapter email:', err)
    })
  }
}

/**
 * Handle content:available where tierId === 'public'
 * Notify free followers who were skipped during initial publish (embargo).
 */
async function handleContentAvailable(event: DomainEvent): Promise<void> {
  const tierId = event.payload.tierId as string
  if (tierId !== 'public') return // Only handle public releases here

  const projectId = event.projectId
  const chapterId = event.entityId
  if (!projectId || !chapterId) return

  // Fetch project + chapter + author
  const [[project], [chapter]] = await Promise.all([
    db.select({
      id: projects.id,
      name: projects.name,
      ownerId: projects.ownerId,
      shortUrl: projects.shortUrl,
    }).from(projects).where(eq(projects.id, projectId)).limit(1),
    db.select({
      id: entities.id,
      entityData: entities.entityData,
    }).from(entities).where(eq(entities.id, chapterId)).limit(1),
  ])

  if (!project || !chapter) return

  const [author] = await db
    .select({ id: users.id, name: users.name })
    .from(users)
    .where(eq(users.id, project.ownerId))
    .limit(1)

  if (!author) return

  // Get all followers (with muted status)
  const followers = await db
    .select({ followerId: projectFollows.followerId, muted: projectFollows.muted })
    .from(projectFollows)
    .where(eq(projectFollows.projectId, projectId))

  if (followers.length === 0) return

  // Get active subscribers — they were already notified at publish time
  const activeSubs = await db
    .select({ subscriberId: subscriptions.subscriberId })
    .from(subscriptions)
    .where(and(
      eq(subscriptions.authorId, project.ownerId),
      eq(subscriptions.status, 'active')
    ))

  const alreadyNotifiedIds = new Set(activeSubs.map(s => s.subscriberId))

  // Free followers who haven't been notified yet
  const freeFollowers = followers.filter(f => !alreadyNotifiedIds.has(f.followerId))
  if (freeFollowers.length === 0) return

  const authorName = author.name || 'An author'
  const chapterData = chapter.entityData as Record<string, unknown>
  const chapterTitle = (chapterData?.title as string) || 'Untitled Chapter'
  const projectTitle = project.name || 'Untitled Project'
  const chapterUrl = `/${project.shortUrl || projectId}/read/${chapterId}`

  // Insert in-app notifications
  const notificationValues = freeFollowers.map(f => ({
    recipientId: f.followerId,
    actorId: author.id,
    type: 'new_chapter' as const,
    title: `New chapter in "${projectTitle}"`,
    body: chapterTitle,
    metadata: {
      projectId,
      projectTitle,
      chapterId,
      chapterTitle,
      url: chapterUrl,
    },
  }))

  await db.insert(notifications).values(notificationValues)

  // Send emails (respecting muted + preferences)
  for (const follower of freeFollowers) {
    if (follower.muted) continue

    ;(async () => {
      const [prefs] = await db
        .select({ emailNewChapter: userNotificationPreferences.emailNewChapter })
        .from(userNotificationPreferences)
        .where(eq(userNotificationPreferences.userId, follower.followerId))
        .limit(1)

      if (prefs && !prefs.emailNewChapter) return

      const [followerUser] = await db
        .select({ email: users.email })
        .from(users)
        .where(eq(users.id, follower.followerId))
        .limit(1)

      if (followerUser) {
        await sendNewChapterEmail(
          followerUser.email,
          authorName,
          projectTitle,
          chapterTitle,
          chapterUrl,
          follower.followerId
        )
      }
    })().catch(err => {
      console.warn('[notifications] Failed to send public release email:', err)
    })
  }
}

export function initNotificationHandlers(): void {
  serverEventBus.on('content:published', handleContentPublished)
  serverEventBus.on('content:available', handleContentAvailable)
  console.log('[notifications] Initialized — listening for content:published, content:available events')
}
