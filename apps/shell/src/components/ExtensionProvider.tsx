'use client'

import { createContext, useContext, useEffect, ReactNode, useState, useCallback, useMemo } from 'react'
import { extensionRegistry, RegisteredExtension } from '@/lib/extensions'

interface ExtensionContextType {
  extensions: RegisteredExtension[]
  registerExtension: (bobbinId: string, contribution: any) => void
  unregisterExtension: (extensionId: string) => void
  unregisterBobbin: (bobbinId: string) => void
  setExtensionActive: (extensionId: string, active: boolean) => void
  getExtensionsForSlot: (slotId: string, context?: any) => RegisteredExtension[]
  getSlot: (slotId: string) => import('@/lib/extensions').SlotDefinition | undefined
  stats: {
    totalExtensions: number
    totalSlots: number
    extensionsBySlot: Record<string, number>
    extensionsByBobbin: Record<string, number>
  }
}

const ExtensionContext = createContext<ExtensionContextType | null>(null)

export function useExtensions() {
  const context = useContext(ExtensionContext)
  if (!context) {
    console.warn('[HYDRATION FIX] useExtensions called without context, returning null')
    return null
  }
  return context
}

interface ExtensionProviderProps {
  children: ReactNode
}

export function ExtensionProvider({ children }: ExtensionProviderProps) {
  const [extensions, setExtensions] = useState<RegisteredExtension[]>([])
  const [stats, setStats] = useState({
    totalExtensions: 0,
    totalSlots: 0,
    extensionsBySlot: {},
    extensionsByBobbin: {}
  })
  const [isClient, setIsClient] = useState(false)

  // Ensure we're on the client side to prevent hydration mismatches
  useEffect(() => {
    setIsClient(true)
  }, [])

  // Update state when extensions change
  const updateState = useCallback(() => {
    if (isClient) {
      setExtensions(extensionRegistry.getAllExtensions())
      setStats(extensionRegistry.getStats())
    }
  }, [isClient])

  useEffect(() => {
    if (!isClient) return

    updateState()

    // Listen for changes to any slot
    const unsubscribers: (() => void)[] = []

    // Listen to all built-in slots for changes
    const slotIds = [
      'shell.leftPanel',
      'shell.rightPanel',
      'shell.topBar',
      'shell.statusBar',
      'shell.contextMenu',
      'manuscript.editor.toolbar'
    ]

    slotIds.forEach(slotId => {
      const unsubscribe = extensionRegistry.onSlotChange(slotId, updateState)
      unsubscribers.push(unsubscribe)
    })

    return () => {
      unsubscribers.forEach(unsub => unsub())
    }
  }, [isClient, updateState])

  const registerExtension = useCallback((bobbinId: string, contribution: any) => {
    if (!isClient) {
      console.warn('[EXTENSIONS] Skipping registration on server side')
      return
    }
    try {
      extensionRegistry.registerExtension(bobbinId, contribution)
      updateState()
    } catch (error) {
      console.error('Failed to register extension:', error)
      throw error
    }
  }, [updateState, isClient])

  const unregisterExtension = useCallback((extensionId: string) => {
    extensionRegistry.unregisterExtension(extensionId)
    updateState()
  }, [updateState])

  const unregisterBobbin = useCallback((bobbinId: string) => {
    extensionRegistry.unregisterBobbin(bobbinId)
    updateState()
  }, [updateState])

  const setExtensionActive = useCallback((extensionId: string, active: boolean) => {
    extensionRegistry.setExtensionActive(extensionId, active)
    updateState()
  }, [updateState])

  const getExtensionsForSlot = useCallback((slotId: string, context?: any) => {
    return extensionRegistry.getExtensionsForSlot(slotId, context)
  }, [])

  const getSlot = useCallback((slotId: string) => {
    return extensionRegistry.getSlot(slotId)
  }, [])

  const contextValue: ExtensionContextType = useMemo(() => ({
    extensions: isClient ? extensions : [],
    registerExtension,
    unregisterExtension,
    unregisterBobbin,
    setExtensionActive,
    getExtensionsForSlot,
    getSlot,
    stats: isClient ? stats : {
      totalExtensions: 0,
      totalSlots: 0,
      extensionsBySlot: {},
      extensionsByBobbin: {}
    }
  }), [extensions, registerExtension, unregisterExtension, unregisterBobbin, setExtensionActive, getExtensionsForSlot, getSlot, stats, isClient])

  if (!isClient) {
    // Return minimal context during SSR to prevent hydration mismatches
    return (
      <ExtensionContext.Provider value={{
        extensions: [],
        registerExtension: () => { },
        unregisterExtension: () => { },
        unregisterBobbin: () => { },
        setExtensionActive: () => { },
        getExtensionsForSlot: () => [],
        getSlot: () => undefined,
        stats: {
          totalExtensions: 0,
          totalSlots: 0,
          extensionsBySlot: {},
          extensionsByBobbin: {}
        }
      }}>
        {children}
      </ExtensionContext.Provider>
    )
  }

  return (
    <ExtensionContext.Provider value={contextValue}>
      {children}
    </ExtensionContext.Provider>
  )
}

// Hook for managing extension registration from manifests
export function useManifestExtensions() {
  const extensions = useExtensions()
  
  // Handle SSR or when providers aren't ready
  if (!extensions) {
    return {
      registerManifestExtensions: () => {},
      unregisterManifestExtensions: () => {}
    }
  }
  
  const { registerExtension, unregisterBobbin } = extensions

  const registerManifestExtensions = useCallback((bobbinId: string, manifest: any) => {
    try {
      console.log(`[MANIFEST] Attempting to register extensions for bobbin: ${bobbinId}`)
      console.log(`[MANIFEST] Manifest contributions:`, manifest.extensions?.contributions)

      // Register extensions from manifest
      if (manifest.extensions?.contributions) {
        for (const contribution of manifest.extensions.contributions) {
          console.log(`[MANIFEST] Registering contribution: ${contribution.id} for bobbin: ${bobbinId}`)
          registerExtension(bobbinId, contribution)
        }
      }

      console.log(`[MANIFEST] Registered extensions for bobbin: ${bobbinId}`)
    } catch (error) {
      console.error(`[MANIFEST] Failed to register extensions for bobbin ${bobbinId}:`, error)
      throw error
    }
  }, [registerExtension])

  const unregisterManifestExtensions = useCallback((bobbinId: string) => {
    unregisterBobbin(bobbinId)
    console.log(`Unregistered extensions for bobbin: ${bobbinId}`)
  }, [unregisterBobbin])

  return {
    registerManifestExtensions,
    unregisterManifestExtensions
  }
}

export default ExtensionProvider