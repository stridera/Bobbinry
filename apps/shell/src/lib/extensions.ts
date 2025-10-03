// Extensions and Slots system for Bobbinry Shell
// Manages bobbin contributions to shell UI slots

import { ExtensionContribution, ExtensionCondition } from '@bobbinry/types'

export interface RegisteredExtension {
  id: string
  bobbinId: string
  contribution: ExtensionContribution
  isActive: boolean
  component?: React.ComponentType<any>
  metadata?: {
    installDate: number
    version: string
    dependencies?: string[]
  }
}

export interface SlotDefinition {
  id: string
  name: string
  description: string
  supportedTypes: string[]
  maxContributions?: number
  defaultComponent?: React.ComponentType<any>
}

// Built-in slot definitions
export const BUILTIN_SLOTS: Record<string, SlotDefinition> = {
  'shell.leftPanel': {
    id: 'shell.leftPanel',
    name: 'Left Panel',
    description: 'Left sidebar panel for navigation and tools',
    supportedTypes: ['panel', 'menu'],
    maxContributions: 5
  },
  'shell.rightPanel': {
    id: 'shell.rightPanel',
    name: 'Right Panel',
    description: 'Right sidebar panel for contextual information and tools',
    supportedTypes: ['panel'],
    maxContributions: 3
  },
  'shell.topBar': {
    id: 'shell.topBar',
    name: 'Top Bar',
    description: 'Top navigation bar',
    supportedTypes: ['menu', 'action'],
    maxContributions: 10
  },
  'shell.statusBar': {
    id: 'shell.statusBar',
    name: 'Status Bar',
    description: 'Bottom status bar',
    supportedTypes: ['action', 'view'],
    maxContributions: 8
  },
  'shell.contextMenu': {
    id: 'shell.contextMenu',
    name: 'Context Menu',
    description: 'Right-click context menu',
    supportedTypes: ['action', 'menu']
  },
  'manuscript.editor.toolbar': {
    id: 'manuscript.editor.toolbar',
    name: 'Editor Toolbar',
    description: 'Manuscript editor toolbar',
    supportedTypes: ['action'],
    maxContributions: 15
  }
}

class ExtensionRegistry {
  private extensions = new Map<string, RegisteredExtension>()
  private slots = new Map<string, SlotDefinition>()
  private listeners = new Map<string, Set<(extensions: RegisteredExtension[]) => void>>()
  private conditionEvaluators = new Map<string, (condition: any, context: any) => boolean>()
  private registrationAttempts = new Map<string, number>()
  private isInitialized = false

  constructor() {
    // Only initialize once, persist across hot reloads
    if (this.isInitialized) {
      console.log('[EXTENSIONS] Registry already initialized, skipping setup')
      return
    }
    
    console.log('[EXTENSIONS] Initializing ExtensionRegistry for first time')
    this.isInitialized = true

    // Register built-in slots
    Object.values(BUILTIN_SLOTS).forEach(slot => {
      this.slots.set(slot.id, slot)
    })

    // Register built-in condition evaluators
    this.registerConditionEvaluator('inView', (condition: { inView: string }, context: { currentView?: string; inView?: string }) => {
      // Wildcard "*" matches any view
      if (condition.inView === '*') return true

      // Check context.inView first (base view), then fall back to context.currentView
      return condition.inView === context.inView || condition.inView === context.currentView
    })

    this.registerConditionEvaluator('hasPermission', (condition: { hasPermission: string }, context: { permissions?: string[] }) => {
      return context.permissions?.includes(condition.hasPermission) || false
    })

    this.registerConditionEvaluator('entityType', (condition: { entityType: string }, context: { entityType?: string }) => {
      return condition.entityType === context.entityType
    })
  }



  // Reset method - now only clears listeners, preserves extensions
  reset(): void {
    console.log('[EXTENSIONS] Reset called - preserving extensions, clearing listeners only')
    this.listeners.clear()
    // Keep extensions and registration attempts to persist across hot reloads
  }

  // Slot management
  registerSlot(slot: SlotDefinition): void {
    this.slots.set(slot.id, slot)
  }

  getSlot(slotId: string): SlotDefinition | undefined {
    return this.slots.get(slotId)
  }

