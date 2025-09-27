// Offline-first IndexedDB storage for Bobbinry Shell
// Provides offline caching, optimistic updates, and conflict resolution

export interface OfflineEntity {
  id: string
  projectId: string
  bobbinId: string
  collection: string
  entityId: string
  data: any
  version: number
  lastModified: number
  isDirty: boolean
  conflictStatus?: 'none' | 'pending' | 'resolved'
}

export interface PendingChange {
  id: string
  entityRef: string
  operation: 'create' | 'update' | 'delete'
  data: any
  timestamp: number
  retryCount: number
  url: string
  method: string
  headers: Record<string, string>
  body?: string
}

export interface CachedTopic {
  id: string
  topic: string
  payload: any
  timestamp: number
  sensitivity: 'low' | 'medium' | 'high'
  delivered: boolean
}

class OfflineStorage {
  private db: IDBDatabase | null = null
  private readonly dbName = 'bobbinry-offline'
  private readonly dbVersion = 1

  async init(): Promise<void> {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(this.dbName, this.dbVersion)

      request.onerror = () => reject(request.error)
      request.onsuccess = () => {
        this.db = request.result
        resolve()
      }

      request.onupgradeneeded = (event) => {
        const db = (event.target as IDBOpenDBRequest).result

        // Entities store - for cached entity data
        if (!db.objectStoreNames.contains('entities')) {
          const entitiesStore = db.createObjectStore('entities', { keyPath: 'id' })
          entitiesStore.createIndex('projectId', 'projectId', { unique: false })
          entitiesStore.createIndex('bobbinId', 'bobbinId', { unique: false })
          entitiesStore.createIndex('collection', 'collection', { unique: false })
          entitiesStore.createIndex('lastModified', 'lastModified', { unique: false })
          entitiesStore.createIndex('isDirty', 'isDirty', { unique: false })
        }

        // Pending changes store - for offline modifications
        if (!db.objectStoreNames.contains('pendingChanges')) {
          const changesStore = db.createObjectStore('pendingChanges', { keyPath: 'id' })
          changesStore.createIndex('entityRef', 'entityRef', { unique: false })
          changesStore.createIndex('timestamp', 'timestamp', { unique: false })
          changesStore.createIndex('retryCount', 'retryCount', { unique: false })
        }

        // Cached topics store - for pub/sub message buffering
        if (!db.objectStoreNames.contains('cachedTopics')) {
          const topicsStore = db.createObjectStore('cachedTopics', { keyPath: 'id' })
          topicsStore.createIndex('topic', 'topic', { unique: false })
          topicsStore.createIndex('timestamp', 'timestamp', { unique: false })
          topicsStore.createIndex('sensitivity', 'sensitivity', { unique: false })
          topicsStore.createIndex('delivered', 'delivered', { unique: false })
        }

        // Offline config store - for bobbin-specific offline settings
        if (!db.objectStoreNames.contains('offlineConfig')) {
          db.createObjectStore('offlineConfig', { keyPath: 'bobbinId' })
        }
      }
    })
  }

  // Entity operations
  async cacheEntity(entity: OfflineEntity): Promise<void> {
    if (!this.db) throw new Error('Database not initialized')

    const transaction = this.db.transaction(['entities'], 'readwrite')
    const store = transaction.objectStore('entities')

    return new Promise((resolve, reject) => {
      const request = store.put(entity)
      request.onsuccess = () => resolve()
      request.onerror = () => reject(request.error)
    })
  }

  async getEntity(entityId: string): Promise<OfflineEntity | null> {
    if (!this.db) throw new Error('Database not initialized')

    const transaction = this.db.transaction(['entities'], 'readonly')
    const store = transaction.objectStore('entities')

    return new Promise((resolve, reject) => {
      const request = store.get(entityId)
      request.onsuccess = () => resolve(request.result || null)
      request.onerror = () => reject(request.error)
    })
  }

  async getEntitiesByCollection(projectId: string, bobbinId: string, collection: string): Promise<OfflineEntity[]> {
    if (!this.db) throw new Error('Database not initialized')

    const transaction = this.db.transaction(['entities'], 'readonly')
    const store = transaction.objectStore('entities')

    return new Promise((resolve, reject) => {
      const entities: OfflineEntity[] = []
      const request = store.openCursor()

      request.onsuccess = (event) => {
        const cursor = (event.target as IDBRequest).result
        if (cursor) {
          const entity = cursor.value as OfflineEntity
          if (entity.projectId === projectId &&
              entity.bobbinId === bobbinId &&
              entity.collection === collection) {
            entities.push(entity)
          }
          cursor.continue()
        } else {
          resolve(entities)
        }
      }

      request.onerror = () => reject(request.error)
    })
  }

  async getDirtyEntities(): Promise<OfflineEntity[]> {
    if (!this.db) throw new Error('Database not initialized')

    const transaction = this.db.transaction(['entities'], 'readonly')
    const store = transaction.objectStore('entities')
    const index = store.index('isDirty')

    return new Promise((resolve, reject) => {
      const request = index.getAll(IDBKeyRange.only(true))
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    })
  }

  async deleteEntity(entityId: string): Promise<void> {
    if (!this.db) throw new Error('Database not initialized')

    const transaction = this.db.transaction(['entities'], 'readwrite')
    const store = transaction.objectStore('entities')

    return new Promise((resolve, reject) => {
      const request = store.delete(entityId)
      request.onsuccess = () => resolve()
      request.onerror = () => reject(request.error)
    })
  }

  // Pending changes operations
  async addPendingChange(change: PendingChange): Promise<void> {
    if (!this.db) throw new Error('Database not initialized')

    const transaction = this.db.transaction(['pendingChanges'], 'readwrite')
    const store = transaction.objectStore('pendingChanges')

    return new Promise((resolve, reject) => {
      const request = store.put(change)
      request.onsuccess = () => resolve()
      request.onerror = () => reject(request.error)
    })
  }

  async getPendingChanges(): Promise<PendingChange[]> {
    if (!this.db) throw new Error('Database not initialized')

    const transaction = this.db.transaction(['pendingChanges'], 'readonly')
    const store = transaction.objectStore('pendingChanges')

    return new Promise((resolve, reject) => {
      const request = store.getAll()
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    })
  }

  async removePendingChange(changeId: string): Promise<void> {
    if (!this.db) throw new Error('Database not initialized')

    const transaction = this.db.transaction(['pendingChanges'], 'readwrite')
    const store = transaction.objectStore('pendingChanges')

    return new Promise((resolve, reject) => {
      const request = store.delete(changeId)
      request.onsuccess = () => resolve()
      request.onerror = () => reject(request.error)
    })
  }

  // Topic caching operations
  async cacheTopic(message: CachedTopic): Promise<void> {
    if (!this.db) throw new Error('Database not initialized')

    const transaction = this.db.transaction(['cachedTopics'], 'readwrite')
    const store = transaction.objectStore('cachedTopics')

    return new Promise((resolve, reject) => {
      const request = store.put(message)
      request.onsuccess = () => resolve()
      request.onerror = () => reject(request.error)
    })
  }

  async getTopicMessages(topic: string, limit = 50): Promise<CachedTopic[]> {
    if (!this.db) throw new Error('Database not initialized')

    const transaction = this.db.transaction(['cachedTopics'], 'readonly')
    const store = transaction.objectStore('cachedTopics')
    const index = store.index('topic')

    return new Promise((resolve, reject) => {
      const messages: CachedTopic[] = []
      let count = 0
      const request = index.openCursor(IDBKeyRange.only(topic))

      request.onsuccess = (event) => {
        const cursor = (event.target as IDBRequest).result
        if (cursor && count < limit) {
          messages.push(cursor.value)
          count++
          cursor.continue()
        } else {
          resolve(messages.sort((a, b) => b.timestamp - a.timestamp))
        }
      }

      request.onerror = () => reject(request.error)
    })
  }

  async markTopicDelivered(messageId: string): Promise<void> {
    if (!this.db) throw new Error('Database not initialized')

    const transaction = this.db.transaction(['cachedTopics'], 'readwrite')
    const store = transaction.objectStore('cachedTopics')

    return new Promise((resolve, reject) => {
      const getRequest = store.get(messageId)
      getRequest.onsuccess = () => {
        const message = getRequest.result
        if (message) {
          message.delivered = true
          const putRequest = store.put(message)
          putRequest.onsuccess = () => resolve()
          putRequest.onerror = () => reject(putRequest.error)
        } else {
          resolve()
        }
      }
      getRequest.onerror = () => reject(getRequest.error)
    })
  }

  // Offline configuration
  async setOfflineConfig(bobbinId: string, config: any): Promise<void> {
    if (!this.db) throw new Error('Database not initialized')

    const transaction = this.db.transaction(['offlineConfig'], 'readwrite')
    const store = transaction.objectStore('offlineConfig')

    return new Promise((resolve, reject) => {
      const request = store.put({ bobbinId, ...config })
      request.onsuccess = () => resolve()
      request.onerror = () => reject(request.error)
    })
  }

  async getOfflineConfig(bobbinId: string): Promise<any> {
    if (!this.db) throw new Error('Database not initialized')

    const transaction = this.db.transaction(['offlineConfig'], 'readonly')
    const store = transaction.objectStore('offlineConfig')

    return new Promise((resolve, reject) => {
      const request = store.get(bobbinId)
      request.onsuccess = () => resolve(request.result || null)
      request.onerror = () => reject(request.error)
    })
  }

  // Cleanup operations
  async cleanupOldEntities(maxAge: number = 7 * 24 * 60 * 60 * 1000): Promise<void> {
    if (!this.db) throw new Error('Database not initialized')

    const cutoff = Date.now() - maxAge
    const transaction = this.db.transaction(['entities'], 'readwrite')
    const store = transaction.objectStore('entities')
    const index = store.index('lastModified')

    return new Promise((resolve, reject) => {
      const request = index.openCursor(IDBKeyRange.upperBound(cutoff))

      request.onsuccess = (event) => {
        const cursor = (event.target as IDBRequest).result
        if (cursor) {
          const entity = cursor.value as OfflineEntity
          if (!entity.isDirty) {
            cursor.delete()
          }
          cursor.continue()
        } else {
          resolve()
        }
      }

      request.onerror = () => reject(request.error)
    })
  }

  async clearAll(): Promise<void> {
    if (!this.db) throw new Error('Database not initialized')

    const storeNames = ['entities', 'pendingChanges', 'cachedTopics', 'offlineConfig']
    const transaction = this.db.transaction(storeNames, 'readwrite')

    const promises = storeNames.map(storeName => {
      return new Promise<void>((resolve, reject) => {
        const request = transaction.objectStore(storeName).clear()
        request.onsuccess = () => resolve()
        request.onerror = () => reject(request.error)
      })
    })

    await Promise.all(promises)
  }
}

