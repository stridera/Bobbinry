// Service Worker registration and management for Bobbinry Shell

export class ServiceWorkerManager {
  private static instance: ServiceWorkerManager
  private registration: ServiceWorkerRegistration | null = null
  private isOnline = navigator.onLine
  private listeners = new Map<string, Set<(data: any) => void>>()
  private isRegistering = false
  private hasRegistered = false

  static getInstance(): ServiceWorkerManager {
    if (!ServiceWorkerManager.instance) {
      ServiceWorkerManager.instance = new ServiceWorkerManager()
    }
    return ServiceWorkerManager.instance
  }

  async register(): Promise<void> {
    if (!('serviceWorker' in navigator)) {
      console.warn('Service Worker not supported')
      return
    }

    // Prevent duplicate registrations
    if (this.isRegistering || this.hasRegistered) {
      console.log('Service Worker registration already in progress or completed')
      return
    }

    this.isRegistering = true

    try {
      this.registration = await navigator.serviceWorker.register('/sw.js', {
        scope: '/'
      })

      this.hasRegistered = true
      console.log('Service Worker registered:', this.registration.scope)

      // Listen for updates
      this.registration.addEventListener('updatefound', () => {
        const newWorker = this.registration!.installing
        if (newWorker) {
          newWorker.addEventListener('statechange', () => {
            if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
              // New version available
              this.emit('update-available', { registration: this.registration })
            }
          })
        }
      })

      // Listen for messages from Service Worker
      navigator.serviceWorker.addEventListener('message', (event) => {
        const { type, data } = event.data
        this.emit(type, data)
      })

      // Monitor online/offline status
      window.addEventListener('online', () => {
        this.isOnline = true
        this.emit('online', { isOnline: true })
        this.triggerBackgroundSync()
      })

      window.addEventListener('offline', () => {
        this.isOnline = false
        this.emit('offline', { isOnline: false })
      })

    } catch (error) {
      console.error('Service Worker registration failed:', error)
    } finally {
      this.isRegistering = false
    }
  }

  async update(): Promise<void> {
    if (this.registration) {
      await this.registration.update()
    }
  }

  async unregister(): Promise<boolean> {
    if (this.registration) {
      return await this.registration.unregister()
    }
    return false
  }

  // Background sync registration
  async requestBackgroundSync(tag: string): Promise<void> {
    if (this.registration && 'sync' in this.registration) {
      try {
        await (this.registration as any).sync.register(tag)
        console.log('Background sync registered:', tag)
      } catch (error) {
        console.error('Background sync registration failed:', error)
      }
    }
  }

  // Trigger common background sync operations
  async triggerBackgroundSync(): Promise<void> {
    await this.requestBackgroundSync('entity-sync')
    await this.requestBackgroundSync('pub-sub-sync')
  }

  // Event system for Service Worker communication
  on(event: string, callback: (data: any) => void): void {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, new Set())
    }
    this.listeners.get(event)!.add(callback)
  }

  off(event: string, callback: (data: any) => void): void {
    const listeners = this.listeners.get(event)
    if (listeners) {
      listeners.delete(callback)
    }
  }

  private emit(event: string, data: any): void {
    const listeners = this.listeners.get(event)
    if (listeners) {
      listeners.forEach(callback => callback(data))
    }
  }

  // Cache management
  async clearCache(cacheName?: string): Promise<void> {
    if (cacheName) {
      await caches.delete(cacheName)
    } else {
      const cacheNames = await caches.keys()
      await Promise.all(cacheNames.map(name => caches.delete(name)))
    }
  }

  // Offline status
  getOnlineStatus(): boolean {
    return this.isOnline
  }

  // Force cache refresh for specific URLs
  async refreshCache(urls: string[]): Promise<void> {
    if (this.registration && this.registration.active) {
      this.registration.active.postMessage({
        type: 'refresh-cache',
        urls
      })
    }
  }

  // Preload critical resources
  async preloadResources(resources: string[]): Promise<void> {
    if (this.registration && this.registration.active) {
      this.registration.active.postMessage({
        type: 'preload-resources',
        resources
      })
    }
  }
}

// Offline indicator component hook
export function useOfflineStatus() {
  const [isOnline, setIsOnline] = useState(false) // Start with false to match SSR
  const [hasUpdates, setHasUpdates] = useState(false)
  const [isHydrated, setIsHydrated] = useState(false)

  useEffect(() => {
    // Set initial online status after hydration
    setIsHydrated(true)
    setIsOnline(typeof navigator !== 'undefined' ? navigator.onLine : false)

    const swManager = ServiceWorkerManager.getInstance()

    const handleOnline = () => setIsOnline(true)
    const handleOffline = () => setIsOnline(false)
    const handleUpdateAvailable = () => setHasUpdates(true)

    swManager.on('online', handleOnline)
    swManager.on('offline', handleOffline)
    swManager.on('update-available', handleUpdateAvailable)

    return () => {
      swManager.off('online', handleOnline)
      swManager.off('offline', handleOffline)
      swManager.off('update-available', handleUpdateAvailable)
    }
  }, [])

  const updateApp = async () => {
    const swManager = ServiceWorkerManager.getInstance()
    await swManager.update()
    window.location.reload()
  }

  return {
    isOnline,
    hasUpdates,
    updateApp,
    isHydrated
  }
}

// React imports for the hook
import { useEffect, useState } from 'react'

export default ServiceWorkerManager