  getSlots(): SlotDefinition[] {
    return Array.from(this.slots.values())
  }

  // Extension registration
  registerExtension(bobbinId: string, contribution: ExtensionContribution): void {
    const extensionId = `${bobbinId}.${contribution.id}`

    // Check if extension is already registered
    if (this.extensions.has(extensionId)) {
      console.log(`[EXTENSIONS] Extension ${extensionId} already registered, notifying listeners anyway`)
      // Still notify listeners in case there are new subscribers
      this.notifySlotListeners(contribution.slot)
      return
    }

    // Track registration attempts
    const attempts = this.registrationAttempts.get(extensionId) || 0
    this.registrationAttempts.set(extensionId, attempts + 1)

    if (attempts > 3) {
      console.error(`[EXTENSIONS] Too many registration attempts for ${extensionId}! Aborting.`)
      return
    }

    // Validate slot exists
    const slot = this.getSlot(contribution.slot)
    if (!slot) {
      throw new Error(`Unknown slot: ${contribution.slot}`)
    }

    // Validate contribution type
    if (!slot.supportedTypes.includes(contribution.type)) {
      throw new Error(`Slot ${contribution.slot} does not support type ${contribution.type}`)
    }

    // Check max contributions limit
    if (slot.maxContributions) {
      const existingContributions = this.getExtensionsForSlot(contribution.slot)
      if (existingContributions.length >= slot.maxContributions) {
        throw new Error(`Slot ${contribution.slot} has reached maximum contributions (${slot.maxContributions})`)
      }
    }

    const extension: RegisteredExtension = {
      id: extensionId,
      bobbinId,
      contribution,
      isActive: true,
      metadata: {
        installDate: Date.now(),
        version: '1.0.0'
      }
    }

    this.extensions.set(extensionId, extension)

    // Notify slot listeners (throttled to prevent infinite loops)
    this.notifySlotListeners(contribution.slot)
  }

  unregisterExtension(extensionId: string): void {
    const extension = this.extensions.get(extensionId)
    if (extension) {
      this.extensions.delete(extensionId)
      this.notifySlotListeners(extension.contribution.slot)
    }
  }

  unregisterBobbin(bobbinId: string): void {
    const toRemove = Array.from(this.extensions.values())
      .filter(ext => ext.bobbinId === bobbinId)

    toRemove.forEach(ext => {
      this.unregisterExtension(ext.id)
    })


  }

  // Extension queries
  getExtension(extensionId: string): RegisteredExtension | undefined {
    return this.extensions.get(extensionId)
  }

  getExtensionsForSlot(slotId: string, context?: any): RegisteredExtension[] {
    return Array.from(this.extensions.values())
      .filter(ext => {
        // Match slot
        if (ext.contribution.slot !== slotId) return false

        // Check if active
        if (!ext.isActive) return false

        // Evaluate conditions
        if (ext.contribution.when && context) {
          return this.evaluateConditions(ext.contribution.when, context)
        }

        return true
      })
      .sort((a, b) => {
        // Sort by title for now - could add priority later
        return (a.contribution.title || a.contribution.id).localeCompare(
          b.contribution.title || b.contribution.id
        )
      })
  }

  getExtensionsForBobbin(bobbinId: string): RegisteredExtension[] {
    return Array.from(this.extensions.values())
      .filter(ext => ext.bobbinId === bobbinId)
  }

  getAllExtensions(): RegisteredExtension[] {
    return Array.from(this.extensions.values())
  }

  // Extension activation/deactivation
  setExtensionActive(extensionId: string, active: boolean): void {
    const extension = this.extensions.get(extensionId)
    if (extension && extension.isActive !== active) {
      extension.isActive = active
      console.log(`Extension ${extensionId} ${active ? 'activated' : 'deactivated'}`)
      this.notifySlotListeners(extension.contribution.slot)
    }
  }

  // Condition evaluation
  registerConditionEvaluator(
    type: string,
    evaluator: (condition: any, context: any) => boolean
  ): void {
    this.conditionEvaluators.set(type, evaluator)
  }

