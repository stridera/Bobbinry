/**
 * IndexedDB Schema using Dexie
 *
 * Local-first storage for offline editing with optimistic updates
 */

import Dexie, { type Table } from 'dexie'

// Entity stored locally
export interface LocalEntity {
  id: string
  projectId: string
  bobbinId: string
  collectionName: string
  data: Record<string, any>

  // Metadata
  createdAt: string
  updatedAt: string
  syncedAt?: string

  // Sync status
  syncStatus: 'synced' | 'pending' | 'conflict' | 'error'
  version: number
  lastError?: string
}

// Pending operation to sync to server
export interface PendingOperation {
  id: string
  timestamp: number
  projectId: string
  type: 'create' | 'update' | 'delete'

  // Entity reference
  entityId: string
  collectionName: string
  bobbinId: string

  // Operation data
  data?: Record<string, any>

  // Retry tracking
  attempts: number
  lastAttempt?: number
  error?: string
  status: 'pending' | 'in_progress' | 'failed' | 'completed'
}

// Project metadata cached locally
export interface LocalProject {
  id: string
  name: string
  description?: string
  ownerId: string

  // Cache metadata
  cachedAt: number
  lastSyncedAt?: number
}

// Installed bobbin metadata
export interface LocalBobbin {
  id: string
  projectId: string
  bobbinId: string
  version: string
  manifest: any
  installedAt: string

  // Cache metadata
  cachedAt: number
}

// Sync metadata for tracking last sync times
export interface SyncMetadata {
  key: string // e.g., "project:550e8400:entities:books"
  lastSyncedAt: number
  etag?: string
}

export class BobbinryDB extends Dexie {
  // Tables
  entities!: Table<LocalEntity, string>
  operations!: Table<PendingOperation, string>
  projects!: Table<LocalProject, string>
  bobbins!: Table<LocalBobbin, string>
  syncMetadata!: Table<SyncMetadata, string>

  constructor() {
    super('bobbinry')

    this.version(1).stores({
      // Entities indexed by id, projectId+collection, and syncStatus
      entities: 'id, [projectId+collectionName], syncStatus, updatedAt',

      // Operations indexed by id, status, and timestamp
      operations: 'id, status, timestamp, [projectId+collectionName]',

      // Projects indexed by id
      projects: 'id, cachedAt',

      // Bobbins indexed by id and projectId
      bobbins: 'id, [projectId+bobbinId]',

      // Sync metadata indexed by key
      syncMetadata: 'key, lastSyncedAt'
    })
  }
}

// Singleton instance
export const db = new BobbinryDB()

// Helper functions for common operations
export async function clearAllData() {
  await Promise.all([
    db.entities.clear(),
    db.operations.clear(),
    db.projects.clear(),
    db.bobbins.clear(),
    db.syncMetadata.clear()
  ])
}

export async function getProjectData(projectId: string) {
  const [project, bobbins, entities] = await Promise.all([
    db.projects.get(projectId),
    db.bobbins.where({ projectId }).toArray(),
    db.entities.where({ projectId }).toArray()
  ])

  return { project, bobbins, entities }
}

export async function getPendingOperations(limit = 50) {
  return db.operations
    .where('status')
    .equals('pending')
    .or('status')
    .equals('failed')
    .limit(limit)
    .toArray()
}
