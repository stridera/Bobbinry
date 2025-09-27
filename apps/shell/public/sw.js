// Bobbinry Shell Service Worker - Offline-first infrastructure
// Handles caching, offline storage, and background sync

const CACHE_NAME = 'bobbinry-shell-v1'
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
  // TODO: Implement IndexedDB read
  return []
}

async function removePendingChange(id) {
  // TODO: Implement IndexedDB delete
}

async function getPendingMessages() {
  // TODO: Implement IndexedDB read
  return []
}

async function removePendingMessage(id) {
  // TODO: Implement IndexedDB delete
}

console.log('Bobbinry Service Worker loaded')