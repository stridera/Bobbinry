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
    throw new Error('useExtensions must be used within ExtensionProvider')
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

  // Update state when extensions change
  const updateState = useCallback(() => {
    setExtensions(extensionRegistry.getAllExtensions())
    setStats(extensionRegistry.getStats())
  }, [])

  useEffect(() => {
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
  }, [])

  const registerExtension = useCallback((bobbinId: string, contribution: any) => {
    try {
      extensionRegistry.registerExtension(bobbinId, contribution)
      updateState()
    } catch (error) {
      console.error('Failed to register extension:', error)
      throw error
    }
  }, [updateState])

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
    extensions,
    registerExtension,
    unregisterExtension,
    unregisterBobbin,
    setExtensionActive,
    getExtensionsForSlot,
    getSlot,
    stats
  }), [extensions, registerExtension, unregisterExtension, unregisterBobbin, setExtensionActive, getExtensionsForSlot, getSlot, stats])

  return (
    <ExtensionContext.Provider value={contextValue}>
      {children}
    </ExtensionContext.Provider>
  )
}

// Hook for managing extension registration from manifests
export function useManifestExtensions() {
  const { registerExtension, unregisterBobbin } = useExtensions()

  const registerManifestExtensions = useCallback((bobbinId: string, manifest: any) => {
    try {
      // Register extensions from manifest
      if (manifest.extensions?.contributions) {
        for (const contribution of manifest.extensions.contributions) {
          registerExtension(bobbinId, contribution)
        }
      }

      console.log(`Registered extensions for bobbin: ${bobbinId}`)
    } catch (error) {
      console.error(`Failed to register extensions for bobbin ${bobbinId}:`, error)
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