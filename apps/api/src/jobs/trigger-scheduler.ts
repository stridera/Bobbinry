/**
 * Trigger Scheduler
 *
 * Generic cron runner that processes manifest-defined schedule triggers.
 * Reads bobbin manifests from installed bobbins, checks for schedule triggers,
 * and invokes the corresponding bobbin actions on their cron schedules.
 *
 * Also handles periodic backup sync for backup bobbins that declare sync.frequency.
 */

import { db } from '../db/connection'
import { bobbinsInstalled, entities, projectDestinations, chapterPublications } from '../db/schema'
import { eq, and, gt, lte } from 'drizzle-orm'
import { processEmbargoReleases, initTierDispatch } from './tier-dispatch'
import { processTrashPurge } from './trash-purge'
import { createActionRuntime, type ActionHandler, type ActionModule } from '@bobbinry/action-runtime'
import { loadDiskManifests } from '../lib/disk-manifests'
import { getDeclaredCustomAction } from '../lib/bobbin-actions'
import { serverEventBus, contentPublished } from '../lib/event-bus'

/** Sync frequency to milliseconds lookup for backup bobbins */
const SYNC_FREQUENCY_MS: Record<string, number> = {
  'on_edit': 0, // handled by event bus, not cron
  'hourly': 60 * 60 * 1000,
  'daily': 24 * 60 * 60 * 1000,
  'weekly': 7 * 24 * 60 * 60 * 1000,
}

interface ScheduleTrigger {
  event: 'schedule'
  action?: string
  actions?: string[]
  config?: { cron?: string }
  description?: string
}

interface ManifestInteractions {
  triggers?: ScheduleTrigger[]
}

interface ParsedCron {
  minute: string
  hour: string
  dayOfMonth: string
  month: string
  dayOfWeek: string
}

function parseCron(cronExpr: string): ParsedCron | null {
  const parts = cronExpr.trim().split(/\s+/)
  if (parts.length !== 5) return null
  return {
    minute: parts[0]!,
    hour: parts[1]!,
    dayOfMonth: parts[2]!,
    month: parts[3]!,
    dayOfWeek: parts[4]!
  }
}

function cronFieldMatches(field: string, value: number): boolean {
  if (field === '*') return true

  // Handle */N step values
  if (field.startsWith('*/')) {
    const step = parseInt(field.slice(2), 10)
    if (isNaN(step) || step <= 0) return false
    return value % step === 0
  }

  // Handle comma-separated values
  if (field.includes(',')) {
    return field.split(',').some(v => parseInt(v, 10) === value)
  }

  // Handle ranges (e.g., 1-5)
  if (field.includes('-')) {
    const [start, end] = field.split('-').map(v => parseInt(v, 10))
    if (start === undefined || end === undefined || isNaN(start) || isNaN(end)) return false
    return value >= start && value <= end
  }

  // Simple number match
  return parseInt(field, 10) === value
}

function cronMatchesNow(cronExpr: string, now: Date): boolean {
  const parsed = parseCron(cronExpr)
  if (!parsed) return false

  return (
    cronFieldMatches(parsed.minute, now.getUTCMinutes()) &&
    cronFieldMatches(parsed.hour, now.getUTCHours()) &&
    cronFieldMatches(parsed.dayOfMonth, now.getUTCDate()) &&
    cronFieldMatches(parsed.month, now.getUTCMonth() + 1) &&
    cronFieldMatches(parsed.dayOfWeek, now.getUTCDay())
  )
}

// Registry of action handlers by bobbin ID
const actionHandlers: Record<string, Record<string, (projectId: string) => Promise<void>>> = {}

/**
 * Register an action handler for a bobbin.
 * Called at startup for each native bobbin that has schedule triggers.
 */
export function registerActionHandler(
  bobbinId: string,
  actionId: string,
  handler: (projectId: string) => Promise<void>
): void {
  if (!actionHandlers[bobbinId]) {
    actionHandlers[bobbinId] = {}
  }
  actionHandlers[bobbinId]![actionId] = handler
}

interface InstalledBobbin {
  bobbinId: string
  projectId: string | null
}

