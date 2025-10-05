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
  const [isHydrated, setIsHydrated] = useState(false)

  // Hydration-safe initialization
  useEffect(() => {
    // Mark as hydrated first
    setIsHydrated(true)

    // Don't reset on client hydration - ExtensionSlots are already subscribed
    console.log('[EXTENSIONS] Client hydrated, keeping existing listeners')

    // Initialize state from registry
    setExtensions(extensionRegistry.getAllExtensions())
    setStats(extensionRegistry.getStats())

    // Notify all slots that we're hydrated (triggers re-render with current extensions)
    setTimeout(() => {
      console.log('[EXTENSIONS] Notifying all slots after hydration')
      const slots = extensionRegistry.getSlots()
      slots.forEach(slot => {
        // Manually notify each slot
        const listeners = (extensionRegistry as any).listeners.get(slot.id)
        if (listeners && listeners.size > 0) {
          const extensions = extensionRegistry.getExtensionsForSlot(slot.id)
          listeners.forEach((callback: any) => callback(extensions))
        }
      })
    }, 0)

    // Cleanup on unmount
    return () => {
      extensionRegistry.clearAllListeners()
    }
  }, [])

  // Stable callback functions
  const registerExtension = useCallback((bobbinId: string, contribution: any) => {
    console.log('[ExtensionProvider] registerExtension called:', { bobbinId, contributionId: contribution.id, isHydrated })
    try {
      extensionRegistry.registerExtension(bobbinId, contribution)
      setExtensions(extensionRegistry.getAllExtensions())
      setStats(extensionRegistry.getStats())
    } catch (error) {
      console.error('Failed to register extension:', error)
      throw error
    }
  }, [isHydrated])

  const unregisterExtension = useCallback((extensionId: string) => {
    extensionRegistry.unregisterExtension(extensionId)
    setExtensions(extensionRegistry.getAllExtensions())
    setStats(extensionRegistry.getStats())
  }, [])

  const unregisterBobbin = useCallback((bobbinId: string) => {
    extensionRegistry.unregisterBobbin(bobbinId)
    setExtensions(extensionRegistry.getAllExtensions())
    setStats(extensionRegistry.getStats())
  }, [])

  const setExtensionActive = useCallback((extensionId: string, active: boolean) => {
    extensionRegistry.setExtensionActive(extensionId, active)
    setExtensions(extensionRegistry.getAllExtensions())
    setStats(extensionRegistry.getStats())
  }, [])

  const getExtensionsForSlot = useCallback((slotId: string, context?: any) => {
    return extensionRegistry.getExtensionsForSlot(slotId, context)
  }, [])

  const getSlot = useCallback((slotId: string) => {
    return extensionRegistry.getSlot(slotId)
  }, [])

  // Memoize context value to prevent unnecessary re-renders
  const contextValue: ExtensionContextType = useMemo(() => ({
    extensions,
    stats,
    registerExtension,
    unregisterExtension,
    unregisterBobbin,
    setExtensionActive,
    getExtensionsForSlot,
    getSlot
  }), [
    extensions,
    stats,
    registerExtension,
    unregisterExtension,
    unregisterBobbin,
    setExtensionActive,
    getExtensionsForSlot,
    getSlot
  ])

  return (
    <ExtensionContext.Provider value={contextValue}>
      {children}
    </ExtensionContext.Provider>
  )
}

// Manifest extensions hook
export function useManifestExtensions() {
  const extensions = useExtensions()
  const { registerExtension, unregisterBobbin } = extensions || {}

  const registerManifestExtensions = useCallback((bobbinId: string, manifest: any) => {
    console.log('[ExtensionProvider] registerManifestExtensions called for:', bobbinId, 'mode:', manifest.execution?.mode)
    console.log('[ExtensionProvider] Full manifest:', JSON.stringify(manifest, null, 2))

    try {
      // Register native views in viewRegistry
      if (manifest.execution?.mode === 'native' && manifest.ui?.views) {
        console.log('[ExtensionProvider] Native views found, registering in viewRegistry')
        console.log('[ExtensionProvider] manifest.ui.views:', JSON.stringify(manifest.ui.views, null, 2))
        const { viewRegistry } = require('../lib/view-registry')
        const { createComponentLoader } = require('../lib/native-view-loader')
        
        for (const view of manifest.ui.views) {
          const fullViewId = `${bobbinId}.${view.id}`
          console.log(`[ExtensionProvider] Registering native view: ${fullViewId}`)
          
          viewRegistry.register({
            viewId: fullViewId,
            bobbinId: bobbinId,
            execution: 'native',
            componentLoader: createComponentLoader(bobbinId, view.id),
            ssr: true,
            capabilities: ['read', 'write'],
            metadata: {
              name: view.name || view.id,
              type: view.type,
              source: view.source
            },
            // NEW: Pass handlers and priority from manifest
            handlers: view.handlers,
            priority: view.priority
          })
        }
      }

      // Register extension contributions
      console.log('[ExtensionProvider] Checking extensions:', {
        hasExtensions: !!manifest.extensions,
        hasContributions: !!manifest.extensions?.contributions,
        contributionsLength: manifest.extensions?.contributions?.length,
        hasRegisterExtension: !!registerExtension
      })

      if (manifest.extensions?.contributions && registerExtension) {
        console.log('[ExtensionProvider] Registering extension contributions for', bobbinId)
        const { loadNativeView } = require('../lib/native-view-loader')

        for (const contribution of manifest.extensions.contributions) {
          console.log('[ExtensionProvider] Registering extension:', contribution.id, 'slot:', contribution.slot)
          registerExtension(bobbinId, contribution)

          // For native panels, load and attach the component
          if (manifest.execution?.mode === 'native' && contribution.type === 'panel' && contribution.entry) {
            console.log(`[ExtensionProvider] Loading native panel component: ${bobbinId}.${contribution.entry}`)

            try {
              // Load the component asynchronously
              loadNativeView(bobbinId, contribution.entry).then((component: any) => {
                console.log(`[ExtensionProvider] Component loaded for ${bobbinId}.${contribution.entry}:`, component)
                console.log(`[ExtensionProvider] Component type:`, typeof component)
                console.log(`[ExtensionProvider] Component is function:`, typeof component === 'function')
                const { extensionRegistry } = require('../lib/extensions')
                const extensionId = `${bobbinId}.${contribution.id}`
                extensionRegistry.registerExtensionComponent(extensionId, component)
                console.log(`[ExtensionProvider] Registered component for panel: ${extensionId}`)
              }).catch((error: any) => {
                console.error(`[ExtensionProvider] Failed to load panel component ${bobbinId}.${contribution.entry}:`, error)
              })
            } catch (error) {
              console.error(`[ExtensionProvider] Error loading panel component:`, error)
            }
          }
        }
      }
    } catch (error) {
      console.error(`Failed to register extensions for bobbin ${bobbinId}:`, error)
      throw error
    }
  }, [registerExtension])

  const unregisterManifestExtensions = useCallback((bobbinId: string) => {
    if (!unregisterBobbin) return
    
    // Unregister views from viewRegistry
    try {
      const { viewRegistry } = require('../lib/view-registry')
      console.log(`[ExtensionProvider] Unregistering views for bobbin: ${bobbinId}`)
      viewRegistry.unregisterBobbin(bobbinId)
    } catch (error) {
      console.error(`Failed to unregister views for bobbin ${bobbinId}:`, error)
    }
    
    // Unregister extension contributions
    unregisterBobbin(bobbinId)
  }, [unregisterBobbin])

  return {
    registerManifestExtensions,
    unregisterManifestExtensions
  }
}

export default ExtensionProvider