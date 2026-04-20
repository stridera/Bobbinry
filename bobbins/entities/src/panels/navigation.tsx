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
import { getTypeId } from '../types'
import type { EntityTypeDefinition } from '../types'

interface NavigationViewProps {
  context?: {
    projectId?: string
    currentProject?: string
    currentView?: string
    apiToken?: string
  }
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

  // Listen for entity changes (create/delete) to refresh sidebar
  useEffect(() => {
    function handleEntitiesChanged(e: Event) {
      const detail = (e as CustomEvent).detail
      const collection = detail?.collection

      if (collection === 'entity_type_definitions') {
        // A new entity type was created/deleted — reload everything
        loadEntityTypes()
      } else if (collection && expandedTypes.has(collection)) {
        // An entity was created/deleted in an expanded type — refresh that type
        loadEntitiesForType(collection)
      } else if (collection) {
        // Type not expanded — just refresh counts
        refreshCountForType(collection)
      }
    }

    window.addEventListener('bobbinry:entities-changed', handleEntitiesChanged)
    return () => window.removeEventListener('bobbinry:entities-changed', handleEntitiesChanged)
  }, [entityApi, expandedTypes])

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

  async function refreshCountForType(typeId: string) {
    if (!entityApi) return
    try {
      const result = await entityApi.query({ collection: typeId, limit: 1 })
      setCounts(prev => ({ ...prev, [typeId]: result.total || 0 }))
    } catch {}
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

  function handlePublishingClick() {
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('bobbinry:navigate', {
        detail: {
          entityType: 'entity_type_definitions',
          entityId: 'publishing',
          bobbinId: 'entities',
          metadata: { view: 'publishing' }
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
          onClick={handlePublishingClick}
          title="Manage reader publishing"
        >
          <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
          </svg>
        </PanelIconButton>
        <PanelIconButton
          onClick={handleConfigClick}
          title="Entity type settings"
        >
          <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.066 2.573c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.573 1.066c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.066-2.573c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.573-1.066z" />
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
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
          <PanelCard className="px-0 py-0.5">
            {entityTypes.map(type => {
            const typeId = getTypeId(type)
            const isExpanded = expandedTypes.has(typeId)
            const entities = typeEntities[typeId] || []
            const isLoadingType = loadingEntities.has(typeId)
            const count = counts[typeId] || 0

            return (
              <div key={type.id}>
                {/* Type row */}
                <div
                  className="group/type flex cursor-pointer items-center gap-2 py-1.5 pr-2 text-sm rounded-md mx-1 hover:bg-gray-100 dark:hover:bg-gray-700/60 transition-colors"
                  style={{ paddingLeft: '6px' }}
                  onClick={() => toggleType(typeId)}
                >
                  <svg
                    className={`w-3 h-3 flex-shrink-0 text-gray-400 dark:text-gray-500 transition-transform duration-150 ${isExpanded ? 'rotate-90' : ''}`}
                    fill="none" stroke="currentColor" viewBox="0 0 24 24"
                  >
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M9 5l7 7-7 7" />
                  </svg>
                  <span className="flex-shrink-0 w-6 h-6 flex items-center justify-center rounded-md bg-gray-100 dark:bg-gray-700/50 text-sm">{type.icon}</span>
                  <span className="flex-1 font-medium text-gray-800 dark:text-gray-200 truncate text-[13px]">{type.label}</span>
                  <span className="text-[10px] tabular-nums text-gray-400 dark:text-gray-500 mr-0.5">{count}</span>
                  <PanelIconButton
                    onClick={(e) => { e.stopPropagation(); handleNewEntity(type) }}
                    title={`New ${type.label}`}
                    className="h-5 w-5 !p-0 opacity-0 group-hover/type:opacity-100 transition-opacity"
                  >
                    <svg className="h-3 w-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 5v14M5 12h14" />
                    </svg>
                  </PanelIconButton>
                </div>

                {/* Expanded entity list */}
                {isExpanded && (
                  <div className="pb-1">
                    {isLoadingType ? (
                      <div className="py-1.5 text-xs text-gray-400 dark:text-gray-500 flex items-center gap-1.5" style={{ paddingLeft: '36px' }}>
                        <svg className="w-3 h-3 animate-spin" fill="none" viewBox="0 0 24 24">
                          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                        </svg>
                        Loading...
                      </div>
                    ) : entities.length === 0 ? (
                      <div
                        className="py-1.5 flex items-center gap-1"
                        style={{ paddingLeft: '36px' }}
                      >
                        <span className="text-xs text-gray-400 dark:text-gray-500 italic">Empty</span>
                        <button
                          onClick={() => handleNewEntity(type)}
                          className="text-[11px] text-blue-500 hover:text-blue-600 dark:text-blue-400 dark:hover:text-blue-300 cursor-pointer"
                        >
                          + Add first
                        </button>
                      </div>
                    ) : (
                      entities.map((entity: any) => (
                        <div
                          key={entity.id}
                          className="group/entity flex cursor-pointer items-center gap-1.5 py-0.5 pr-2 text-[13px] rounded-md mx-1 hover:bg-gray-100 dark:hover:bg-gray-700/60 transition-colors"
                          style={{ paddingLeft: '30px' }}
                          onClick={() => handleEntityClick(entity, type)}
                        >
                          <span className="text-[10px] flex-shrink-0 opacity-50">{type.icon}</span>
                          <span className="flex-1 text-gray-700 dark:text-gray-300 truncate">
                            {entity.name || 'Untitled'}
                          </span>
                          <PanelIconButton
                            onClick={(e) => handleEntityPreview(e, entity, type)}
                            className="h-5 w-5 !p-0 opacity-0 transition-opacity group-hover/entity:opacity-100"
                            title={`Preview ${entity.name || 'entity'}`}
                          >
                            <svg className="h-3 w-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 3h6m0 0v6m0-6L10 14" />
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 7H7a2 2 0 00-2 2v8a2 2 0 002 2h8a2 2 0 002-2v-2" />
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
