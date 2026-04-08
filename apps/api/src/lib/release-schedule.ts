import { and, eq, isNotNull, inArray, sql } from 'drizzle-orm'
import { db } from '../db/connection'
import { chapterPublications, entities, projectPublishConfig, projects, subscriptionTiers } from '../db/schema'

const DAY_MS = 24 * 60 * 60 * 1000
const DEFAULT_RELEASE_TIME = '12:00'

const DAY_ALIASES: Record<string, number> = {
  sun: 0,
  sunday: 0,
  mon: 1,
  monday: 1,
  tue: 2,
  tues: 2,
  tuesday: 2,
  wed: 3,
  wednesday: 3,
  thu: 4,
  thur: 4,
  thurs: 4,
  thursday: 4,
  fri: 5,
  friday: 5,
  sat: 6,
  saturday: 6,
}

export interface ProjectReleaseSchedule {
  autoReleaseEnabled: boolean
  releaseFrequency: string
  releaseDays: number[]
  releaseTime: string
}

export function addDays(date: Date, days: number): Date {
  const next = new Date(date)
  next.setDate(next.getDate() + days)
  return next
}

function parseReleaseTime(value?: string | null): { hour: number; minute: number } {
  const [hourText = '12', minuteText = '00'] = (value || DEFAULT_RELEASE_TIME).split(':')
  const hour = Number.parseInt(hourText, 10)
  const minute = Number.parseInt(minuteText, 10)

  return {
    hour: Number.isFinite(hour) ? Math.min(Math.max(hour, 0), 23) : 12,
    minute: Number.isFinite(minute) ? Math.min(Math.max(minute, 0), 59) : 0,
  }
}

function normalizeReleaseDays(value?: string | null): number[] {
  if (!value) {
    return [1]
  }

  const days = value
    .split(',')
    .map((part) => part.trim().toLowerCase())
    .map((part) => DAY_ALIASES[part])
    .filter((day): day is number => Number.isInteger(day))

  return days.length > 0 ? [...new Set(days)].sort((a, b) => a - b) : [1]
}

function isMatchingCadence(date: Date, schedule: ProjectReleaseSchedule): boolean {
  switch (schedule.releaseFrequency) {
    case 'daily':
      return true
    case 'weekly':
      return schedule.releaseDays.includes(date.getUTCDay())
    case 'biweekly': {
      const weekIndex = Math.floor(date.getTime() / (7 * DAY_MS))
      return schedule.releaseDays.includes(date.getUTCDay()) && weekIndex % 2 === 0
    }
    case 'monthly':
      return date.getUTCDate() === 1
    default:
      return false
  }
}

function slotKey(date: Date): string {
  return date.toISOString().slice(0, 16)
}

function nextMatchingSlot(after: Date, schedule: ProjectReleaseSchedule): Date | null {
  const { hour, minute } = parseReleaseTime(schedule.releaseTime)
  let candidate = new Date(Date.UTC(
    after.getUTCFullYear(),
    after.getUTCMonth(),
    after.getUTCDate(),
    hour,
    minute,
    0,
    0
  ))

  if (candidate.getTime() <= after.getTime()) {
    candidate = new Date(candidate.getTime() + DAY_MS)
  }

  for (let index = 0; index < 730; index += 1) {
    if (isMatchingCadence(candidate, schedule)) {
      return candidate
    }
    candidate = new Date(candidate.getTime() + DAY_MS)
  }

  return null
}

export async function getProjectMaxEarlyAccessDays(projectId: string): Promise<{ maxEarlyAccessDays: number }> {
  const [project] = await db
    .select({ ownerId: projects.ownerId })
    .from(projects)
    .where(eq(projects.id, projectId))
    .limit(1)

  if (!project) {
    return { maxEarlyAccessDays: 0 }
  }

  const tiers = await db
    .select({ earlyAccessDays: subscriptionTiers.earlyAccessDays })
    .from(subscriptionTiers)
    .where(and(
      eq(subscriptionTiers.authorId, project.ownerId as any),
      eq(subscriptionTiers.isActive, true)
    ))

  return {
    maxEarlyAccessDays: tiers.reduce((max, tier) => Math.max(max, tier.earlyAccessDays ?? 0), 0)
  }
}

/** @deprecated Use getProjectMaxEarlyAccessDays — kept for backward compat during migration */
export async function getProjectTierDelayInfo(projectId: string): Promise<{ maxDelayDays: number }> {
  const { maxEarlyAccessDays } = await getProjectMaxEarlyAccessDays(projectId)
  return { maxDelayDays: maxEarlyAccessDays }
}

