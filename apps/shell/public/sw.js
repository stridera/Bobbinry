// Bobbinry Shell Service Worker - Offline-first infrastructure
// Handles caching, offline storage, and background sync

// Detect development mode (localhost)
const IS_DEVELOPMENT = self.location.hostname === 'localhost' || self.location.hostname === '127.0.0.1'

// Increment version to bust old caches
const CACHE_NAME = 'bobbinry-shell-v2'
const API_CACHE_NAME = 'bobbinry-api-v1'
const ASSETS_CACHE_NAME = 'bobbinry-assets-v1'

// Static assets to cache
const STATIC_ASSETS = [
  '/',
  '/offline',
  '/manifest.json'
]

// API patterns that should be cached
const API_PATTERNS = [
  /\/api\/projects/,
  /\/api\/entities/,
  /\/api\/bobbins/
]

self.addEventListener('install', (event) => {
  console.log('Service Worker installing...')

  event.waitUntil(
    Promise.all([
      caches.open(CACHE_NAME).then((cache) => {
        return cache.addAll(STATIC_ASSETS)
      }),
      caches.open(API_CACHE_NAME),
      caches.open(ASSETS_CACHE_NAME)
    ])
  )

  self.skipWaiting()
})

self.addEventListener('activate', (event) => {
  console.log('Service Worker activating...')

  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames.map((cacheName) => {
          if (cacheName !== CACHE_NAME &&
              cacheName !== API_CACHE_NAME &&
              cacheName !== ASSETS_CACHE_NAME) {
            console.log('Deleting old cache:', cacheName)
            return caches.delete(cacheName)
          }
        })
      )
    })
  )

  self.clients.claim()
})

self.addEventListener('fetch', (event) => {
  // Skip caching entirely in development mode
  if (IS_DEVELOPMENT) {
    return
  }

  const { request } = event
  const url = new URL(request.url)

  // Handle API requests
  if (isApiRequest(url)) {
    event.respondWith(handleApiRequest(request))
    return
  }

  // Handle navigation requests
  if (request.mode === 'navigate') {
    event.respondWith(handleNavigationRequest(request))
    return
  }

  // Handle static assets
  if (isStaticAsset(url)) {
    event.respondWith(handleStaticAsset(request))
    return
  }
})

// API request handling with offline-first strategy
async function handleApiRequest(request) {
  const cache = await caches.open(API_CACHE_NAME)
  const cachedResponse = await cache.match(request)

  try {
    // Always try network first for API requests
    const networkResponse = await fetch(request)

    if (networkResponse.ok) {
      // Cache successful responses
      cache.put(request, networkResponse.clone())

      // Notify clients of new data
      notifyClients('data-updated', {
        url: request.url,
        method: request.method
      })
    }

    return networkResponse
  } catch (error) {
    console.log('Network failed, serving from cache:', request.url)

    if (cachedResponse) {
      // Add offline indicator header
      const response = cachedResponse.clone()
      response.headers.set('X-Served-From', 'cache')
      return response
    }

    // Return offline fallback for failed API requests
    return new Response(
      JSON.stringify({
        error: 'Offline',
        message: 'No cached data available'
      }),
      {
        status: 503,
        headers: { 'Content-Type': 'application/json' }
      }
    )
  }
}

// Navigation request handling
async function handleNavigationRequest(request) {
  const cache = await caches.open(CACHE_NAME)

  try {
    const networkResponse = await fetch(request)
    return networkResponse
  } catch (error) {
    console.log('Navigation offline, serving cached page')

    const cachedResponse = await cache.match('/')
    if (cachedResponse) {
      return cachedResponse
    }

    // Return offline page if available
    return cache.match('/offline') || new Response('Offline')
  }
}

// Static asset handling with cache-first strategy
async function handleStaticAsset(request) {
  const cache = await caches.open(ASSETS_CACHE_NAME)
  const cachedResponse = await cache.match(request)

  if (cachedResponse) {
    return cachedResponse
  }

  try {
    const networkResponse = await fetch(request)
    if (networkResponse.ok) {
      cache.put(request, networkResponse.clone())
    }
    return networkResponse
  } catch (error) {
    console.log('Failed to fetch asset:', request.url)
    return new Response('Asset not available offline', { status: 404 })
  }
}

// Background sync for offline actions
self.addEventListener('sync', (event) => {
  console.log('Background sync triggered:', event.tag)

  if (event.tag === 'entity-sync') {
    event.waitUntil(syncPendingEntities())
  }

  if (event.tag === 'pub-sub-sync') {
    event.waitUntil(syncPendingMessages())
  }
})

