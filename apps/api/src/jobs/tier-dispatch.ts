/**
 * Tier Dispatch Job
 *
 * When content becomes available for a tier (content:available event),
 * this job iterates users subscribed to that tier and dispatches to
 * their installed reader bobbins:
 *
 *   - Automation bobbins (e.g. Kindle sender): execute immediately
 *   - Reader bobbins (e.g. default reader): create a feed entry
 *
 * Also handles processing embargo schedules to fire content:available
 * events when tier release dates are reached.
 */

import { db } from '../db/connection'
import {
  subscriptions,
  subscriptionTiers,
  userBobbinsInstalled,
  embargoSchedules,
  projects
} from '../db/schema'
import { eq, and, sql } from 'drizzle-orm'
import { serverEventBus, contentAvailable } from '../lib/event-bus'

/**
 * Registry for automation bobbin handlers.
 * Keyed by bobbinId, value is the handler function.
 */
const automationHandlers: Record<string, (ctx: AutomationContext) => Promise<void>> = {}

export interface AutomationContext {
  userId: string
  projectId: string
  entityId: string
  tierId: string
  tierLevel: number
  bobbinConfig: Record<string, unknown> | null
}

/**
 * Register an automation handler for a reader bobbin.
 * Called at startup for each native automation bobbin (e.g. kindle-sender).
 */
export function registerAutomationHandler(
  bobbinId: string,
  handler: (ctx: AutomationContext) => Promise<void>
): void {
  automationHandlers[bobbinId] = handler
  console.log(`[tier-dispatch] Registered automation handler: ${bobbinId}`)
}

/**
 * Handle a content:available event.
 * Finds all users subscribed to the specified tier and dispatches
 * to their installed reader bobbins.
 */
async function handleContentAvailable(event: {
  projectId: string
  entityId?: string
  payload: Record<string, unknown>
}): Promise<void> {
  const { projectId, entityId } = event
  const tierId = event.payload.tierId as string
  const tierLevel = event.payload.tierLevel as number

  if (!entityId || !tierId) {
    console.warn('[tier-dispatch] Missing entityId or tierId in content:available event')
    return
  }

  // Get the author of this project
  const [project] = await db
    .select({ ownerId: projects.ownerId })
    .from(projects)
    .where(eq(projects.id, projectId))
    .limit(1)

  if (!project) {
    console.warn(`[tier-dispatch] Project not found: ${projectId}`)
    return
  }

  // Find all active subscribers at this tier level or higher
  const subscribers = await db
    .select({
      subscriberId: subscriptions.subscriberId,
      tierId: subscriptions.tierId,
      tierLevel: subscriptionTiers.tierLevel
    })
    .from(subscriptions)
    .innerJoin(subscriptionTiers, eq(subscriptionTiers.id, subscriptions.tierId))
    .where(and(
      eq(subscriptions.authorId, project.ownerId),
      eq(subscriptions.status, 'active'),
      // Users at this tier level or higher get access
      sql`${subscriptionTiers.tierLevel} >= ${tierLevel}`
    ))

  console.log(`[tier-dispatch] Dispatching content:available for entity ${entityId} to ${subscribers.length} subscribers (tier >= ${tierLevel})`)

  for (const sub of subscribers) {
    try {
      await dispatchToUser(sub.subscriberId, projectId, entityId, tierId, tierLevel)
    } catch (err) {
      console.error(`[tier-dispatch] Failed to dispatch to user ${sub.subscriberId}:`, err)
    }
  }
}

/**
 * Dispatch content availability to a single user.
 * Checks their installed reader bobbins and executes accordingly.
 */
