/**
 * Smart Publisher Actions
 *
 * Processes the release queue and publishes authorized chapters
 * according to the configured release policy.
 */

import { BobbinrySDK } from '@bobbinry/sdk'

interface ReleaseQueueItem {
  id: string
  entityData: {
    chapter_id: string
    queue_position: number
    authorized_at: string | null
    status: string
    notes?: string
  }
}

interface ReleasePolicyConfig {
  id: string
  entityData: {
    release_frequency: string
    release_day?: string
    release_time?: string
    tier_delays?: Array<{ tierLevel: number; delayDays: number }>
    max_queue_size?: number
    auto_authorize?: boolean
  }
}

/**
 * Process the release queue.
 * Called on a schedule (every 15 minutes) or manually.
 *
 * 1. Get the release policy
 * 2. Check if it's time for a release
 * 3. Find the next authorized chapter in the queue
 * 4. Publish it with tier-based embargo delays
 * 5. Advance the queue
 */
export async function processReleases(sdk: BobbinrySDK, projectId: string): Promise<void> {
  // Get release policy
  const policyResult = await sdk.entities.query<ReleasePolicyConfig>({
    collection: 'ReleasePolicy',
    limit: 1
  })

  if (policyResult.data.length === 0) {
    console.log('[smart-publisher] No release policy configured')
    return
  }

  const policy = policyResult.data[0]!.entityData

  // Check if it's time for a release based on frequency
  if (!isReleaseTime(policy)) {
    return
  }

  // Get next authorized chapter from queue
  const queueResult = await sdk.entities.query<ReleaseQueueItem>({
    collection: 'ReleaseQueue',
    filters: { status: 'queued' },
    sort: [{ field: 'queue_position', direction: 'asc' }],
    limit: 1
  })

  if (queueResult.data.length === 0) {
    console.log('[smart-publisher] No chapters in queue')
    return
  }

  const item = queueResult.data[0]!
  const queueData = item.entityData

  // Only release authorized chapters
  if (!queueData.authorized_at) {
    console.log('[smart-publisher] Next chapter not authorized yet')
    return
  }

  // Mark as releasing
  await sdk.entities.update('ReleaseQueue', item.id, {
    status: 'releasing'
  })

  try {
    // Publish the chapter
    await sdk.publishing.publishChapter(projectId, queueData.chapter_id, {
      accessLevel: 'public'
    })

    // Create tier-based embargoes if configured
    if (policy.tier_delays && policy.tier_delays.length > 0) {
      const now = new Date()
      const tierSchedules = policy.tier_delays.map(td => ({
        tierId: String(td.tierLevel), // Will be resolved by the API
        releaseDate: new Date(now.getTime() + td.delayDays * 24 * 60 * 60 * 1000).toISOString()
      }))

      await sdk.publishing.createEmbargo(projectId, queueData.chapter_id, tierSchedules)
    }

    // Mark as released
    await sdk.entities.update('ReleaseQueue', item.id, {
      status: 'released'
    })

    console.log(`[smart-publisher] Released chapter ${queueData.chapter_id}`)
  } catch (err) {
    // Revert to queued on failure
    await sdk.entities.update('ReleaseQueue', item.id, {
      status: 'queued'
    })
    console.error('[smart-publisher] Release failed:', err)
    throw err
  }
}

/**
 * Check if current time matches the release schedule.
 */
function isReleaseTime(policy: ReleasePolicyConfig['entityData']): boolean {
  const now = new Date()
  const dayOfWeek = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][now.getUTCDay()]
  const timeStr = `${String(now.getUTCHours()).padStart(2, '0')}:${String(now.getUTCMinutes()).padStart(2, '0')}`

  // Check time window (within 15 min of release time since cron runs every 15 min)
  if (policy.release_time) {
    const [releaseHour, releaseMin] = policy.release_time.split(':').map(Number)
    const currentMinutes = now.getUTCHours() * 60 + now.getUTCMinutes()
    const releaseMinutes = (releaseHour || 0) * 60 + (releaseMin || 0)
    if (Math.abs(currentMinutes - releaseMinutes) > 15) {
      return false
    }
  }

  switch (policy.release_frequency) {
    case 'daily':
      return true
    case 'weekly':
      return !policy.release_day || dayOfWeek === policy.release_day
    case 'biweekly': {
      // Release on the configured day, every other week
      if (policy.release_day && dayOfWeek !== policy.release_day) return false
      const weekNumber = Math.floor(now.getTime() / (7 * 24 * 60 * 60 * 1000))
      return weekNumber % 2 === 0
    }
    case 'monthly':
      return now.getUTCDate() === 1 // First of the month
    default:
      return false
  }
}

export default { processReleases }