// Sync pending entity changes when back online
async function syncPendingEntities() {
  try {
    // Get pending changes from IndexedDB
    const pendingChanges = await getPendingChanges()

    for (const change of pendingChanges) {
      try {
        const response = await fetch(change.url, {
          method: change.method,
          headers: change.headers,
          body: change.body
        })

        if (response.ok) {
          await removePendingChange(change.id)
          console.log('Synced pending change:', change.id)
        }
      } catch (error) {
        console.error('Failed to sync change:', change.id, error)
      }
    }
  } catch (error) {
    console.error('Background sync failed:', error)
  }
}

// Sync pending pub/sub messages
async function syncPendingMessages() {
  try {
    const pendingMessages = await getPendingMessages()

    for (const message of pendingMessages) {
      // Attempt to deliver message
      notifyClients('message-delivery', message)
      await removePendingMessage(message.id)
    }
  } catch (error) {
    console.error('Message sync failed:', error)
  }
}

// Helper functions
function isApiRequest(url) {
  return API_PATTERNS.some(pattern => pattern.test(url.pathname))
}

function isStaticAsset(url) {
  return url.pathname.match(/\.(js|css|png|jpg|jpeg|gif|svg|ico|woff|woff2|ttf)$/)
}

function notifyClients(type, data) {
  self.clients.matchAll().then(clients => {
    clients.forEach(client => {
      client.postMessage({ type, data })
    })
  })
}

// IndexedDB operations (stubs - will be implemented with proper IndexedDB wrapper)
async function getPendingChanges() {
  try {
    const db = await openSyncDB()
    const tx = db.transaction('pendingChanges', 'readonly')
    const store = tx.objectStore('pendingChanges')
    return await store.getAll()
  } catch (error) {
    console.error('Failed to get pending changes:', error)
    return []
  }
}

async function removePendingChange(id) {
  try {
    const db = await openSyncDB()
    const tx = db.transaction('pendingChanges', 'readwrite')
    const store = tx.objectStore('pendingChanges')
    await store.delete(id)
  } catch (error) {
    console.error('Failed to remove pending change:', error)
  }
}

async function getPendingMessages() {
  try {
    const db = await openSyncDB()
    const tx = db.transaction('pendingMessages', 'readonly')
    const store = tx.objectStore('pendingMessages')
    return await store.getAll()
  } catch (error) {
    console.error('Failed to get pending messages:', error)
    return []
  }
}

async function removePendingMessage(id) {
  try {
    const db = await openSyncDB()
    const tx = db.transaction('pendingMessages', 'readwrite')
    const store = tx.objectStore('pendingMessages')
    await store.delete(id)
  } catch (error) {
    console.error('Failed to remove pending message:', error)
  }
}

// IndexedDB connection management
let dbInstance = null

async function openSyncDB() {
  if (dbInstance) return dbInstance

  return new Promise((resolve, reject) => {
    const request = indexedDB.open('BobbinrySync', 1)

    request.onerror = () => reject(request.error)
    request.onsuccess = () => {
      dbInstance = request.result
      resolve(dbInstance)
    }

    request.onupgradeneeded = (event) => {
      const db = event.target.result

      // Create object stores for offline sync
      if (!db.objectStoreNames.contains('pendingChanges')) {
        const changesStore = db.createObjectStore('pendingChanges', { keyPath: 'id' })
        changesStore.createIndex('timestamp', 'timestamp', { unique: false })
        changesStore.createIndex('projectId', 'projectId', { unique: false })
      }

      if (!db.objectStoreNames.contains('pendingMessages')) {
        const messagesStore = db.createObjectStore('pendingMessages', { keyPath: 'id' })
        messagesStore.createIndex('timestamp', 'timestamp', { unique: false })
      }

      if (!db.objectStoreNames.contains('offlineCache')) {
        const cacheStore = db.createObjectStore('offlineCache', { keyPath: 'key' })
        cacheStore.createIndex('expiresAt', 'expiresAt', { unique: false })
      }
    }
  })
}

// Helper to add pending change
async function addPendingChange(change) {
  try {
    const db = await openSyncDB()
    const tx = db.transaction('pendingChanges', 'readwrite')
    const store = tx.objectStore('pendingChanges')
    await store.add({
      id: change.id || crypto.randomUUID(),
      timestamp: Date.now(),
      ...change
    })
  } catch (error) {
    console.error('Failed to add pending change:', error)
  }
}

// Helper to add pending message
async function addPendingMessage(message) {
  try {
    const db = await openSyncDB()
    const tx = db.transaction('pendingMessages', 'readwrite')
    const store = tx.objectStore('pendingMessages')
    await store.add({
      id: message.id || crypto.randomUUID(),
      timestamp: Date.now(),
      ...message
    })
  } catch (error) {
    console.error('Failed to add pending message:', error)
  }
}

console.log('Bobbinry Service Worker loaded')