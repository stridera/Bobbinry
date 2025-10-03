'use client'

import { createContext, useContext, useEffect, ReactNode, useState } from 'react'
import { syncManager } from '@/lib/offline'

interface OfflineContextType {
  isInitialized: boolean
  syncStatus: {
    online: boolean
    syncing: boolean
    pending: number
    failed: number
  }
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
  const [syncStatus, setSyncStatus] = useState({
    online: true,
    syncing: false,
    pending: 0,
    failed: 0
  })

  // Ensure we're on the client side to prevent hydration mismatches
  useEffect(() => {
    setIsClient(true)
  }, [])

  useEffect(() => {
    if (!isClient) return

    let mounted = true

    async function initializeOffline() {
      try {
        console.log('[Offline] Initializing offline-first system')

        // Start sync manager
        syncManager.start()

        // Get initial status
        const status = await syncManager.getStatus()
        if (mounted) {
          setSyncStatus(status)
          setIsInitialized(true)
        }

        console.log('[Offline] Initialization complete')

        // Update status periodically
        const statusInterval = setInterval(async () => {
          if (mounted) {
            const status = await syncManager.getStatus()
            setSyncStatus(status)
          }
        }, 5000) // Every 5 seconds

        // Cleanup on unmount
        return () => {
          clearInterval(statusInterval)
        }
      } catch (error) {
        console.error('[Offline] Initialization failed:', error)
        return () => {}
      }
    }

    if (mounted) {
      initializeOffline()
    }

    return () => {
      mounted = false
    }
  }, [isClient])

  // Listen for online/offline events
  useEffect(() => {
    if (!isClient) return

    const handleOnline = async () => {
      console.log('[Offline] Back online')
      const status = await syncManager.getStatus()
      setSyncStatus(status)
    }

    const handleOffline = async () => {
      console.log('[Offline] Gone offline')
      const status = await syncManager.getStatus()
      setSyncStatus(status)
    }

    window.addEventListener('online', handleOnline)
    window.addEventListener('offline', handleOffline)

    return () => {
      window.removeEventListener('online', handleOnline)
      window.removeEventListener('offline', handleOffline)
    }
  }, [isClient])

  return (
    <OfflineContext.Provider
      value={{
        isInitialized: isClient && isInitialized,
        syncStatus
      }}
    >
      {children}
    </OfflineContext.Provider>
  )
}

export default OfflineProvider