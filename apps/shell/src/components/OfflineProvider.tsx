'use client'

import { createContext, useContext, useEffect, ReactNode, useState, useMemo } from 'react'
import { ServiceWorkerManager } from '@/lib/service-worker'
import { offlineStorage } from '@/lib/offline-storage'

interface OfflineContextType {
  isInitialized: boolean
  serviceWorkerManager: ServiceWorkerManager
}

const OfflineContext = createContext<OfflineContextType | null>(null)

export function useOfflineContext() {
  const context = useContext(OfflineContext)
  if (!context) {
    throw new Error('useOfflineContext must be used within OfflineProvider')
  }
  return context
}

interface OfflineProviderProps {
  children: ReactNode
}

export function OfflineProvider({ children }: OfflineProviderProps) {
  const [isClient, setIsClient] = useState(false)
  const [isInitialized, setIsInitialized] = useState(false)
  const serviceWorkerManager = useMemo(() => ServiceWorkerManager.getInstance(), [])

  // Ensure we're on the client side to prevent hydration mismatches
  useEffect(() => {
    setIsClient(true)
  }, [])

  useEffect(() => {
    if (!isClient) return

    let mounted = true

    async function initializeOffline() {
      try {
        // Initialize IndexedDB
        await offlineStorage.init()
        console.log('IndexedDB initialized')

        // Register Service Worker
        await serviceWorkerManager.register()
        console.log('Service Worker registered')

        if (mounted) {
          setIsInitialized(true)
        }

        // Set up periodic cleanup
        const cleanupInterval = setInterval(async () => {
          try {
            await offlineStorage.cleanupOldEntities()
          } catch (error) {
            console.error('Cleanup failed:', error)
          }
        }, 60 * 60 * 1000) // Every hour

        // Cleanup on unmount
        return () => {
          clearInterval(cleanupInterval)
        }
      } catch (error) {
        console.error('Offline initialization failed:', error)
        // Return empty cleanup function on error
        return () => { }
      }
    }

    if (mounted) {
      initializeOffline()
    }

    return () => {
      mounted = false
    }
  }, [serviceWorkerManager, isClient])

  // Listen for Service Worker events
  useEffect(() => {
    if (!isClient || !isInitialized) return

    let dataUpdateThrottle: NodeJS.Timeout | null = null

    const handleDataUpdated = (data: any) => {
      // Throttle data-updated events to prevent excessive triggers
      if (dataUpdateThrottle) {
        clearTimeout(dataUpdateThrottle)
      }

      dataUpdateThrottle = setTimeout(() => {
        // Notify components that cached data has been updated
        console.log('Data updated:', data)
        // Could dispatch custom events here for components to listen to
        window.dispatchEvent(new CustomEvent('offline-data-updated', { detail: data }))
      }, 100) // 100ms throttle
    }

    const handleMessageDelivery = (data: any) => {
      // Handle pub/sub message delivery from Service Worker
      console.log('Message delivery:', data)

      window.dispatchEvent(new CustomEvent('offline-message-delivery', { detail: data }))
    }

    serviceWorkerManager.on('data-updated', handleDataUpdated)
    serviceWorkerManager.on('message-delivery', handleMessageDelivery)

    return () => {
      if (dataUpdateThrottle) {
        clearTimeout(dataUpdateThrottle)
      }
      serviceWorkerManager.off('data-updated', handleDataUpdated)
      serviceWorkerManager.off('message-delivery', handleMessageDelivery)
    }
  }, [serviceWorkerManager, isClient, isInitialized])

  return (
    <OfflineContext.Provider
      value={{
        isInitialized: isClient && isInitialized,
        serviceWorkerManager
      }}
    >
      {children}
    </OfflineContext.Provider>
  )
}

export default OfflineProvider