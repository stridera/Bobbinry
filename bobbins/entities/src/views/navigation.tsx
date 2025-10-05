/**
 * Navigation Panel View
 *
 * Sidebar showing all entity types with counts
 * Allows users to browse and switch between entity collections
 */

import { useState, useEffect } from 'react'
import { BobbinrySDK } from '@bobbinry/sdk'
import type { EntityTypeDefinition } from '../types'

interface NavigationViewProps {
  context?: {
    projectId?: string
    currentProject?: string
    currentView?: string
  }
}

export default function NavigationView({ context }: NavigationViewProps) {
  const [entityTypes, setEntityTypes] = useState<EntityTypeDefinition[]>([])
  const [counts, setCounts] = useState<Record<string, number>>({})
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [activeType, setActiveType] = useState<string | null>(null)

  // Create SDK instance for the panel
  const [sdk] = useState(() => new BobbinrySDK('entities'))
  
  // Get projectId from context
  const projectId = context?.projectId || context?.currentProject

  console.log('[NavigationPanel] Render - projectId:', projectId, 'loading:', loading, 'context:', context)

  useEffect(() => {
    if (projectId) {
      sdk.setProject(projectId)
      loadEntityTypes()
    } else {
      setLoading(false)
      setEntityTypes([])
    }
  }, [projectId, sdk])

  async function loadEntityTypes() {
    try {
      setLoading(true)
      setError(null)

      console.log('[Navigation] Loading entity types for project:', projectId)

      const response = await fetch(`/api/collections/entity_type_definitions/entities?projectId=${projectId}`)
      
      if (!response.ok) {
        throw new Error(`Failed to load entity types: ${response.statusText}`)
      }
      
      const data = await response.json()
      const types = data.entities || []
      setEntityTypes(types)
      console.log('[Navigation] Loaded entity types:', types)

      // Load counts for each entity type
      const typeCounts: Record<string, number> = {}
      for (const type of types) {
        const typeId = (type as any).type_id || (type as any).typeId
        try {
          const countResponse = await fetch(`/api/collections/${typeId}/entities?projectId=${projectId}&limit=0`)
          if (countResponse.ok) {
            const countData = await countResponse.json()
            typeCounts[typeId] = countData.total || 0
          } else {
            typeCounts[typeId] = 0
          }
        } catch {
          typeCounts[typeId] = 0
        }
      }
      setCounts(typeCounts)

      setLoading(false)
    } catch (err: any) {
      console.error('[Navigation] Failed to load entity types:', err)
      setError(err.message || 'Failed to load entity types')
      setLoading(false)
    }
  }

  function handleTypeClick(type: EntityTypeDefinition) {
    const typeId = (type as any).type_id || type.typeId
    setActiveType(typeId)

    console.log('[Navigation] Navigating to:', typeId)

    // Navigate to entity list view
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('bobbinry:navigate', {
        detail: {
          entityType: typeId,
          entityId: 'list',
          bobbinId: 'entities',
          metadata: { 
            view: 'entity-list',
            typeId: typeId,
            typeLabel: type.label,
            typeIcon: type.icon
          }
        }
      }))
    }
  }

  function handleConfigClick() {
    console.log('[Navigation] Opening configuration')

    // Navigate to config view
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('bobbinry:navigate', {
        detail: {
          entityType: 'entity_type_definitions',
          entityId: 'config',
          bobbinId: 'entities',
          metadata: { view: 'config' }
        }
      }))
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full p-4">
        <div className="text-sm text-gray-600 dark:text-gray-400">Loading...</div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="p-4">
        <div className="p-3 bg-red-50 dark:bg-red-900/20 border border-red-300 dark:border-red-700 rounded">
          <p className="text-xs text-red-700 dark:text-red-300 font-medium mb-1">Error</p>
          <p className="text-xs text-red-600 dark:text-red-400">{error}</p>
        </div>
      </div>
    )
  }

  return (
    <div className="flex flex-col h-full bg-white dark:bg-gray-900 border-r border-gray-200 dark:border-gray-700">
      {/* Header */}
      <div className="p-4 border-b border-gray-200 dark:border-gray-700">
        <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-1">
          Entities
        </h2>
        <p className="text-xs text-gray-600 dark:text-gray-400">
          {entityTypes.length} {entityTypes.length === 1 ? 'type' : 'types'} configured
        </p>
      </div>

      {/* Entity Type List */}
      <div className="flex-1 overflow-auto">
        {entityTypes.length === 0 ? (
          <div className="p-4 text-center">
            <p className="text-sm text-gray-600 dark:text-gray-400 mb-3">
              No entity types yet
            </p>
            <button
              onClick={handleConfigClick}
              className="px-3 py-2 bg-blue-600 dark:bg-blue-700 text-white text-sm rounded hover:bg-blue-700 dark:hover:bg-blue-600"
            >
              Create Entity Type
            </button>
          </div>
        ) : (
          <div className="py-2">
            {entityTypes.map(type => (
              <button
                key={type.id}
                onClick={() => handleTypeClick(type)}
                className={`w-full px-4 py-3 flex items-center gap-3 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors ${
                  activeType === ((type as any).type_id || type.typeId)
                    ? 'bg-blue-50 dark:bg-blue-900/20 border-l-4 border-blue-600 dark:border-blue-500'
                    : 'border-l-4 border-transparent'
                }`}
              >
                <span className="text-2xl">{type.icon}</span>
                <div className="flex-1 text-left">
                  <div className="text-sm font-medium text-gray-900 dark:text-gray-100">
                    {type.label}
                  </div>
                  <div className="text-xs text-gray-600 dark:text-gray-400">
                    {counts[(type as any).type_id || type.typeId] || 0} {counts[(type as any).type_id || type.typeId] === 1 ? 'item' : 'items'}
                  </div>
                </div>
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Footer Actions */}
      <div className="p-4 border-t border-gray-200 dark:border-gray-700">
        <button
          onClick={handleConfigClick}
          className="w-full px-3 py-2 bg-gray-100 dark:bg-gray-800 text-gray-900 dark:text-gray-100 text-sm rounded hover:bg-gray-200 dark:hover:bg-gray-700 font-medium"
        >
          + New Entity Type
        </button>
      </div>
    </div>
  )
}
