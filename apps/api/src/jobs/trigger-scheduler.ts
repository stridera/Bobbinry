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
import { bobbinsInstalled, entities, projectDestinations } from '../db/schema'
import { eq, and, gt } from 'drizzle-orm'
import { processEmbargoReleases, initTierDispatch } from './tier-dispatch'

/** Sync frequency to milliseconds lookup for backup bobbins */
const SYNC_FREQUENCY_MS: Record<string, number> = {
  'on_edit': 0, // handled by event bus, not cron
  'hourly': 60 * 60 * 1000,
  'daily': 24 * 60 * 60 * 1000,
  'weekly': 7 * 24 * 60 * 60 * 1000,
}

interface ScheduleTrigger {
  event: 'schedule'
  action: string
  config: { cron: string }
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

/**
 * Process all schedule triggers.
 * Scans installed bobbins for schedule triggers that match the current time,
 * then invokes the corresponding action handlers.
 */
export async function processScheduleTriggers(): Promise<void> {
  const now = new Date()

  try {
    // Get all installed bobbins with their projects
    const installed = await db
      .select({
        bobbinId: bobbinsInstalled.bobbinId,
        projectId: bobbinsInstalled.projectId,
        manifestJson: bobbinsInstalled.manifestJson,
        enabled: bobbinsInstalled.enabled
      })
      .from(bobbinsInstalled)
      .where(eq(bobbinsInstalled.enabled, true))

    for (const bobbin of installed) {
      const manifest = bobbin.manifestJson as any
      const interactions: ManifestInteractions | undefined = manifest?.interactions

      if (!interactions?.triggers) continue

      for (const trigger of interactions.triggers) {
        if (trigger.event !== 'schedule') continue
        if (!trigger.config?.cron) continue

        if (!cronMatchesNow(trigger.config.cron, now)) continue

        // Find and invoke the handler
        const handler = actionHandlers[bobbin.bobbinId]?.[trigger.action]
        if (handler) {
          try {
            await handler(bobbin.projectId)
            console.log(`[trigger-scheduler] Ran ${bobbin.bobbinId}.${trigger.action} for project ${bobbin.projectId}`)
          } catch (err) {
            console.error(`[trigger-scheduler] Failed ${bobbin.bobbinId}.${trigger.action} for project ${bobbin.projectId}:`, err)
          }
        } else {
          console.log(`[trigger-scheduler] No handler registered for ${bobbin.bobbinId}.${trigger.action}`)
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
export async function processBackupSync(): Promise<void> {
  try {
    const installed = await db
      .select({
        bobbinId: bobbinsInstalled.bobbinId,
        projectId: bobbinsInstalled.projectId,
        manifestJson: bobbinsInstalled.manifestJson,
      })
      .from(bobbinsInstalled)
      .where(eq(bobbinsInstalled.enabled, true))

    const now = new Date()

    for (const bobbin of installed) {
      const manifest = bobbin.manifestJson as any
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
  intervalId = setInterval(async () => {
    await Promise.allSettled([
      processScheduleTriggers(),
      processBackupSync(),
      processEmbargoReleases(),
    ])
  }, 60 * 1000)
  // Run once immediately
  processScheduleTriggers()
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
