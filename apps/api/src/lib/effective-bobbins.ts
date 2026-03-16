/**
 * Scope Resolution Library
 *
 * Resolves all bobbins visible from a project context across three scopes:
 * - project: installed directly on the project
 * - collection: installed on a collection the project belongs to
 * - global: installed at the user level
 *
 * Priority order: project > collection > global (deduplication).
 */

import { db } from '../db/connection'
import { bobbinsInstalled, projectCollectionMemberships, entities } from '../db/schema'
import { eq, and, inArray, or, type SQL } from 'drizzle-orm'

export interface EffectiveBobbin {
  bobbinId: string
  scope: 'project' | 'collection' | 'global'
  scopeOwnerId: string // projectId, collectionId, or userId depending on scope
  enabled: boolean
}

/**
 * Find which collections a project belongs to.
 */
export async function getCollectionIdsForProject(projectId: string): Promise<string[]> {
  const rows = await db
    .select({ collectionId: projectCollectionMemberships.collectionId })
    .from(projectCollectionMemberships)
    .where(eq(projectCollectionMemberships.projectId, projectId))

  return rows.map(r => r.collectionId)
}

/**
 * Returns all bobbins visible from a project context, deduplicated with
 * project > collection > global priority.
 */
export async function getEffectiveBobbins(
  projectId: string,
  userId: string
): Promise<EffectiveBobbin[]> {
  // 1. Project-scoped
  const projectBobbins = await db
    .select()
    .from(bobbinsInstalled)
    .where(and(
      eq(bobbinsInstalled.projectId, projectId),
      eq(bobbinsInstalled.scope, 'project'),
      eq(bobbinsInstalled.enabled, true)
    ))

  const seen = new Set<string>()
  const result: EffectiveBobbin[] = []

  for (const row of projectBobbins) {
    seen.add(row.bobbinId)
    result.push({
      bobbinId: row.bobbinId,
      scope: 'project',
      scopeOwnerId: projectId,
      enabled: row.enabled,
    })
  }

  // 2. Collection-scoped
  const collectionIds = await getCollectionIdsForProject(projectId)

  if (collectionIds.length > 0) {
    const collectionBobbins = await db
      .select()
      .from(bobbinsInstalled)
      .where(and(
        inArray(bobbinsInstalled.collectionId, collectionIds),
        eq(bobbinsInstalled.scope, 'collection'),
        eq(bobbinsInstalled.enabled, true)
      ))

    for (const row of collectionBobbins) {
      if (seen.has(row.bobbinId)) continue
      seen.add(row.bobbinId)
      result.push({
        bobbinId: row.bobbinId,
        scope: 'collection',
        scopeOwnerId: row.collectionId!,
        enabled: row.enabled,
      })
    }
  }

  // 3. Global-scoped
  const globalBobbins = await db
    .select()
    .from(bobbinsInstalled)
    .where(and(
      eq(bobbinsInstalled.userId, userId),
      eq(bobbinsInstalled.scope, 'global'),
      eq(bobbinsInstalled.enabled, true)
    ))

  for (const row of globalBobbins) {
    if (seen.has(row.bobbinId)) continue
    seen.add(row.bobbinId)
    result.push({
      bobbinId: row.bobbinId,
      scope: 'global',
      scopeOwnerId: userId,
      enabled: row.enabled,
    })
  }

  return result
}

/**
 * Build a Drizzle SQL condition that matches entities visible from a project context:
 * project-scoped OR collection-scoped OR global-scoped.
 */
export function buildScopeCondition(
  projectId: string,
  collectionIds: string[],
  userId: string
): SQL {
  const conditions: SQL[] = [
    eq(entities.projectId, projectId),
  ]

  if (collectionIds.length > 0) {
    conditions.push(inArray(entities.collectionId, collectionIds))
  }

  conditions.push(eq(entities.userId, userId))

  return or(...conditions)!
}