/** Shared query for both schedule triggers and backup sync. */
async function getInstalledBobbins(): Promise<{
  installed: InstalledBobbin[]
  diskManifests: Map<string, Record<string, any>>
}> {
  const installed = await db
    .select({
      bobbinId: bobbinsInstalled.bobbinId,
      projectId: bobbinsInstalled.projectId,
    })
    .from(bobbinsInstalled)
    .where(eq(bobbinsInstalled.enabled, true))

  const bobbinIds = [...new Set(installed.map(b => b.bobbinId))]
  const diskManifests = await loadDiskManifests(bobbinIds)
  return { installed, diskManifests }
}

/**
 * Process all schedule triggers.
 * Scans installed bobbins for schedule triggers that match the current time,
 * then invokes the corresponding action handlers.
 */
export async function processScheduleTriggers(
  installed: InstalledBobbin[],
  diskManifests: Map<string, Record<string, any>>
): Promise<void> {
  const now = new Date()
  const runtime = createActionRuntime()

  try {
    for (const bobbin of installed) {
      // Schedule triggers only apply to project-scoped installations
      if (!bobbin.projectId) continue

      const manifest = diskManifests.get(bobbin.bobbinId)
      const interactions: ManifestInteractions | undefined = manifest?.interactions

      if (!interactions?.triggers) continue

      for (const trigger of interactions.triggers) {
        if (trigger.event !== 'schedule') continue
        const cron = trigger.config?.cron
        if (cron) {
          if (!cronMatchesNow(cron, now)) continue
        } else if (now.getUTCMinutes() % 15 !== 0) {
          continue
        }

        const actionIds = [
          ...(trigger.action ? [trigger.action] : []),
          ...((Array.isArray(trigger.actions) ? trigger.actions : []))
        ]

        for (const actionId of actionIds) {
          const declaredAction = getDeclaredCustomAction(manifest, actionId)
          if (!declaredAction) {
            console.log(`[trigger-scheduler] Skipping ${bobbin.bobbinId}.${actionId}: not a declared custom action`)
            continue
          }

          try {
            const module = await import(`../../../../bobbins/${bobbin.bobbinId}/actions`) as ActionModule
            const namedHandler = module[declaredAction.handler]
            const registryHandler = module.actions?.[actionId]
            const handler =
              (typeof namedHandler === 'function' ? namedHandler : undefined)
              ?? (typeof registryHandler === 'function' ? registryHandler : undefined)

            if (!handler) {
              console.log(`[trigger-scheduler] No custom handler export for ${bobbin.bobbinId}.${actionId}`)
              continue
            }

            const result = await (handler as ActionHandler)({}, {
              projectId: bobbin.projectId,
              bobbinId: bobbin.bobbinId,
              actionId
            }, runtime)

            if (!result.success) {
              console.error(`[trigger-scheduler] ${bobbin.bobbinId}.${actionId} failed for project ${bobbin.projectId}: ${result.error || 'Unknown error'}`)
              continue
            }

            console.log(`[trigger-scheduler] Ran ${bobbin.bobbinId}.${actionId} for project ${bobbin.projectId}`)
          } catch (err) {
            console.error(`[trigger-scheduler] Failed ${bobbin.bobbinId}.${actionId} for project ${bobbin.projectId}:`, err)
          }
        }
      }
    }
  } catch (err) {
    console.error('[trigger-scheduler] Failed to process schedule triggers:', err)
  }
}

/**
 * Process backup sync for bobbins with sync.frequency defined.
 * Queries backup bobbins, checks sync frequency against last sync time,
 * and emits events for bobbins that need to sync.
 */
