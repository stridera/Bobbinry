/**
 * Offline Storage Service
 *
 * Provides offline-first CRUD operations with optimistic updates
 */

import { db, type LocalEntity, type PendingOperation } from './db'

export interface EntityQuery {
  collection: string
  projectId: string
  limit?: number
  offset?: number
  search?: string
}

export interface Entity {
  id: string
  [key: string]: any
  _meta?: {
    bobbinId: string
    collection: string
    createdAt: string
    updatedAt: string
    syncStatus?: 'synced' | 'pending' | 'conflict' | 'error'
  }
}

export class OfflineStorage {
  /**
   * Query entities from local storage
   */
  async queryEntities(query: EntityQuery): Promise<{ entities: Entity[]; total: number }> {
    const { collection, projectId, limit = 50, offset = 0, search } = query

    let results = await db.entities
      .where('[projectId+collectionName]')
      .equals([projectId, collection])
      .toArray()

    // Apply search filter if provided
    if (search) {
      const searchLower = search.toLowerCase()
      results = results.filter(entity => {
        const dataStr = JSON.stringify(entity.data).toLowerCase()
        return dataStr.includes(searchLower)
      })
    }

    // Sort by updated time (most recent first)
    results.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())

    // Apply pagination
    const paginated = results.slice(offset, offset + limit)

    // Transform to Entity format
    const entities: Entity[] = paginated.map(local => ({
      id: local.id,
      ...local.data,
      _meta: {
        bobbinId: local.bobbinId,
        collection: local.collectionName,
        createdAt: local.createdAt,
        updatedAt: local.updatedAt,
        syncStatus: local.syncStatus
      }
    }))

    return { entities, total: results.length }
  }

  /**
   * Get a single entity by ID
   */
  async getEntity(entityId: string, collection: string, projectId: string): Promise<Entity | null> {
    const local = await db.entities.get(entityId)

    if (!local || local.projectId !== projectId || local.collectionName !== collection) {
      return null
    }

    return {
      id: local.id,
      ...local.data,
      _meta: {
        bobbinId: local.bobbinId,
        collection: local.collectionName,
        createdAt: local.createdAt,
        updatedAt: local.updatedAt,
        syncStatus: local.syncStatus
      }
    }
  }

  /**
   * Create entity with optimistic update
   */
  async createEntity(
    collection: string,
    projectId: string,
    bobbinId: string,
    data: Record<string, any>
  ): Promise<Entity> {
    const now = new Date().toISOString()
    const entityId = crypto.randomUUID()

    const localEntity: LocalEntity = {
      id: entityId,
      projectId,
      bobbinId,
      collectionName: collection,
      data,
      createdAt: now,
      updatedAt: now,
      syncStatus: 'pending',
      version: 1
    }

    // Save to local storage
    await db.entities.add(localEntity)

    // Queue operation for sync
    const operation: PendingOperation = {
      id: crypto.randomUUID(),
      timestamp: Date.now(),
      projectId,
      type: 'create',
      entityId,
      collectionName: collection,
      bobbinId,
      data,
      attempts: 0,
      status: 'pending'
    }

    await db.operations.add(operation)

    return {
      id: entityId,
      ...data,
      _meta: {
        bobbinId,
        collection,
        createdAt: now,
        updatedAt: now,
        syncStatus: 'pending'
      }
    }
  }

  /**
   * Update entity with optimistic update
   */
  async updateEntity(
    entityId: string,
    collection: string,
    projectId: string,
    data: Record<string, any>
  ): Promise<Entity> {
    const existing = await db.entities.get(entityId)

    if (!existing || existing.projectId !== projectId || existing.collectionName !== collection) {
      throw new Error('Entity not found')
    }

    const now = new Date().toISOString()

    // Update local storage
    await db.entities.update(entityId, {
      data,
      updatedAt: now,
      syncStatus: 'pending',
      version: existing.version + 1
    })

    // Queue operation for sync
    const operation: PendingOperation = {
      id: crypto.randomUUID(),
      timestamp: Date.now(),
      projectId,
      type: 'update',
      entityId,
      collectionName: collection,
      bobbinId: existing.bobbinId,
      data,
      attempts: 0,
      status: 'pending'
    }

    await db.operations.add(operation)

    return {
      id: entityId,
      ...data,
      _meta: {
        bobbinId: existing.bobbinId,
        collection,
        createdAt: existing.createdAt,
        updatedAt: now,
        syncStatus: 'pending'
      }
    }
  }

  /**
   * Delete entity with optimistic update
   */
  async deleteEntity(entityId: string, collection: string, projectId: string): Promise<void> {
    const existing = await db.entities.get(entityId)

    if (!existing || existing.projectId !== projectId || existing.collectionName !== collection) {
      throw new Error('Entity not found')
    }

    // Remove from local storage immediately (optimistic delete)
    await db.entities.delete(entityId)

    // Queue operation for sync
    const operation: PendingOperation = {
      id: crypto.randomUUID(),
      timestamp: Date.now(),
      projectId,
      type: 'delete',
      entityId,
      collectionName: collection,
      bobbinId: existing.bobbinId,
      attempts: 0,
      status: 'pending'
    }

    await db.operations.add(operation)
  }

  /**
   * Cache entities from server response
   */
  async cacheEntities(
    projectId: string,
    collection: string,
    bobbinId: string,
    serverEntities: any[]
  ): Promise<void> {
    const now = new Date().toISOString()

    const localEntities: LocalEntity[] = serverEntities.map(entity => ({
      id: entity.id,
      projectId,
      bobbinId,
      collectionName: collection,
      data: entity,
      createdAt: entity._meta?.createdAt || now,
      updatedAt: entity._meta?.updatedAt || now,
      syncedAt: now,
      syncStatus: 'synced',
      version: 1
    }))

    // Bulk insert/update
    await db.entities.bulkPut(localEntities)

    // Update sync metadata
    await db.syncMetadata.put({
      key: `${projectId}:${collection}`,
      lastSyncedAt: Date.now()
    })
  }

  /**
   * Check if data is stale and needs refresh
   */
  async isStale(projectId: string, collection: string, maxAge = 5 * 60 * 1000): Promise<boolean> {
    const metadata = await db.syncMetadata.get(`${projectId}:${collection}`)

    if (!metadata) return true

    return Date.now() - metadata.lastSyncedAt > maxAge
  }

  /**
   * Get pending sync count
   */
  async getPendingSyncCount(): Promise<number> {
    return db.operations.where('status').equals('pending').count()
  }
}

// Singleton instance
export const offlineStorage = new OfflineStorage()