// Singleton instance
export const offlineStorage = new OfflineStorage()

// Utility functions for optimistic updates
export async function performOptimisticUpdate(
  entityRef: string,
  updateFn: (entity: any) => any,
  apiCall: () => Promise<any>
): Promise<any> {
  try {
    // Get current entity from cache
    const cachedEntity = await offlineStorage.getEntity(entityRef)

    if (cachedEntity) {
      // Apply optimistic update to cached data
      const optimisticData = updateFn(cachedEntity.data)

      await offlineStorage.cacheEntity({
        ...cachedEntity,
        data: optimisticData,
        isDirty: true,
        lastModified: Date.now()
      })
    }

    // Attempt API call
    try {
      const result = await apiCall()

      // Success - update cache with server data
      if (cachedEntity) {
        await offlineStorage.cacheEntity({
          ...cachedEntity,
          data: result,
          isDirty: false,
          lastModified: Date.now()
        })
      }

      return result
    } catch (apiError) {
      // API failed - add to pending changes for later sync
      const changeId = `${entityRef}-${Date.now()}`
      await offlineStorage.addPendingChange({
        id: changeId,
        entityRef,
        operation: 'update',
        data: updateFn(cachedEntity?.data || {}),
        timestamp: Date.now(),
        retryCount: 0,
        url: '/api/entities/' + entityRef,
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updateFn(cachedEntity?.data || {}))
      })

      throw apiError
    }
  } catch (error) {
    console.error('Optimistic update failed:', error)
    throw error
  }
}