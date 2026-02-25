/**
 * Trigger Scheduler
 *
 * Generic cron runner that processes manifest-defined schedule triggers.
 * Reads bobbin manifests from installed bobbins, checks for schedule triggers,
 * and invokes the corresponding bobbin actions on their cron schedules.
 */

import { db } from '../db/connection'
import { bobbinsInstalled } from '../db/schema'
import { eq } from 'drizzle-orm'

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

let intervalId: ReturnType<typeof setInterval> | null = null

/**
 * Start the trigger scheduler.
 * Runs every minute to check for matching cron triggers.
 */
export function startTriggerScheduler(): void {
  if (intervalId) return
  console.log('[trigger-scheduler] Starting trigger scheduler (1-minute interval)')
  intervalId = setInterval(processScheduleTriggers, 60 * 1000)
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