export async function getProjectReleaseSchedule(projectId: string): Promise<ProjectReleaseSchedule | null> {
  const [config] = await db
    .select({
      autoReleaseEnabled: projectPublishConfig.autoReleaseEnabled,
      releaseFrequency: projectPublishConfig.releaseFrequency,
      releaseDay: projectPublishConfig.releaseDay,
      releaseTime: projectPublishConfig.releaseTime,
    })
    .from(projectPublishConfig)
    .where(eq(projectPublishConfig.projectId, projectId))
    .limit(1)

  if (!config) {
    return null
  }

  return {
    autoReleaseEnabled: config.autoReleaseEnabled,
    releaseFrequency: config.releaseFrequency || 'manual',
    releaseDays: normalizeReleaseDays(config.releaseDay),
    releaseTime: config.releaseTime || DEFAULT_RELEASE_TIME,
  }
}

export async function getNextAvailableReleaseSlot(
  projectId: string,
  options: { after?: Date; excludeChapterId?: string } = {}
): Promise<Date | null> {
  const schedule = await getProjectReleaseSchedule(projectId)
  if (!schedule || !schedule.autoReleaseEnabled || schedule.releaseFrequency === 'manual') {
    return null
  }

  const occupiedRows = await db
    .select({
      chapterId: chapterPublications.chapterId,
      publishedAt: chapterPublications.publishedAt,
    })
    .from(chapterPublications)
    .where(and(
      eq(chapterPublications.projectId, projectId),
      eq(chapterPublications.publishStatus, 'scheduled'),
      isNotNull(chapterPublications.publishedAt)
    ))

  const occupiedSlots = new Set(
    occupiedRows
      .filter((row) => row.chapterId !== options.excludeChapterId)
      .map((row) => row.publishedAt)
      .filter((value): value is Date => value instanceof Date)
      .map(slotKey)
  )

  let cursor = options.after || new Date()

  for (let index = 0; index < 730; index += 1) {
    const candidate = nextMatchingSlot(cursor, schedule)
    if (!candidate) {
      return null
    }

    if (!occupiedSlots.has(slotKey(candidate))) {
      return candidate
    }

    cursor = new Date(candidate.getTime() + 60 * 1000)
  }

  return null
}

export async function upsertScheduledChapterPublication(
  projectId: string,
  chapterId: string,
  scheduledAt: Date,
  publishedVersion = '1.0'
) {
  const publicReleaseDate = scheduledAt // public release = scheduled date

  const [existing] = await db
    .select()
    .from(chapterPublications)
    .where(and(
      eq(chapterPublications.projectId, projectId),
      eq(chapterPublications.chapterId, chapterId)
    ))
    .limit(1)

  if (existing) {
    const [updated] = await db
      .update(chapterPublications)
      .set({
        publishStatus: 'scheduled',
        isPublished: true,
        publishedVersion,
        publishedAt: scheduledAt,
        publicReleaseDate,
        updatedAt: new Date(),
      })
      .where(eq(chapterPublications.id, existing.id))
      .returning()

    return updated
  }

  const [created] = await db
    .insert(chapterPublications)
    .values({
      projectId,
      chapterId,
      publishStatus: 'scheduled',
      isPublished: true,
      publishedVersion,
      publishedAt: scheduledAt,
      publicReleaseDate,
      firstPublishedAt: scheduledAt,
    })
    .returning()

  return created
}

export async function shiftFollowingScheduledChaptersUp(
  projectId: string,
  vacatedSlot: Date,
  options: { excludeChapterId?: string } = {}
) {
  const scheduledRows = await db
    .select({
      id: chapterPublications.id,
      chapterId: chapterPublications.chapterId,
      publishedAt: chapterPublications.publishedAt,
    })
    .from(chapterPublications)
    .where(and(
      eq(chapterPublications.projectId, projectId),
      eq(chapterPublications.publishStatus, 'scheduled'),
      isNotNull(chapterPublications.publishedAt)
    ))

  const laterRows = scheduledRows
    .filter((row) => row.chapterId !== options.excludeChapterId)
    .filter((row): row is typeof row & { publishedAt: Date } => row.publishedAt instanceof Date)
    .filter((row) => row.publishedAt.getTime() > vacatedSlot.getTime())
    .sort((a, b) => a.publishedAt.getTime() - b.publishedAt.getTime())

  let nextSlot = vacatedSlot

  for (const row of laterRows) {
    const currentSlot = row.publishedAt
    await db
      .update(chapterPublications)
      .set({
        publishedAt: nextSlot,
        publicReleaseDate: nextSlot,
        updatedAt: new Date(),
      })
      .where(eq(chapterPublications.id, row.id))

    nextSlot = currentSlot
  }
}

