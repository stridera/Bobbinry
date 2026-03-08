/**
 * Navigation Panel View
 *
 * Sidebar showing all entity types with counts
 * Types expand inline to show individual entities
 */

import { useState, useEffect } from 'react'
import { PanelActions } from '@bobbinry/sdk'
import type { EntityTypeDefinition } from '../types'

interface NavigationViewProps {
  context?: {
    projectId?: string
    currentProject?: string
    currentView?: string
  }
}

function getTypeId(type: EntityTypeDefinition): string {
  return (type as any).type_id || type.typeId
}

export default function NavigationView({ context }: NavigationViewProps) {
  const [entityTypes, setEntityTypes] = useState<EntityTypeDefinition[]>([])
  const [counts, setCounts] = useState<Record<string, number>>({})
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // Expand/collapse and entity loading state
  const [expandedTypes, setExpandedTypes] = useState<Set<string>>(new Set())
  const [typeEntities, setTypeEntities] = useState<Record<string, any[]>>({})
  const [loadingEntities, setLoadingEntities] = useState<Set<string>>(new Set())

  // Get projectId from context
  const projectId = context?.projectId || context?.currentProject

  useEffect(() => {
    if (projectId) {
      loadEntityTypes()
    } else {
      setLoading(false)
      setEntityTypes([])
    }
  }, [projectId])

  async function loadEntityTypes() {
    try {
      setLoading(true)
      setError(null)

      const response = await fetch(`/api/collections/entity_type_definitions/entities?projectId=${projectId}`)

      if (!response.ok) {
        throw new Error(`Failed to load entity types: ${response.statusText}`)
      }

      const data = await response.json()
      const types = data.entities || []
      setEntityTypes(types)

      // Load counts for each entity type in parallel
      const typeIds = types.map((t: EntityTypeDefinition) => getTypeId(t))
      const countResults = await Promise.all(
        typeIds.map(async (typeId: string) => {
          try {
            const countResponse = await fetch(`/api/collections/${typeId}/entities?projectId=${projectId}&limit=1`)
            if (countResponse.ok) {
              const countData = await countResponse.json()
              return [typeId, countData.total || 0] as const
            }
          } catch {}
          return [typeId, 0] as const
        })
      )
      setCounts(Object.fromEntries(countResults))

      setLoading(false)
    } catch (err: any) {
      console.error('[Navigation] Failed to load entity types:', err)
      setError(err.message || 'Failed to load entity types')
      setLoading(false)
    }
  }

  async function loadEntitiesForType(typeId: string) {
    setLoadingEntities(prev => new Set(prev).add(typeId))
    try {
      const response = await fetch(`/api/collections/${typeId}/entities?projectId=${projectId}`)
      if (!response.ok) throw new Error(response.statusText)
      const data = await response.json()
      const entities = data.entities || []
      setTypeEntities(prev => ({ ...prev, [typeId]: entities }))
      setCounts(prev => ({ ...prev, [typeId]: data.total || entities.length }))
    } catch (err) {
      console.error('[Navigation] Failed to load entities for type:', typeId, err)
    } finally {
      setLoadingEntities(prev => {
        const next = new Set(prev)
        next.delete(typeId)
        return next
      })
    }
  }

  function toggleType(typeId: string) {
    const willExpand = !expandedTypes.has(typeId)

    setExpandedTypes(prev => {
      const next = new Set(prev)
      if (next.has(typeId)) {
        next.delete(typeId)
      } else {
        next.add(typeId)
      }
      return next
    })

    // Side effect outside the state setter
    if (willExpand && !typeEntities[typeId]) {
      loadEntitiesForType(typeId)
    }
  }

  function handleEntityClick(entity: any, type: EntityTypeDefinition) {
    const typeId = getTypeId(type)

    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('bobbinry:navigate', {
        detail: {
          entityType: typeId,
          entityId: entity.id,
          bobbinId: 'entities',
          metadata: {
            view: 'entity-editor',
            typeId,
            typeLabel: type.label,
            typeIcon: type.icon
          }
        }
      }))
    }
  }

  function handleEntityPreview(e: React.MouseEvent, entity: any, type: EntityTypeDefinition) {
    e.stopPropagation()
    const typeId = getTypeId(type)

    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('bobbinry:entity-preview', {
        detail: {
          entityId: entity.id,
          entityType: typeId,
          typeLabel: type.label,
          typeIcon: type.icon,
          entity
        }
      }))
    }
  }

  function handleNewEntity(type: EntityTypeDefinition) {
    const typeId = getTypeId(type)

    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('bobbinry:navigate', {
        detail: {
          entityType: typeId,
          entityId: 'new',
          bobbinId: 'entities',
          metadata: {
            view: 'entity-editor',
            isNew: true,
            typeId,
            typeLabel: type.label,
            typeIcon: type.icon
          }
        }
      }))
    }
  }

  function handleConfigClick() {
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
    <div className="h-full flex flex-col bg-white dark:bg-gray-800">
      <PanelActions>
        <button
          onClick={handleConfigClick}
          className="text-lg leading-none text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 w-6 h-6 flex items-center justify-center"
          title="Create new entity type"
        >
          +
        </button>
      </PanelActions>

      {/* Entity Type List */}
      <div className="flex-1 overflow-y-auto">
        {entityTypes.length === 0 ? (
          <div className="p-4 text-center text-sm text-gray-500 dark:text-gray-400">
            <div className="mb-3">No entity types yet</div>
            <button
              onClick={handleConfigClick}
              className="px-3 py-1.5 text-xs bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 text-gray-700 dark:text-gray-200 rounded"
            >
              Create Your First Entity Type
            </button>
          </div>
        ) : (
          entityTypes.map(type => {
            const typeId = getTypeId(type)
            const isExpanded = expandedTypes.has(typeId)
            const entities = typeEntities[typeId] || []
            const isLoadingType = loadingEntities.has(typeId)

            return (
              <div key={type.id}>
                {/* Type row */}
                <div
                  className="pr-2 py-1 cursor-pointer hover:bg-gray-100 dark:hover:bg-gray-700 text-sm flex items-center gap-1.5"
                  style={{ paddingLeft: '8px' }}
                  onClick={() => toggleType(typeId)}
                >
                  <span
                    className="text-gray-400 text-xs w-3 flex-shrink-0 hover:text-gray-600 dark:hover:text-gray-200"
                  >
                    {isExpanded ? '▼' : '▶'}
                  </span>
                  <span className="flex-shrink-0">{type.icon}</span>
                  <span className="flex-1 text-gray-800 dark:text-gray-200 truncate">{type.label}</span>
                  <span className="text-xs text-gray-500 flex-shrink-0 mr-1">
                    {counts[typeId] || 0}
                  </span>
                  <button
                    onClick={(e) => { e.stopPropagation(); handleNewEntity(type) }}
                    className="text-gray-400 hover:text-gray-600 dark:text-gray-500 dark:hover:text-gray-200 w-5 h-5 flex items-center justify-center flex-shrink-0"
                    title={`New ${type.label}`}
                  >
                    +
                  </button>
                </div>

                {/* Expanded entity list */}
                {isExpanded && (
                  <div>
                    {isLoadingType ? (
                      <div
                        className="py-1 text-xs text-gray-400 dark:text-gray-500"
                        style={{ paddingLeft: `${16 + 8}px` }}
                      >
                        Loading...
                      </div>
                    ) : entities.length === 0 ? (
                      <div
                        className="py-1 text-xs text-gray-400 dark:text-gray-500 italic"
                        style={{ paddingLeft: `${16 + 8}px` }}
                      >
                        No entities
                      </div>
                    ) : (
                      entities.map((entity: any) => (
                        <div
                          key={entity.id}
                          className="group pr-2 py-1 cursor-pointer hover:bg-gray-100 dark:hover:bg-gray-700 text-sm flex items-center gap-1.5"
                          style={{ paddingLeft: `${16 + 8}px` }}
                          onClick={() => handleEntityClick(entity, type)}
                        >
                          <span className="w-3 flex-shrink-0"></span>
                          <span className="flex-1 text-gray-700 dark:text-gray-300 truncate">
                            {entity.name || 'Untitled'}
                          </span>
                          <button
                            onClick={(e) => handleEntityPreview(e, entity, type)}
                            className="opacity-0 group-hover:opacity-100 text-gray-400 hover:text-gray-600 dark:text-gray-500 dark:hover:text-gray-200 w-5 h-5 flex items-center justify-center flex-shrink-0 transition-opacity"
                            title={`Preview ${entity.name || 'entity'}`}
                          >
                            ⊞
                          </button>
                        </div>
                      ))
                    )}
                  </div>
                )}
              </div>
            )
          })
        )}
      </div>
    </div>
  )
}
