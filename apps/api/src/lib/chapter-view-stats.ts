/**
 * Per-chapter reading statistics, derived from chapter_views.
 *
 * chapter_publications carries unique_view_count, completion_count and
 * avg_read_time_seconds columns that look authoritative but are not:
 * unique_view_count and avg_read_time_seconds are never written by anything,
 * and completion_count is only incremented by the legacy
 * PATCH /views/:viewId endpoint, which the reader page does not call — it
 * writes completed_at on chapter_views instead. Reading those columns
 * therefore yields zeros and undercounts.
 *
 * chapter_views is the source of truth, so anything reporting these numbers
 * should join this subquery rather than trust the stored counters. Kept in one
 * place so the definitions can't drift between callers.
 *
 * Note: view_count on chapter_publications IS maintained (reader.ts increments
 * it on each new view) and is fine to read directly.
 */

import { sql } from 'drizzle-orm'
import { db } from '../db/connection'
import { chapterViews } from '../db/schema'

/**
 * Aliased as `view_stats`, keyed by `chapter_id`. Join with:
 *   .leftJoin(chapterViewStats, sql`${sql.raw('view_stats.chapter_id')} = ...`)
 * and read `view_stats.unique_viewers` / `.completions` / `.avg_read_seconds`.
 */
export const chapterViewStats = db
  .select({
    chapterId: chapterViews.chapterId,
    /**
     * Distinct viewers, anonymous sessions included. Deliberately broader than
     * the `uniqueReaders` field on GET /chapters/:chapterId/analytics, which
     * counts signed-in readers only — most reader traffic is anonymous, so a
     * signed-in-only count would read as near-zero.
     */
    uniqueViewers: sql<number>`COUNT(DISTINCT COALESCE(${chapterViews.readerId}::text, ${chapterViews.sessionId}))`.as('unique_viewers'),
    completions: sql<number>`COUNT(${chapterViews.completedAt})`.as('completions'),
    /**
     * Averaged across every view, including those with zero recorded read time,
     * to match totalReadTime / views.length on the single-chapter endpoint.
     */
    avgReadSeconds: sql<number>`COALESCE(ROUND(AVG(${chapterViews.readTimeSeconds})), 0)`.as('avg_read_seconds'),
  })
  .from(chapterViews)
  .groupBy(chapterViews.chapterId)
  .as('view_stats')
