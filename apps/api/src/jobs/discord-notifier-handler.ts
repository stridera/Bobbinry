/**
 * Discord Notifier Handler
 *
 * Listens for content:published and content:available events.
 * Sends Discord webhook embeds to configured channels based on tier filters.
 */

import { serverEventBus, type DomainEvent } from '../lib/event-bus'
import { db } from '../db/connection'
import { projects, entities, users, userProfiles, projectDestinations, embargoSchedules } from '../db/schema'
import { eq, and } from 'drizzle-orm'
import { sendWebhook, buildChapterEmbed } from '../lib/discord-api'

async function sendToMatchingDestinations(
  projectId: string,
  chapterId: string,
  tierLevel: number | null // null = public/all
): Promise<void> {
  // Get active Discord webhook destinations for this project
  const destinations = await db
    .select()
    .from(projectDestinations)
    .where(
      and(
        eq(projectDestinations.projectId, projectId),
        eq(projectDestinations.type, 'discord_webhook'),
        eq(projectDestinations.isActive, true)
      )
    )

  if (destinations.length === 0) return

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
    .select({ name: users.name, username: userProfiles.username })
    .from(users)
    .leftJoin(userProfiles, eq(userProfiles.userId, users.id))
    .where(eq(users.id, project.ownerId))
    .limit(1)

  const chapterData = chapter.entityData as Record<string, unknown>
  const chapterTitle = (chapterData?.title as string) || 'Untitled Chapter'
  const chapterUrl = `https://bobbinry.com/read/${author?.username}/${project.shortUrl || project.id}/${chapter.id}`

  for (const dest of destinations) {
    const config = dest.config as any
    const filter = config.tierFilter || { mode: 'all', minTierLevel: 0 }

    // Check tier filter
    if (filter.mode === 'public_only' && tierLevel !== null && tierLevel > 0) continue
    if (filter.mode === 'tier_and_above' && tierLevel !== null && tierLevel < filter.minTierLevel) continue

    const payload = buildChapterEmbed({
      chapterTitle,
      projectTitle: project.name || 'Untitled',
      chapterUrl,
      excerpt: config.messageTemplate?.showExcerpt ? (chapterData?.synopsis as string || undefined) : undefined,
      authorName: author?.name || undefined,
      mentionRole: config.messageTemplate?.mentionRole,
    })

    const result = await sendWebhook(config.webhookUrl, payload)

    // Update destination status
    await db.update(projectDestinations).set({
      lastSyncedAt: new Date(),
      lastSyncStatus: result.success ? 'success' : 'failed',
      lastSyncError: result.error || null,
      updatedAt: new Date(),
    }).where(eq(projectDestinations.id, dest.id))

    if (!result.success) {
      console.warn(`[discord-notifier] Webhook failed for destination ${dest.id}: ${result.error}`)
    }
  }
}

async function handleContentPublished(event: DomainEvent): Promise<void> {
  const { isPublished } = event.payload
  if (!isPublished) return

  const projectId = event.projectId
  const chapterId = event.entityId
  if (!projectId || !chapterId) return

  // Check if this content has an embargo — if so, the initial publish is for subscribers (high tier)
  const [embargo] = await db
    .select({ publishMode: embargoSchedules.publishMode })
    .from(embargoSchedules)
    .where(and(eq(embargoSchedules.projectId, projectId), eq(embargoSchedules.entityId, chapterId)))
    .limit(1)

  // For embargoed content, send to channels configured for "all" or "tier_and_above"
  // For non-embargoed content, send to all matching channels
  const tierLevel = embargo?.publishMode === 'tiered' ? 999 : null // High tier means subscriber-only initially
  await sendToMatchingDestinations(projectId, chapterId, tierLevel)
}

async function handleContentAvailable(event: DomainEvent): Promise<void> {
  const tierId = event.payload.tierId as string
  const tierLevel = (event.payload.tierLevel as number) ?? 0

  const projectId = event.projectId
  const chapterId = event.entityId
  if (!projectId || !chapterId) return

  // Public release: tierLevel 0. Tiered release: the specific tier level.
  const effectiveTierLevel = tierId === 'public' ? 0 : tierLevel
  await sendToMatchingDestinations(projectId, chapterId, effectiveTierLevel)
}

export function initDiscordNotifierHandler(): void {
  serverEventBus.on('content:published', handleContentPublished)
  serverEventBus.on('content:available', handleContentAvailable)
  console.log('[discord-notifier] Initialized — listening for content:published, content:available events')
}
