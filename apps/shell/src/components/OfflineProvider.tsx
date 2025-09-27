'use client'

import { createContext, useContext, useEffect, ReactNode } from 'react'
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
  const serviceWorkerManager = ServiceWorkerManager.getInstance()

  useEffect(() => {
    let mounted = true

    async function initializeOffline() {
      try {
        // Initialize IndexedDB
        await offlineStorage.init()
        console.log('IndexedDB initialized')

        // Register Service Worker
        await serviceWorkerManager.register()
        console.log('Service Worker registered')

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
  }, [serviceWorkerManager])

  // Listen for Service Worker events
  useEffect(() => {
    const handleDataUpdated = (data: any) => {
      // Notify components that cached data has been updated
      console.log('Data updated:', data)

      // Could dispatch custom events here for components to listen to
      window.dispatchEvent(new CustomEvent('offline-data-updated', { detail: data }))
    }

    const handleMessageDelivery = (data: any) => {
      // Handle pub/sub message delivery from Service Worker
      console.log('Message delivery:', data)

      window.dispatchEvent(new CustomEvent('offline-message-delivery', { detail: data }))
    }

    serviceWorkerManager.on('data-updated', handleDataUpdated)
    serviceWorkerManager.on('message-delivery', handleMessageDelivery)

    return () => {
      serviceWorkerManager.off('data-updated', handleDataUpdated)
      serviceWorkerManager.off('message-delivery', handleMessageDelivery)
    }
  }, [serviceWorkerManager])

  return (
    <OfflineContext.Provider
      value={{
        isInitialized: true,
        serviceWorkerManager
      }}
    >
      {children}
    </OfflineContext.Provider>
  )
}

export default OfflineProvider