import { db } from '../db/connection'
import {
  projects,
  projectPublishConfig,
  bobbinsInstalled,
  userProfiles,
  chapterAnnotations,
  entities
} from '../db/schema'
import { eq, and, sql } from 'drizzle-orm'
import { loadDiskManifests } from './disk-manifests'
import { getCollectionIdsForProject, buildScopeCondition } from './effective-bobbins'

export interface SummaryBobbin {
  id: string
  bobbinId: string
  version: string
  manifest: {
    name: string
    description: string
    icon: string | undefined
    /** Owns a `shell.leftPanel` contribution: a project-wide workspace. */
    hasLeftPanel: boolean
    core: boolean
    /** Declared via `capabilities.annotationInbox`; owns the feedback inbox. */
    annotationInbox: boolean
  }
}

export interface AnnotationStats {
  open: number
  acknowledged: number
  resolved: number
  dismissed: number
  total: number
}

export interface ProjectSummary {
  project: typeof projects.$inferSelect
  /** Publish config row, or the defaults when the project has never been configured. */
  config: Record<string, any>
  bobbins: SummaryBobbin[]
  /** bobbinId → entity count within the project's visibility scope. */
  bobbinStats: Record<string, number>
  annotationStats: AnnotationStats
  authorUsername: string | null
}

export const DEFAULT_PUBLISH_CONFIG = (projectId: string) => ({
  projectId,
  publishingMode: 'draft',
  defaultVisibility: 'public',
  autoReleaseEnabled: false,
  releaseFrequency: 'manual',
  enableComments: true,
  enableReactions: true,
  moderationMode: 'open'
})

/**
 * Everything a project page's header needs: identity, publish state, the
 * installed-bobbin projection with per-bobbin counts, and the annotation
 * totals. Shared by the dashboard aggregate and the lighter summary route
 * the secondary project pages use, so the two can never disagree.
 *
 * Returns null when the project does not exist.
 */
export async function loadProjectSummary(projectId: string, userId: string): Promise<ProjectSummary | null> {
  // Entity visibility scope for the bobbin counts: project-scoped rows, plus
  // collection-scoped rows from collections this project belongs to, plus the
  // owner's global entities — the same scope the entity views use, so the
  // counts match what opening a bobbin shows.
  const scopeCollectionIds = await getCollectionIdsForProject(projectId)
  const entityScopeFilter = buildScopeCondition(projectId, scopeCollectionIds, userId)

  const [
    projectResult,
    configResult,
    bobbinsResult,
    authorProfileResult,
    annotationStatsResult,
    bobbinStatsResult
  ] = await Promise.all([
    db
      .select()
      .from(projects)
      .where(eq(projects.id, projectId))
      .limit(1),

    db
      .select()
      .from(projectPublishConfig)
      .where(eq(projectPublishConfig.projectId, projectId))
      .limit(1),

    db
      .select({
        id: bobbinsInstalled.id,
        bobbinId: bobbinsInstalled.bobbinId,
        version: bobbinsInstalled.version,
      })
      .from(bobbinsInstalled)
      .where(eq(bobbinsInstalled.projectId, projectId)),

    db
      .select({ username: userProfiles.username })
      .from(userProfiles)
      .where(eq(userProfiles.userId, userId))
      .limit(1),

    db
      .select({
        status: chapterAnnotations.status,
        count: sql<number>`count(*)::int`.as('count')
      })
      .from(chapterAnnotations)
      .where(eq(chapterAnnotations.projectId, projectId))
      .groupBy(chapterAnnotations.status),

    // Excludes entity_type_definitions and shared_templates so schema and
    // template rows don't get counted as content (matches the precedent in
    // dashboard.ts).
    db
      .select({
        bobbinId: entities.bobbinId,
        count: sql<number>`count(*)::int`.as('count')
      })
      .from(entities)
      .where(and(
        entityScopeFilter,
        sql`${entities.collectionName} NOT IN ('entity_type_definitions', 'shared_templates')`
      ))
      .groupBy(entities.bobbinId)
  ])

  const project = projectResult[0]
  if (!project) return null

  const config = configResult[0] || DEFAULT_PUBLISH_CONFIG(projectId)

  // Disk manifests are the source of truth for what a bobbin contributes.
  const diskManifests = await loadDiskManifests(bobbinsResult.map(b => b.bobbinId))
  const bobbins: SummaryBobbin[] = bobbinsResult.map(b => {
    const manifest = diskManifests.get(b.bobbinId) as Record<string, any> | undefined
    const rawContributions = manifest?.extensions?.contributions
    const contributions = Array.isArray(rawContributions)
      ? rawContributions as Array<{ slot?: string }>
      : []
    return {
      id: b.id,
      bobbinId: b.bobbinId,
      version: b.version,
      manifest: {
        name: manifest?.name || b.bobbinId,
        description: manifest?.description || '',
        icon: typeof manifest?.icon === 'string' ? manifest.icon : undefined,
        hasLeftPanel: contributions.some(c => c?.slot === 'shell.leftPanel'),
        core: manifest?.core === true,
        annotationInbox: manifest?.capabilities?.annotationInbox === true
      }
    }
  })

  const bobbinStats: Record<string, number> = {}
  for (const row of bobbinStatsResult) {
    bobbinStats[row.bobbinId] = row.count
  }

  const annotationStats: AnnotationStats = { open: 0, acknowledged: 0, resolved: 0, dismissed: 0, total: 0 }
  for (const row of annotationStatsResult) {
    const key = row.status as keyof AnnotationStats
    if (key in annotationStats) annotationStats[key] = row.count
    annotationStats.total += row.count
  }

  return {
    project,
    config,
    bobbins,
    bobbinStats,
    annotationStats,
    authorUsername: authorProfileResult[0]?.username || null
  }
}
