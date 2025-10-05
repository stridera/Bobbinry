/**
 * Entity Preview Panel
 *
 * Context-aware preview panel that shows entity details
 * Handles disambiguation when multiple entities share the same name
 */

import { useState, useEffect } from 'react'
import type { BobbinrySDK } from '@bobbinry/sdk'
import type { EntityTypeDefinition } from '../types'
import { LayoutRenderer } from './LayoutRenderer'

interface EntityPreviewPanelProps {
  sdk: BobbinrySDK
  projectId: string
  entityName: string  // From text selection
  entityType?: string // Optional type hint
}

interface EntityMatch {
  id: string
  typeId: string
  typeName: string
  typeIcon: string
  entity: Record<string, any>
  typeConfig: EntityTypeDefinition
  score: number  // Relevance score for ranking
}

export function EntityPreviewPanel({
  sdk,
  projectId,
  entityName,
  entityType
}: EntityPreviewPanelProps) {
  const [matches, setMatches] = useState<EntityMatch[]>([])
  const [selectedMatch, setSelectedMatch] = useState<EntityMatch | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (entityName) {
      searchEntities()
    }
  }, [entityName, entityType])

  async function searchEntities() {
    try {
      setLoading(true)
      setError(null)

      console.log('[EntityPreview] Searching for:', entityName, 'type:', entityType)

      // TODO: Replace with actual API call when backend is ready
      // Step 1: Load all entity type definitions
      // const typeDefinitions = await sdk.entities.query({
      //   collection: 'entity_type_definitions',
      //   where: { projectId }
      // })

      // Step 2: Search for entities matching the name across all types (or specific type if provided)
      // const allMatches: EntityMatch[] = []

      // for (const typeDef of typeDefinitions.data) {
      //   // Skip if type hint provided and doesn't match
      //   if (entityType && typeDef.typeId !== entityType) continue
      //
      //   // Search in this entity type
      //   const results = await sdk.entities.query({
      //     collection: typeDef.typeId,
      //     where: {
      //       OR: [
      //         { name: { contains: entityName, mode: 'insensitive' } },
      //         { name: { equals: entityName, mode: 'insensitive' } }
      //       ]
      //     }
      //   })
      //
      //   // Add matches with metadata
      //   for (const entity of results.data) {
      //     allMatches.push({
      //       id: entity.id,
      //       typeId: typeDef.typeId,
      //       typeName: typeDef.label,
      //       typeIcon: typeDef.icon,
      //       entity,
      //       typeConfig: typeDef,
      //       score: calculateRelevanceScore(entity.name, entityName)
      //     })
      //   }
      // }

      // Step 3: Sort by relevance (exact match first, then partial)
      // allMatches.sort((a, b) => b.score - a.score)

      // setMatches(allMatches)

      // Auto-select if only one match
      // if (allMatches.length === 1) {
      //   setSelectedMatch(allMatches[0])
      // } else if (allMatches.length > 1) {
      //   // Auto-select best match if score is significantly higher
      //   if (allMatches[0].score > allMatches[1].score + 10) {
      //     setSelectedMatch(allMatches[0])
      //   }
      // }

      setLoading(false)
    } catch (err: any) {
      console.error('[EntityPreview] Search failed:', err)
      setError(err.message || 'Failed to search for entities')
      setLoading(false)
    }
  }

  function calculateRelevanceScore(entityNameValue: string, searchTerm: string): number {
    const lower = entityNameValue.toLowerCase()
    const search = searchTerm.toLowerCase()

    // Exact match
    if (lower === search) return 100

    // Starts with
    if (lower.startsWith(search)) return 80

    // Contains
    if (lower.includes(search)) return 60

    // Fuzzy match (same words in different order)
    const entityWords = lower.split(/\s+/)
    const searchWords = search.split(/\s+/)
    const matchCount = searchWords.filter(word => entityWords.includes(word)).length
    return (matchCount / searchWords.length) * 40
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full p-6">
        <div className="text-sm text-gray-600 dark:text-gray-400">
          Searching for "{entityName}"...
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="p-6">
        <div className="p-4 bg-red-50 dark:bg-red-900/20 border border-red-300 dark:border-red-700 rounded">
          <h3 className="text-sm font-semibold text-red-700 dark:text-red-300 mb-2">
            Search Error
          </h3>
          <p className="text-xs text-red-600 dark:text-red-400">{error}</p>
        </div>
      </div>
    )
  }

  if (matches.length === 0) {
    return (
      <div className="flex items-center justify-center h-full p-6">
        <div className="text-center">
          <p className="text-sm text-gray-600 dark:text-gray-400 mb-2">
            No entities found matching "{entityName}"
          </p>
          <p className="text-xs text-gray-500 dark:text-gray-500">
            Try selecting a different name
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className="flex flex-col h-full bg-white dark:bg-gray-900">
      {/* Disambiguation UI - only show if multiple matches */}
      {matches.length > 1 && (
        <div className="border-b border-gray-200 dark:border-gray-700 p-4 bg-gray-50 dark:bg-gray-800">
          <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100 mb-2">
            Multiple matches for "{entityName}"
          </h3>
          <p className="text-xs text-gray-600 dark:text-gray-400 mb-3">
            Select which entity to preview:
          </p>
          <div className="space-y-2">
            {matches.map(match => (
              <button
                key={`${match.typeId}-${match.id}`}
                onClick={() => setSelectedMatch(match)}
                className={`w-full px-3 py-2 rounded flex items-center gap-3 text-left transition-colors ${
                  selectedMatch?.id === match.id
                    ? 'bg-blue-600 dark:bg-blue-700 text-white'
                    : 'bg-white dark:bg-gray-700 hover:bg-gray-100 dark:hover:bg-gray-600 border border-gray-200 dark:border-gray-600'
                }`}
              >
                <span className="text-lg">{match.typeIcon}</span>
                <div className="flex-1 min-w-0">
                  <div className={`text-sm font-medium truncate ${
                    selectedMatch?.id === match.id
                      ? 'text-white'
                      : 'text-gray-900 dark:text-gray-100'
                  }`}>
                    {match.entity.name}
                  </div>
                  <div className={`text-xs truncate ${
                    selectedMatch?.id === match.id
                      ? 'text-blue-100 dark:text-blue-200'
                      : 'text-gray-600 dark:text-gray-400'
                  }`}>
                    {match.typeName}
                    {match.typeConfig.subtitleFields.length > 0 && (
                      <span className="ml-2">
                        {match.typeConfig.subtitleFields
                          .map(field => match.entity[field])
                          .filter(Boolean)
                          .join(' • ')}
                      </span>
                    )}
                  </div>
                </div>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Entity Preview */}
      <div className="flex-1 overflow-auto p-6">
        {selectedMatch ? (
          <div>
            {/* Header */}
            <div className="mb-4 pb-4 border-b border-gray-200 dark:border-gray-700">
              <div className="flex items-center gap-3 mb-2">
                <span className="text-3xl">{selectedMatch.typeIcon}</span>
                <div>
                  <h2 className="text-xl font-bold text-gray-900 dark:text-gray-100">
                    {selectedMatch.entity.name}
                  </h2>
                  <p className="text-sm text-gray-600 dark:text-gray-400">
                    {selectedMatch.typeName}
                  </p>
                </div>
              </div>
              {matches.length === 1 && (
                <p className="text-xs text-green-600 dark:text-green-400">
                  ✓ Exact match found
                </p>
              )}
            </div>

            {/* Entity Content */}
            <LayoutRenderer
              layout={selectedMatch.typeConfig.editorLayout}
              fields={selectedMatch.typeConfig.customFields}
              entity={selectedMatch.entity}
              onFieldChange={() => {}} // Read-only
              readonly={true}
            />

            {/* Quick Actions */}
            <div className="mt-6 pt-4 border-t border-gray-200 dark:border-gray-700 flex gap-2">
              <button
                onClick={() => {
                  console.log('[EntityPreview] Opening entity editor:', selectedMatch.id)
                  // TODO: Navigate to editor
                  // window.dispatchEvent(new CustomEvent('bobbinry:navigate', {
                  //   detail: {
                  //     view: 'entity-editor',
                  //     entityType: selectedMatch.typeId,
                  //     entityId: selectedMatch.id,
                  //     bobbinId: 'entities'
                  //   }
                  // }))
                }}
                className="px-4 py-2 bg-blue-600 dark:bg-blue-700 text-white rounded hover:bg-blue-700 dark:hover:bg-blue-600 text-sm font-medium"
              >
                Open Editor
              </button>
              <button
                onClick={() => {
                  console.log('[EntityPreview] Copying entity link:', selectedMatch.id)
                  // TODO: Copy entity reference to clipboard
                  // navigator.clipboard.writeText(`[[${selectedMatch.entity.name}]]`)
                }}
                className="px-4 py-2 bg-gray-200 dark:bg-gray-700 text-gray-900 dark:text-gray-100 rounded hover:bg-gray-300 dark:hover:bg-gray-600 text-sm font-medium"
              >
                Copy Link
              </button>
            </div>
          </div>
        ) : (
          <div className="flex items-center justify-center h-full">
            <p className="text-sm text-gray-600 dark:text-gray-400">
              Select an entity to preview
            </p>
          </div>
        )}
      </div>
    </div>
  )
}
