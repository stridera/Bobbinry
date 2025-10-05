/**
 * Entity List View
 *
 * Grid/list view of entities with search, filtering, and pagination
 */

import { useState, useEffect, useMemo } from 'react'
import type { BobbinrySDK } from '@bobbinry/sdk'
import type { EntityTypeDefinition } from '../types'

interface EntityListViewProps {
  projectId: string
  bobbinId: string
  viewId: string
  sdk: BobbinrySDK
  entityType?: string
}

const ITEMS_PER_PAGE = 20

export default function EntityListView({
  sdk,
  projectId,
  entityType,
}: EntityListViewProps) {
  const [typeConfig, setTypeConfig] = useState<EntityTypeDefinition | null>(null)
  const [entities, setEntities] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // Search & Filter state
  const [searchTerm, setSearchTerm] = useState('')
  const [selectedTags, setSelectedTags] = useState<string[]>([])
  const [sortBy, setSortBy] = useState<'name' | 'created' | 'updated'>('created')
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('desc')

  // Pagination state
  const [currentPage, setCurrentPage] = useState(1)

  useEffect(() => {
    if (entityType) {
      loadTypeConfig()
      loadEntities()
    }
  }, [entityType])

  async function loadTypeConfig() {
    try {
      setError(null)
      console.log('[EntityList] Loading type config for:', entityType)

      const response = await fetch(`/api/collections/entity_type_definitions/entities?projectId=${projectId}`)
      
      if (!response.ok) {
        throw new Error(`Failed to load type config: ${response.statusText}`)
      }
      
      const data = await response.json()
      const config = data.entities?.find((t: any) =>
        (t.type_id || t.typeId) === entityType
      )
      
      if (!config) {
        console.warn(`[EntityList] Entity type "${entityType}" not found in entity_type_definitions`)
        setError(`Entity type "${entityType}" is not managed by the entities bobbin`)
        setLoading(false)
        return
      }
      
      setTypeConfig(config)
      console.log('[EntityList] Loaded type config:', config)
    } catch (err: any) {
      console.error('[EntityList] Failed to load type config:', err)
      setError(err.message || 'Failed to load entity type configuration')
    }
  }

  async function loadEntities() {
    try {
      setLoading(true)
      setError(null)

      console.log('[EntityList] Loading entities for:', entityType)

      const response = await fetch(`/api/collections/${entityType}/entities?projectId=${projectId}&limit=1000`)
      
      if (!response.ok) {
        throw new Error(`Failed to load entities: ${response.statusText}`)
      }
      
      const data = await response.json()
      setEntities(data.entities || [])
      console.log('[EntityList] Loaded entities:', data.entities)

      setLoading(false)
    } catch (err: any) {
      console.error('[EntityList] Failed to load entities:', err)
      setError(err.message || 'Failed to load entities')
      setLoading(false)
    }
  }

  // Get all unique tags from entities
  const allTags = useMemo(() => {
    const tagSet = new Set<string>()
    entities.forEach(entity => {
      if (Array.isArray(entity.tags)) {
        entity.tags.forEach((tag: string) => tagSet.add(tag))
      }
    })
    return Array.from(tagSet).sort()
  }, [entities])

  // Filter and search entities
  const filteredEntities = useMemo(() => {
    let filtered = [...entities]

    // Apply search filter
    if (searchTerm.trim()) {
      const term = searchTerm.toLowerCase()
      filtered = filtered.filter(entity => {
        const nameMatch = entity.name?.toLowerCase().includes(term)
        const descMatch = entity.description?.toLowerCase().includes(term)

        // Also search in subtitle fields if configured
        const subtitleMatch = typeConfig?.subtitleFields.some(fieldName => {
          const value = entity[fieldName]
          return value?.toString().toLowerCase().includes(term)
        })

        return nameMatch || descMatch || subtitleMatch
      })
    }

    // Apply tag filter
    if (selectedTags.length > 0) {
      filtered = filtered.filter(entity => {
        if (!Array.isArray(entity.tags)) return false
        return selectedTags.every(tag => entity.tags.includes(tag))
      })
    }

    // Apply sorting
    filtered.sort((a, b) => {
      let aVal, bVal

      if (sortBy === 'name') {
        aVal = a.name || ''
        bVal = b.name || ''
      } else if (sortBy === 'created') {
        aVal = a.created_at || 0
        bVal = b.created_at || 0
      } else {
        aVal = a.updated_at || 0
        bVal = b.updated_at || 0
      }

      if (sortOrder === 'asc') {
        return aVal > bVal ? 1 : -1
      } else {
        return aVal < bVal ? 1 : -1
      }
    })

    return filtered
  }, [entities, searchTerm, selectedTags, sortBy, sortOrder, typeConfig])

  // Paginate filtered results
  const paginatedEntities = useMemo(() => {
    const start = (currentPage - 1) * ITEMS_PER_PAGE
    const end = start + ITEMS_PER_PAGE
    return filteredEntities.slice(start, end)
  }, [filteredEntities, currentPage])

  const totalPages = Math.ceil(filteredEntities.length / ITEMS_PER_PAGE)

  // Reset to page 1 when filters change
  useEffect(() => {
    setCurrentPage(1)
  }, [searchTerm, selectedTags, sortBy, sortOrder])

  function handleCreateNew() {
    console.log('[EntityList] Creating new entity')

    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('bobbinry:navigate', {
        detail: {
          entityType,
          entityId: 'new',
          bobbinId: 'entities',
          metadata: {
            view: 'entity-editor',
            isNew: true,
            typeConfig
          }
        }
      }))
    }
  }

  function handleEntityClick(entity: any) {
    console.log('[EntityList] Opening entity:', entity.id)

    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('bobbinry:navigate', {
        detail: {
          entityType,
          entityId: entity.id,
          bobbinId: 'entities',
          metadata: {
            view: 'entity-editor',
            isNew: false,
            typeConfig
          }
        }
      }))
    }
    // }))
  }

  function toggleTag(tag: string) {
    setSelectedTags(prev =>
      prev.includes(tag)
        ? prev.filter(t => t !== tag)
        : [...prev, tag]
    )
  }

  function getSubtitleText(entity: any): string {
    if (!typeConfig?.subtitleFields.length) return ''

    return typeConfig.subtitleFields
      .map(fieldName => entity[fieldName])
      .filter(Boolean)
      .join(' • ')
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-gray-600 dark:text-gray-400">Loading...</div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="flex items-center justify-center h-full p-6">
        <div className="max-w-md p-6 bg-red-50 dark:bg-red-900/20 border border-red-300 dark:border-red-700 rounded-lg">
          <h2 className="text-lg font-semibold text-red-700 dark:text-red-300 mb-2">
            Error Loading Entities
          </h2>
          <p className="text-red-600 dark:text-red-400">{error}</p>
        </div>
      </div>
    )
  }

  const displayStyle = typeConfig?.listLayout.display || 'grid'
  const cardSize = typeConfig?.listLayout.cardSize || 'medium'

  const gridClasses = {
    small: 'grid-cols-2 md:grid-cols-4 lg:grid-cols-6',
    medium: 'grid-cols-1 md:grid-cols-2 lg:grid-cols-3',
    large: 'grid-cols-1 md:grid-cols-2'
  }[cardSize]

  return (
    <div className="flex flex-col h-full bg-gray-50 dark:bg-gray-900">
      {/* Header */}
      <div className="border-b border-gray-200 dark:border-gray-700 p-4 bg-white dark:bg-gray-800">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-3">
            {typeConfig && <span className="text-3xl">{typeConfig.icon}</span>}
            <div>
              <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">
                {typeConfig?.label || 'Entities'}
              </h1>
              <p className="text-sm text-gray-600 dark:text-gray-400">
                {filteredEntities.length} {filteredEntities.length === 1 ? 'item' : 'items'}
                {entities.length !== filteredEntities.length && ` (${entities.length} total)`}
              </p>
            </div>
          </div>

          <button
            onClick={handleCreateNew}
            className="px-4 py-2 bg-blue-600 dark:bg-blue-700 text-white rounded-lg hover:bg-blue-700 dark:hover:bg-blue-600 font-medium"
          >
            + New {typeConfig?.label}
          </button>
        </div>

        {/* Search & Filters */}
        <div className="space-y-3">
          <input
            type="text"
            placeholder="Search by name, description..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100"
          />

          <div className="flex items-center gap-4 flex-wrap">
            {/* Tag filter */}
            {allTags.length > 0 && (
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-sm text-gray-600 dark:text-gray-400">Tags:</span>
                {allTags.map(tag => (
                  <button
                    key={tag}
                    onClick={() => toggleTag(tag)}
                    className={`px-3 py-1 rounded-full text-sm ${
                      selectedTags.includes(tag)
                        ? 'bg-blue-600 dark:bg-blue-700 text-white'
                        : 'bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-300 dark:hover:bg-gray-600'
                    }`}
                  >
                    {tag}
                  </button>
                ))}
              </div>
            )}

            {/* Sort controls */}
            <div className="flex items-center gap-2 ml-auto">
              <span className="text-sm text-gray-600 dark:text-gray-400">Sort:</span>
              <select
                value={sortBy}
                onChange={(e) => setSortBy(e.target.value as any)}
                className="px-3 py-1 border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 text-sm"
              >
                <option value="name">Name</option>
                <option value="created">Created</option>
                <option value="updated">Updated</option>
              </select>
              <button
                onClick={() => setSortOrder(prev => prev === 'asc' ? 'desc' : 'asc')}
                className="px-3 py-1 border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 text-sm hover:bg-gray-50 dark:hover:bg-gray-700"
              >
                {sortOrder === 'asc' ? '↑' : '↓'}
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-auto p-6">
        {filteredEntities.length === 0 ? (
          <div className="text-center text-gray-600 dark:text-gray-400 mt-12">
            {searchTerm || selectedTags.length > 0 ? (
              <>
                <p className="text-lg mb-2">No matching entities found</p>
                <p className="text-sm">Try adjusting your search or filters</p>
              </>
            ) : (
              <>
                <p className="text-lg mb-2">No entities yet</p>
                <p className="text-sm">Click "New {typeConfig?.label}" to get started</p>
              </>
            )}
          </div>
        ) : (
          <>
            {/* Grid/List Display */}
            <div className={displayStyle === 'grid' ? `grid ${gridClasses} gap-6` : 'space-y-4'}>
              {paginatedEntities.map(entity => (
                <div
                  key={entity.id}
                  onClick={() => handleEntityClick(entity)}
                  className={`border border-gray-200 dark:border-gray-700 rounded-lg hover:border-blue-400 dark:hover:border-blue-600 cursor-pointer bg-white dark:bg-gray-800 hover:shadow-lg transition-all ${
                    displayStyle === 'list' ? 'flex items-center gap-4 p-4' : 'p-6'
                  }`}
                >
                  {entity.image_url && (
                    <img
                      src={entity.image_url}
                      alt={entity.name}
                      className={
                        displayStyle === 'list'
                          ? 'w-16 h-16 object-cover rounded'
                          : 'w-full h-48 object-cover rounded mb-4'
                      }
                    />
                  )}
                  <div className="flex-1">
                    <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-1">
                      {entity.name || 'Untitled'}
                    </h3>
                    {getSubtitleText(entity) && (
                      <p className="text-sm text-gray-600 dark:text-gray-400 mb-2">
                        {getSubtitleText(entity)}
                      </p>
                    )}
                    {entity.tags && entity.tags.length > 0 && (
                      <div className="flex flex-wrap gap-1 mt-2">
                        {entity.tags.map((tag: string, i: number) => (
                          <span
                            key={i}
                            className="px-2 py-1 bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 rounded text-xs"
                          >
                            {tag}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>

            {/* Pagination */}
            {totalPages > 1 && (
              <div className="flex items-center justify-center gap-2 mt-8">
                <button
                  onClick={() => setCurrentPage(prev => Math.max(1, prev - 1))}
                  disabled={currentPage === 1}
                  className="px-4 py-2 border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 disabled:opacity-50 disabled:cursor-not-allowed hover:bg-gray-50 dark:hover:bg-gray-700"
                >
                  Previous
                </button>

                <span className="text-sm text-gray-600 dark:text-gray-400">
                  Page {currentPage} of {totalPages}
                </span>

                <button
                  onClick={() => setCurrentPage(prev => Math.min(totalPages, prev + 1))}
                  disabled={currentPage === totalPages}
                  className="px-4 py-2 border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 disabled:opacity-50 disabled:cursor-not-allowed hover:bg-gray-50 dark:hover:bg-gray-700"
                >
                  Next
                </button>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}