/**
 * Ensure scheduled chapter dates follow entity (manuscript) order.
 *
 * After any auto-scheduling action, call this to guarantee that earlier
 * chapters (by entity order) are scheduled before later ones. If the
 * dates already match entity order, this is a no-op.
 */
export async function reorderScheduleByEntityOrder(projectId: string): Promise<void> {
  const rows = await db
    .select({
      pubId: chapterPublications.id,
      chapterId: chapterPublications.chapterId,
      publishedAt: chapterPublications.publishedAt,
      entityOrder: sql<number>`COALESCE((${entities.entityData}->>'order')::bigint, 999999)`,
    })
    .from(chapterPublications)
    .innerJoin(entities, eq(entities.id, chapterPublications.chapterId))
    .where(and(
      eq(chapterPublications.projectId, projectId),
      eq(chapterPublications.publishStatus, 'scheduled'),
      isNotNull(chapterPublications.publishedAt)
    ))

  if (rows.length < 2) return

  // Sort by entity order to get desired sequence
  const byEntityOrder = [...rows].sort((a, b) => Number(a.entityOrder) - Number(b.entityOrder))

  // Sort dates chronologically
  const datesSorted = rows
    .map((r) => r.publishedAt)
    .filter((d): d is Date => d instanceof Date)
    .sort((a, b) => a.getTime() - b.getTime())

  if (datesSorted.length !== byEntityOrder.length) return

  // Check if already in order — skip DB writes if so
  let alreadyOrdered = true
  for (let i = 0; i < byEntityOrder.length; i++) {
    const currentDate = byEntityOrder[i]!.publishedAt
    if (!(currentDate instanceof Date) || currentDate.getTime() !== datesSorted[i]!.getTime()) {
      alreadyOrdered = false
      break
    }
  }
  if (alreadyOrdered) return

  // Reassign: first chapter by entity order gets earliest date, etc.
  for (let i = 0; i < byEntityOrder.length; i++) {
    const row = byEntityOrder[i]!
    const newDate = datesSorted[i]!
    const currentDate = row.publishedAt

    if (currentDate instanceof Date && currentDate.getTime() === newDate.getTime()) continue

    await db
      .update(chapterPublications)
      .set({
        publishedAt: newDate,
        publicReleaseDate: newDate,
        updatedAt: new Date(),
      })
      .where(eq(chapterPublications.id, row.pubId))
  }
}

/**
 * Check whether a chapter fills a gap between already-published chapters
 * and should be auto-published immediately instead of scheduled.
 *
 * Only considers chapters that are in the publishing pipeline
 * (published, scheduled, or complete). Draft chapters and non-pipeline
 * entities (notes, old drafts) are ignored.
 */
export async function shouldAutoPublishAsGapFill(
  projectId: string,
  chapterId: string
): Promise<boolean> {
  // Get this chapter's entity order
  const [thisEntity] = await db
    .select({
      id: entities.id,
      entityOrder: sql<number>`COALESCE((${entities.entityData}->>'order')::bigint, 999999)`,
    })
    .from(entities)
    .where(eq(entities.id, chapterId))
    .limit(1)

  if (!thisEntity) return false

  // Get all pipeline chapters (published/scheduled/complete) for the project, with entity order
  const pipelineStatuses = ['published', 'scheduled', 'complete']
  const pipelineChapters = await db
    .select({
      chapterId: chapterPublications.chapterId,
      publishStatus: chapterPublications.publishStatus,
      entityOrder: sql<number>`COALESCE((${entities.entityData}->>'order')::bigint, 999999)`,
    })
    .from(chapterPublications)
    .innerJoin(entities, eq(entities.id, chapterPublications.chapterId))
    .where(and(
      eq(chapterPublications.projectId, projectId),
      inArray(chapterPublications.publishStatus, pipelineStatuses)
    ))
    .orderBy(sql`COALESCE((${entities.entityData}->>'order')::bigint, 999999)`)

  // Find this chapter's position in the sorted pipeline
  const thisOrder = Number(thisEntity.entityOrder)
  const others = pipelineChapters.filter((c) => c.chapterId !== chapterId)

  if (others.length === 0) return false

  // Find immediate neighbors by entity order
  let prev: typeof others[number] | null = null
  let next: typeof others[number] | null = null

  for (const ch of others) {
    const order = Number(ch.entityOrder)
    if (order < thisOrder) {
      prev = ch
    } else if (order > thisOrder && !next) {
      next = ch
    }
  }

  // Both neighbors published → gap fill
  if (prev?.publishStatus === 'published' && next?.publishStatus === 'published') {
    return true
  }

  // At the start of the manuscript and next neighbor is published → gap fill
  if (!prev && next?.publishStatus === 'published') {
    return true
  }

  return false
}