export async function processBackupSync(
  installed: InstalledBobbin[],
  diskManifests: Map<string, Record<string, any>>
): Promise<void> {
  try {
    const now = new Date()

    for (const bobbin of installed) {
      // Backup sync only applies to project-scoped installations
      if (!bobbin.projectId) continue

      const manifest = diskManifests.get(bobbin.bobbinId)
      const capabilities = manifest?.capabilities || {}
      const sync = manifest?.sync || {}

      // Only process backup bobbins with sync frequency
      if (capabilities.publisherCategory !== 'backup' || !sync.frequency) continue

      // Calculate if sync is due based on frequency
      const interval = SYNC_FREQUENCY_MS[sync.frequency]
      if (!interval || interval === 0) continue

      // Check last sync for this bobbin's destinations
      const [destination] = await db
        .select({ lastSyncedAt: projectDestinations.lastSyncedAt })
        .from(projectDestinations)
        .where(and(
          eq(projectDestinations.projectId, bobbin.projectId),
          eq(projectDestinations.isActive, true),
        ))
        .limit(1)

      const lastSync = destination?.lastSyncedAt
      if (lastSync && (now.getTime() - lastSync.getTime()) < interval) continue

      // Find entities edited since last sync
      const sinceDate = lastSync || new Date(0)
      const editedEntities = await db
        .select({ id: entities.id })
        .from(entities)
        .where(and(
          eq(entities.projectId, bobbin.projectId),
          gt(entities.lastEditedAt!, sinceDate)
        ))
        .limit(1) // Just check if any exist

      if (editedEntities.length === 0) continue

      // Invoke the backup handler if registered
      const handler = actionHandlers[bobbin.bobbinId]?.['sync']
      if (handler) {
        try {
          await handler(bobbin.projectId)
          console.log(`[trigger-scheduler] Backup sync completed: ${bobbin.bobbinId} for project ${bobbin.projectId}`)
        } catch (err) {
          console.error(`[trigger-scheduler] Backup sync failed: ${bobbin.bobbinId} for project ${bobbin.projectId}:`, err)
        }
      } else {
        console.log(`[trigger-scheduler] No sync handler for backup bobbin ${bobbin.bobbinId}`)
      }
    }
  } catch (err) {
    console.error('[trigger-scheduler] Failed to process backup sync:', err)
  }
}

export async function processScheduledReleases(): Promise<void> {
  try {
    const now = new Date()
    const duePublications = await db
      .select({
        id: chapterPublications.id,
        projectId: chapterPublications.projectId,
        chapterId: chapterPublications.chapterId,
      })
      .from(chapterPublications)
      .where(and(
        eq(chapterPublications.publishStatus, 'scheduled'),
        lte(chapterPublications.publishedAt, now)
      ))

    if (duePublications.length === 0) return

    for (const publication of duePublications) {
      await db
        .update(chapterPublications)
        .set({
          publishStatus: 'published',
          lastPublishedAt: now,
          updatedAt: now,
        })
        .where(eq(chapterPublications.id, publication.id))

      serverEventBus.fire(contentPublished(
        publication.projectId,
        publication.chapterId,
        'system',
        true
      ))
    }
  } catch (err) {
    console.error('[trigger-scheduler] Failed to process scheduled releases:', err)
  }
}

let intervalId: ReturnType<typeof setInterval> | null = null

/**
 * Start the trigger scheduler.
 * Runs every minute to check for matching cron triggers and backup sync.
 */
export function startTriggerScheduler(): void {
  if (intervalId) return

  // Initialize tier dispatch (subscribes to content:available events)
  initTierDispatch()

  console.log('[trigger-scheduler] Starting trigger scheduler (1-minute interval)')

  async function tick() {
    const { installed, diskManifests } = await getInstalledBobbins()
    const tasks: Promise<any>[] = [
      processScheduleTriggers(installed, diskManifests),
      processBackupSync(installed, diskManifests),
      processScheduledReleases(),
      processEmbargoReleases(),
    ]

    // Run trash purge hourly (at minute 0)
    if (new Date().getUTCMinutes() === 0) {
      tasks.push(processTrashPurge())
    }

    await Promise.allSettled(tasks)
  }

  intervalId = setInterval(tick, 60 * 1000)
  // Run once immediately
  tick().catch(err => console.error('[trigger-scheduler] Initial tick failed:', err))
}

/**
 * Stop the trigger scheduler.
 */
export function stopTriggerScheduler(): void {
  if (intervalId) {
    clearInterval(intervalId)
    intervalId = null
    console.log('[trigger-scheduler] Stopped trigger scheduler')
  }
}