async function dispatchToUser(
  userId: string,
  projectId: string,
  entityId: string,
  tierId: string,
  tierLevel: number
): Promise<void> {
  // Get user's installed reader bobbins
  const userBobbins = await db
    .select({
      bobbinId: userBobbinsInstalled.bobbinId,
      bobbinType: userBobbinsInstalled.bobbinType,
      config: userBobbinsInstalled.config
    })
    .from(userBobbinsInstalled)
    .where(and(
      eq(userBobbinsInstalled.userId, userId),
      eq(userBobbinsInstalled.isEnabled, true)
    ))

  for (const bobbin of userBobbins) {
    if (bobbin.bobbinType === 'delivery_channel') {
      // Automation bobbin — execute server-side handler
      const handler = automationHandlers[bobbin.bobbinId]
      if (handler) {
        try {
          await handler({
            userId,
            projectId,
            entityId,
            tierId,
            tierLevel,
            bobbinConfig: bobbin.config as Record<string, unknown> | null
          })
          console.log(`[tier-dispatch] Automation ${bobbin.bobbinId} executed for user ${userId}`)
        } catch (err) {
          console.error(`[tier-dispatch] Automation ${bobbin.bobbinId} failed for user ${userId}:`, err)
        }
      } else {
        console.log(`[tier-dispatch] No automation handler for ${bobbin.bobbinId}`)
      }
    }
    // Reader bobbins (reader_enhancement) don't need server-side dispatch —
    // the user's /read feed will automatically show new content when they load it,
    // because access control already checks tier availability.
  }
}

/**
 * Process embargo schedules to fire content:available events.
 * Scans embargo schedules with tiered release dates that have passed
 * but haven't been dispatched yet.
 *
 * Run periodically (e.g. every minute via the trigger scheduler).
 */
export async function processEmbargoReleases(): Promise<void> {
  const now = new Date()

  try {
    // Find published chapters with embargo schedules that have tier release dates
    const embargoes = await db
      .select({
        id: embargoSchedules.id,
        projectId: embargoSchedules.projectId,
        entityId: embargoSchedules.entityId,
        tierSchedules: embargoSchedules.tierSchedules,
        publicReleaseDate: embargoSchedules.publicReleaseDate,
        isPublished: embargoSchedules.isPublished
      })
      .from(embargoSchedules)
      .where(eq(embargoSchedules.isPublished, true))

    for (const embargo of embargoes) {
      const tierSchedules = (embargo.tierSchedules as Array<{ tierId: string; releaseDate: string; dispatched?: boolean }>) || []

      let hasUpdates = false
      for (const tierSchedule of tierSchedules) {
        if (tierSchedule.dispatched) continue

        const releaseDate = new Date(tierSchedule.releaseDate)
        if (releaseDate <= now) {
          // This tier's content is now available — fire event
          // Look up tier level for this tier
          const [tier] = await db
            .select({ tierLevel: subscriptionTiers.tierLevel })
            .from(subscriptionTiers)
            .where(eq(subscriptionTiers.id, tierSchedule.tierId))
            .limit(1)

          const tierLevel = tier?.tierLevel ?? 0

          serverEventBus.fire(contentAvailable(
            embargo.projectId,
            embargo.entityId,
            tierSchedule.tierId,
            tierLevel
          ))

          tierSchedule.dispatched = true
          hasUpdates = true
          console.log(`[tier-dispatch] Content available: entity ${embargo.entityId}, tier ${tierSchedule.tierId}`)
        }
      }

      // Check public release date
      if (embargo.publicReleaseDate && embargo.publicReleaseDate <= now) {
        // Content is publicly available — fire event with tier level 0 (public)
        serverEventBus.fire(contentAvailable(
          embargo.projectId,
          embargo.entityId,
          'public',
          0
        ))
        console.log(`[tier-dispatch] Content publicly available: entity ${embargo.entityId}`)
      }

      // Persist dispatched flags
      if (hasUpdates) {
        await db
          .update(embargoSchedules)
          .set({ tierSchedules })
          .where(eq(embargoSchedules.id, embargo.id))
      }
    }
  } catch (err) {
    console.error('[tier-dispatch] Failed to process embargo releases:', err)
  }
}

/**
 * Initialize tier dispatch by subscribing to content:available events.
 */
export function initTierDispatch(): void {
  serverEventBus.on('content:available', handleContentAvailable)
  console.log('[tier-dispatch] Initialized — listening for content:available events')
}
