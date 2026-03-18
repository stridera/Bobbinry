/**
 * Navigation Panel View
 *
 * Sidebar showing all entity types with counts
 * Types expand inline to show individual entities
 */

import { useState, useEffect, useMemo } from 'react'
import {
  BobbinryAPI,
  EntityAPI,
  PanelActions,
  PanelBody,
  PanelCard,
  PanelEmptyState,
  PanelFrame,
  PanelIconButton,
  PanelLoadingState,
  PanelPill,
  PanelSectionTitle,
} from '@bobbinry/sdk'
import type { EntityTypeDefinition } from '../types'

interface NavigationViewProps {
  context?: {
    projectId?: string
    currentProject?: string
    currentView?: string
    apiToken?: string
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
  const apiToken = context?.apiToken

  const entityApi = useMemo(() => {
    if (!projectId) return null
    const api = new BobbinryAPI()
    if (apiToken) api.setAuthToken(apiToken)
    return new EntityAPI(api, projectId)
  }, [projectId, apiToken])

  useEffect(() => {
    if (projectId && entityApi) {
      loadEntityTypes()
    } else {
      setLoading(false)
      setEntityTypes([])
    }
  }, [projectId, entityApi])

  async function loadEntityTypes() {
    if (!entityApi) return
    try {
      setLoading(true)
      setError(null)

      const result = await entityApi.query({ collection: 'entity_type_definitions' })
      const types = result.data
      setEntityTypes(types)

      // Load counts for each entity type in parallel
      const typeIds = types.map((t: EntityTypeDefinition) => getTypeId(t))
      const countResults = await Promise.all(
        typeIds.map(async (typeId: string) => {
          try {
            const countResult = await entityApi.query({ collection: typeId, limit: 1 })
            return [typeId, countResult.total || 0] as const
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
    if (!entityApi) return
    setLoadingEntities(prev => new Set(prev).add(typeId))
    try {
      const result = await entityApi.query({ collection: typeId })
      const entities = result.data
      setTypeEntities(prev => ({ ...prev, [typeId]: entities }))
      setCounts(prev => ({ ...prev, [typeId]: result.total || entities.length }))
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
    return <PanelLoadingState label="Loading entity types…" />
  }

  if (error) {
    return (
      <PanelFrame>
        <PanelBody>
          <PanelSectionTitle>Entity Types</PanelSectionTitle>
          <PanelCard className="text-xs text-red-700 dark:text-red-300">{error}</PanelCard>
        </PanelBody>
      </PanelFrame>
    )
  }

  return (
    <PanelFrame>
      <PanelActions>
        <PanelIconButton
          onClick={handleConfigClick}
          title="Create new entity type"
        >
          <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M12 5v14M5 12h14" />
          </svg>
        </PanelIconButton>
      </PanelActions>

      <PanelBody className="space-y-2">
        <div className="flex items-center justify-between gap-3">
          <PanelSectionTitle>Entity Types</PanelSectionTitle>
          <PanelPill>{entityTypes.length} types</PanelPill>
        </div>
        {entityTypes.length === 0 ? (
          <PanelEmptyState
            title="No entity types yet"
            description="Create your first type to start building characters, places, items, or lore."
            action={
              <button
                onClick={handleConfigClick}
                className="rounded-md border border-blue-600 bg-blue-600 px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-blue-700 dark:border-blue-500 dark:bg-blue-600 dark:hover:bg-blue-500"
              >
                Create entity type
              </button>
            }
          />
        ) : (
          <PanelCard className="px-0 py-1">
            {entityTypes.map(type => {
            const typeId = getTypeId(type)
            const isExpanded = expandedTypes.has(typeId)
            const entities = typeEntities[typeId] || []
            const isLoadingType = loadingEntities.has(typeId)

            return (
              <div key={type.id}>
                {/* Type row */}
                <div
                  className="flex cursor-pointer items-center gap-1.5 py-1 pr-2 text-sm hover:bg-gray-100 dark:hover:bg-gray-700"
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
                  <PanelPill className="mr-1">{counts[typeId] || 0}</PanelPill>
                  <PanelIconButton
                    onClick={(e) => { e.stopPropagation(); handleNewEntity(type) }}
                    title={`New ${type.label}`}
                  >
                    <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M12 5v14M5 12h14" />
                    </svg>
                  </PanelIconButton>
                </div>

                {/* Expanded entity list */}
                {isExpanded && (
                  <div>
                    {isLoadingType ? (
                      <div className="py-1 text-xs text-gray-400 dark:text-gray-500" style={{ paddingLeft: `${16 + 8}px` }}>
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
                          className="group flex cursor-pointer items-center gap-1.5 py-1 pr-2 text-sm hover:bg-gray-100 dark:hover:bg-gray-700"
                          style={{ paddingLeft: `${16 + 8}px` }}
                          onClick={() => handleEntityClick(entity, type)}
                        >
                          <span className="w-3 flex-shrink-0"></span>
                          <span className="flex-1 text-gray-700 dark:text-gray-300 truncate">
                            {entity.name || 'Untitled'}
                          </span>
                          <PanelIconButton
                            onClick={(e) => handleEntityPreview(e, entity, type)}
                            className="h-5 w-5 opacity-0 transition-opacity group-hover:opacity-100"
                            title={`Preview ${entity.name || 'entity'}`}
                          >
                            <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M15 3h6m0 0v6m0-6L10 14" />
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M9 7H7a2 2 0 00-2 2v8a2 2 0 002 2h8a2 2 0 002-2v-2" />
                            </svg>
                          </PanelIconButton>
                        </div>
                      ))
                    )}
                  </div>
                )}
              </div>
            )
          })}
          </PanelCard>
        )}
      </PanelBody>
    </PanelFrame>
  )
}
