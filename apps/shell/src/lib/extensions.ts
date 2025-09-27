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
  private static instance: ExtensionRegistry
  private extensions = new Map<string, RegisteredExtension>()
  private slots = new Map<string, SlotDefinition>()
  private conditionEvaluators = new Map<string, (condition: any, context: any) => boolean>()
  private listeners = new Map<string, Set<(extensions: RegisteredExtension[]) => void>>()

  static getInstance(): ExtensionRegistry {
    if (!ExtensionRegistry.instance) {
      ExtensionRegistry.instance = new ExtensionRegistry()
    }
    return ExtensionRegistry.instance
  }

  constructor() {
    // Clear any existing extensions on construction for fresh start
    this.extensions.clear()

    // Register built-in slots
    Object.values(BUILTIN_SLOTS).forEach(slot => {
      this.slots.set(slot.id, slot)
    })

    // Register built-in condition evaluators
    this.registerConditionEvaluator('inView', (condition: { inView: string }, context: { currentView?: string }) => {
      return condition.inView === context.currentView
    })

    this.registerConditionEvaluator('hasPermission', (condition: { hasPermission: string }, context: { permissions?: string[] }) => {
      return context.permissions?.includes(condition.hasPermission) || false
    })

    this.registerConditionEvaluator('entityType', (condition: { entityType: string }, context: { entityType?: string }) => {
      return condition.entityType === context.entityType
    })
  }

  // Slot management
  registerSlot(slot: SlotDefinition): void {
    this.slots.set(slot.id, slot)
    console.log(`Registered slot: ${slot.id}`)
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
      console.warn(`Extension ${extensionId} is already registered, skipping duplicate registration`)
      return
    }

    console.log(`Registering new extension: ${extensionId} (total extensions: ${this.extensions.size})`)

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
    console.log(`Registered extension: ${extensionId} in slot ${contribution.slot}`)

    // Notify slot listeners
    this.notifySlotListeners(contribution.slot)
  }

  unregisterExtension(extensionId: string): void {
    const extension = this.extensions.get(extensionId)
    if (extension) {
      this.extensions.delete(extensionId)
      console.log(`Unregistered extension: ${extensionId}`)
      this.notifySlotListeners(extension.contribution.slot)
    }
  }

  unregisterBobbin(bobbinId: string): void {
    const toRemove = Array.from(this.extensions.values())
      .filter(ext => ext.bobbinId === bobbinId)

    toRemove.forEach(ext => {
      this.unregisterExtension(ext.id)
    })

    console.log(`Unregistered ${toRemove.length} extensions for bobbin: ${bobbinId}`)
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
    }
  }

  private notifySlotListeners(slotId: string): void {
    const listeners = this.listeners.get(slotId)
    if (listeners) {
      const extensions = this.getExtensionsForSlot(slotId)
      listeners.forEach(callback => callback(extensions))
    }
  }

  // Component registration for extensions
  registerExtensionComponent(extensionId: string, component: React.ComponentType<any>): void {
    const extension = this.extensions.get(extensionId)
    if (extension) {
      extension.component = component
      console.log(`Registered component for extension: ${extensionId}`)
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

// Singleton instance
export const extensionRegistry = ExtensionRegistry.getInstance()

export default ExtensionRegistry