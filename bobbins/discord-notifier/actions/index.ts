import type { ActionContext, ActionResult, ActionRuntimeHost } from '@bobbinry/action-runtime'

async function createDbCallbacks() {
  const { db } = await import('../../../apps/api/src/db/connection')
  const { projectDestinations } = await import('../../../apps/api/src/db/schema')
  const { eq, and } = await import('drizzle-orm')
  return { db, projectDestinations, eq, and }
}

export async function testWebhook(
  params: { webhookUrl: string },
  _context: ActionContext,
  runtime: ActionRuntimeHost
): Promise<ActionResult> {
  try {
    const { sendWebhook, buildChapterEmbed } = await import('../../../apps/api/src/lib/discord-api')

    const payload = buildChapterEmbed({
      chapterTitle: 'Test Notification',
      projectTitle: 'Your Project',
      chapterUrl: 'https://bobbinry.com',
      excerpt: 'This is a test message from Bobbinry Discord Notifier. If you see this, your webhook is working!',
    })

    const result = await sendWebhook(params.webhookUrl, payload)
    return result
  } catch (error) {
    runtime.log.error({ error }, 'testWebhook failed')
    return { success: false, error: error instanceof Error ? error.message : 'Unknown error' }
  }
}

export async function sendNotification(
  params: { projectId: string; entityId: string; destinationId?: string },
  context: ActionContext,
  runtime: ActionRuntimeHost
): Promise<ActionResult> {
  try {
    const { db, projectDestinations, eq, and } = await createDbCallbacks()
    const { entities, projects, users } = await import('../../../apps/api/src/db/schema')
    const { sendWebhook, buildChapterEmbed } = await import('../../../apps/api/src/lib/discord-api')

    // Fetch project + chapter + author
    const [[project], [chapter]] = await Promise.all([
      db.select({ id: projects.id, name: projects.name, ownerId: projects.ownerId, shortUrl: projects.shortUrl })
        .from(projects).where(eq(projects.id, params.projectId)).limit(1),
      db.select({ id: entities.id, entityData: entities.entityData })
        .from(entities).where(eq(entities.id, params.entityId)).limit(1),
    ])

    if (!project || !chapter) {
      return { success: false, error: 'Project or chapter not found' }
    }

    const [author] = await db
      .select({ name: users.name })
      .from(users)
      .where(eq(users.id, project.ownerId))
      .limit(1)

    const chapterData = chapter.entityData as any
    const chapterTitle = chapterData?.title || 'Untitled Chapter'
    const chapterUrl = `https://bobbinry.com/${project.shortUrl || project.id}/read/${chapter.id}`

    // Get active Discord webhook destinations for this project
    const destinations = params.destinationId
      ? await db.select().from(projectDestinations)
          .where(and(
            eq(projectDestinations.id, params.destinationId),
            eq(projectDestinations.type, 'discord_webhook'),
          )).limit(1)
      : await db.select().from(projectDestinations)
          .where(and(
            eq(projectDestinations.projectId, params.projectId),
            eq(projectDestinations.type, 'discord_webhook'),
            eq(projectDestinations.isActive, true),
          ))

    if (destinations.length === 0) {
      return { success: false, error: 'No active Discord destinations found' }
    }

    let succeeded = 0
    let failed = 0

    for (const dest of destinations) {
      const config = dest.config as any
      const payload = buildChapterEmbed({
        chapterTitle,
        projectTitle: project.name || 'Untitled',
        chapterUrl,
        excerpt: config.messageTemplate?.showExcerpt ? (chapterData?.synopsis || undefined) : undefined,
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

      if (result.success) succeeded++
      else failed++
    }

    return {
      success: failed === 0,
      data: { sent: succeeded, failed },
      error: failed > 0 ? `${failed} webhook(s) failed` : undefined,
    }
  } catch (error) {
    runtime.log.error({ error }, 'sendNotification failed')
    return { success: false, error: error instanceof Error ? error.message : 'Unknown error' }
  }
}

export const actions = {
  test_webhook: testWebhook,
  send_notification: sendNotification,
}