  private evaluateConditions(conditions: ExtensionCondition, context: any): boolean {
    // Check each condition type
    for (const [conditionType, conditionValue] of Object.entries(conditions)) {
      const evaluator = this.conditionEvaluators.get(conditionType)
      if (evaluator) {
        if (!evaluator({ [conditionType]: conditionValue }, context)) {
          return false
        }
      } else {
        console.warn(`Unknown condition type: ${conditionType}`)
        return false
      }
    }

    return true
  }

  // Event listeners for slot changes
  onSlotChange(slotId: string, callback: (extensions: RegisteredExtension[]) => void): () => void {
    if (!this.listeners.has(slotId)) {
      this.listeners.set(slotId, new Set())
    }

    this.listeners.get(slotId)!.add(callback)

    // Return unsubscribe function
    return () => {
      this.listeners.get(slotId)?.delete(callback)
      // Clean up empty listener sets
      if (this.listeners.get(slotId)?.size === 0) {
        this.listeners.delete(slotId)
      }
    }
  }

  // Throttle notifications to prevent infinite loops
  private notificationTimeouts = new Map<string, NodeJS.Timeout>()

  private notifySlotListeners(slotId: string): void {
    // Cancel any pending notification for this slot
    const existingTimeout = this.notificationTimeouts.get(slotId)
    if (existingTimeout) {
      clearTimeout(existingTimeout)
    }

    // Schedule new notification after a small delay to batch updates
    const timeout = setTimeout(() => {
      const listeners = this.listeners.get(slotId)
      if (listeners && listeners.size > 0) {
        const extensions = this.getExtensionsForSlot(slotId)
        listeners.forEach(callback => {
          try {
            callback(extensions)
          } catch (error) {
            console.error(`Error in slot listener for ${slotId}:`, error)
            // Remove problematic listeners to prevent infinite loops
            listeners.delete(callback)
          }
        })
      }
      this.notificationTimeouts.delete(slotId)
    }, 0)

    this.notificationTimeouts.set(slotId, timeout)
  }

  // Component registration for extensions
  registerExtensionComponent(extensionId: string, component: React.ComponentType<any>): void {
    const extension = this.extensions.get(extensionId)
    if (extension) {
      // Create a new object to ensure React detects the change
      const updatedExtension = { ...extension, component }
      this.extensions.set(extensionId, updatedExtension)
      console.log(`Registered component for extension: ${extensionId}`)
      // Notify slot listeners so UI can re-render with the component
      this.notifySlotListeners(extension.contribution.slot)
    }
  }

  getExtensionComponent(extensionId: string): React.ComponentType<any> | undefined {
    return this.extensions.get(extensionId)?.component
  }

  // Clear all extensions (for debugging)
  clearAllExtensions(): void {
    console.log(`[CLEAR] Clearing all ${this.extensions.size} extensions`)
    this.extensions.clear()
    // Notify all slot listeners
    this.slots.forEach((_, slotId) => {
      this.notifySlotListeners(slotId)
    })
  }

  // Clear all listeners (for hot reloads)
  clearAllListeners(): void {
    this.listeners.clear()
    // Clear any pending notification timeouts
    this.notificationTimeouts.forEach(timeout => clearTimeout(timeout))
    this.notificationTimeouts.clear()
  }

  // Statistics and debugging
  getStats(): {
    totalExtensions: number
    totalSlots: number
    extensionsBySlot: Record<string, number>
    extensionsByBobbin: Record<string, number>
  } {
    const extensionsBySlot: Record<string, number> = {}
    const extensionsByBobbin: Record<string, number> = {}

    for (const extension of this.extensions.values()) {
      const slotId = extension.contribution.slot
      const bobbinId = extension.bobbinId

      extensionsBySlot[slotId] = (extensionsBySlot[slotId] || 0) + 1
      extensionsByBobbin[bobbinId] = (extensionsByBobbin[bobbinId] || 0) + 1
    }

    return {
      totalExtensions: this.extensions.size,
      totalSlots: this.slots.size,
      extensionsBySlot,
      extensionsByBobbin
    }
  }
}

// Export singleton instance with HMR persistence
// Store on globalThis to survive hot module reloads
declare global {
  var __extensionRegistry: ExtensionRegistry | undefined
}

export const extensionRegistry = globalThis.__extensionRegistry ?? (globalThis.__extensionRegistry = new ExtensionRegistry())

export default ExtensionRegistry