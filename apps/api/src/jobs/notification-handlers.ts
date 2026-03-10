/**
 * Notification Handlers
 *
 * Listens for domain events and creates in-app notification records.
 * Also sends email notifications based on user preferences.
 */

import { db } from '../db/connection'
import {
  notifications,
  projects,
  entities,
  users,
  projectFollows,
  userNotificationPreferences,
} from '../db/schema'
import { eq } from 'drizzle-orm'
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

  // Get all followers of this project
  const followers = await db
    .select({ followerId: projectFollows.followerId })
    .from(projectFollows)
    .where(eq(projectFollows.projectId, projectId))

  if (followers.length === 0) return

  const authorName = author.name || 'An author'
  const chapterData = chapter.entityData as Record<string, unknown>
  const chapterTitle = (chapterData?.title as string) || 'Untitled Chapter'
  const projectTitle = project.name || 'Untitled Project'
  const chapterUrl = `/${project.shortUrl || projectId}/read/${chapterId}`

  // Batch insert notification records for all followers
  const notificationValues = followers.map(f => ({
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

  // Send emails to followers who have emailNewChapter enabled
  for (const follower of followers) {
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
          chapterUrl
        )
      }
    })().catch(err => {
      console.warn('[notifications] Failed to send new chapter email:', err)
    })
  }
}

export function initNotificationHandlers(): void {
  serverEventBus.on('content:published', handleContentPublished)
  console.log('[notifications] Initialized — listening for content:published events')
}
