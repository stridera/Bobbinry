/**
 * Navigation Panel View
 *
 * Sidebar showing all entity types with counts
 * Types expand inline to show individual entities
 */

import { useState, useEffect, useMemo, useRef } from 'react'
import {
  BobbinryAPI,
  EntityAPI,
  fuzzyMatch,
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

  // Type-ahead filter across all types (lazily bulk-loads unloaded types)
  const [filterQuery, setFilterQuery] = useState('')
  const bulkRequestedRef = useRef<Set<string>>(new Set())

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

  // When a filter is active, make sure every type's entities are loaded so
  // matches can come from collapsed/unvisited types too.
  useEffect(() => {
    if (!filterQuery.trim()) return
    for (const type of entityTypes) {
      const typeId = getTypeId(type)
      if (!(typeId in typeEntities) && !bulkRequestedRef.current.has(typeId)) {
        bulkRequestedRef.current.add(typeId)
        loadEntitiesForType(typeId)
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filterQuery, entityTypes])

  const filterMatches = useMemo(() => {
    const query = filterQuery.trim()
    if (!query) return []
    const matches: { entity: any; type: EntityTypeDefinition }[] = []
    for (const type of entityTypes) {
      const typeId = getTypeId(type)
      for (const entity of typeEntities[typeId] || []) {
        if (fuzzyMatch(query, entity.name || 'Untitled')) {
          matches.push({ entity, type })
        }
      }
    }
    return matches.slice(0, 100)
  }, [filterQuery, entityTypes, typeEntities])

  const filterStillLoading = filterQuery.trim()
    ? entityTypes.some(type => !(getTypeId(type) in typeEntities))
    : false

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

  function handleTypesClick() {
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('bobbinry:navigate', {
        detail: {
          entityType: 'entity_type_definitions',
          entityId: 'publishing',
          bobbinId: 'entities',
          metadata: {
            view: 'publishing',
            typeLabel: 'Types',
            typeIcon: '📚',
          }
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
          onClick={handleTypesClick}
          title="All types"
        >
          <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M4 6h16M4 12h16M4 18h16" />
          </svg>
        </PanelIconButton>
        <PanelIconButton
          onClick={handleConfigClick}
          title="New entity type"
        >
          <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 5v14M5 12h14" />
          </svg>
        </PanelIconButton>
      </PanelActions>

      <PanelBody className="space-y-2">
        <div className="flex items-center justify-between gap-3">
          <PanelSectionTitle>Entity Types</PanelSectionTitle>
          <PanelPill>{entityTypes.length} types</PanelPill>
        </div>
        {entityTypes.length > 0 && (
          <div className="relative">
            <svg className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-gray-400 dark:text-gray-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" aria-hidden>
              <circle cx="11" cy="11" r="7" />
              <path d="M21 21l-4.4-4.4" />
            </svg>
            <input
              type="text"
              value={filterQuery}
              onChange={(e) => setFilterQuery(e.target.value)}
              placeholder="Filter entities…"
              aria-label="Filter entities"
              className="w-full rounded-md border border-gray-200 bg-white py-1 pl-7 pr-7 text-xs text-gray-700 placeholder-gray-400 outline-none focus:border-blue-400 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-200 dark:placeholder-gray-500 dark:focus:border-blue-500"
            />
            {filterQuery && (
              <button
                onClick={() => setFilterQuery('')}
                title="Clear filter"
                className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded p-0.5 text-gray-400 hover:text-gray-600 dark:text-gray-500 dark:hover:text-gray-300"
              >
                <svg className="h-3 w-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" aria-hidden>
                  <path d="M6 6l12 12M18 6L6 18" />
                </svg>
              </button>
            )}
          </div>
        )}
        {filterQuery.trim() ? (
          <PanelCard className="px-0 py-0.5">
            {filterStillLoading && (
              <div className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-gray-400 dark:text-gray-500">
                <svg className="w-3 h-3 animate-spin" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                </svg>
                Searching all types…
              </div>
            )}
            {filterMatches.length === 0 && !filterStillLoading ? (
              <div className="px-3 py-2 text-xs text-gray-400 dark:text-gray-500">
                No matches for &ldquo;{filterQuery.trim()}&rdquo;
              </div>
            ) : (
              filterMatches.map(({ entity, type }) => (
                <div
                  key={`${getTypeId(type)}:${entity.id}`}
                  className="flex cursor-pointer items-center gap-2 py-1 px-2 text-[13px] rounded-md mx-1 hover:bg-gray-100 dark:hover:bg-gray-700/60 transition-colors"
                  onClick={() => handleEntityClick(entity, type)}
                >
                  <span className="text-sm flex-shrink-0">{type.icon}</span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-gray-700 dark:text-gray-300">{entity.name || 'Untitled'}</span>
                    <span className="block truncate text-[10px] text-gray-400 dark:text-gray-500">{type.label}</span>
                  </span>
                </div>
              ))
            )}
          </PanelCard>
        ) : entityTypes.length === 0 ? (
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
                    className="h-5 w-5 !p-0 opacity-40 group-hover/type:opacity-100 transition-opacity"
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
