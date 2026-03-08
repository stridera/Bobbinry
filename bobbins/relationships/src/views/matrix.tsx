import { useState, useEffect, useMemo } from 'react'
import type { BobbinrySDK } from '@bobbinry/sdk'

interface MatrixViewProps {
  projectId: string
  bobbinId: string
  viewId: string
  sdk: BobbinrySDK
  metadata?: Record<string, any>
}

export default function MatrixView({
  sdk,
  projectId,
}: MatrixViewProps) {
  const [relationships, setRelationships] = useState<any[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    loadData()
  }, [])

  async function loadData() {
    try {
      setLoading(true)
      const res = await sdk.entities.query({ collection: 'relationships', limit: 1000 })
      setRelationships((res.data as any[]) || [])
    } catch (err) {
      console.error('[Matrix] Failed to load:', err)
    } finally {
      setLoading(false)
    }
  }

  const { entities, matrix } = useMemo(() => {
    const entitySet = new Set<string>()
    for (const rel of relationships) {
      entitySet.add(rel.source_entity_id)
      entitySet.add(rel.target_entity_id)
    }
    const entities = Array.from(entitySet).sort()

    // Build matrix
    const matrix = new Map<string, Map<string, any>>()
    for (const rel of relationships) {
      if (!matrix.has(rel.source_entity_id)) {
        matrix.set(rel.source_entity_id, new Map())
      }
      matrix.get(rel.source_entity_id)!.set(rel.target_entity_id, rel)

      // If bidirectional, set reverse too
      if (rel.bidirectional) {
        if (!matrix.has(rel.target_entity_id)) {
          matrix.set(rel.target_entity_id, new Map())
        }
        matrix.get(rel.target_entity_id)!.set(rel.source_entity_id, rel)
      }
    }

    return { entities, matrix }
  }, [relationships])

  function getCellContent(sourceId: string, targetId: string): any | null {
    return matrix.get(sourceId)?.get(targetId) || null
  }

  function openEditor(id?: string) {
    window.dispatchEvent(new CustomEvent('bobbinry:navigate', {
      detail: {
        entityType: 'relationships',
        entityId: id || 'new',
        bobbinId: 'relationships',
        metadata: { view: 'relationship-editor', isNew: !id }
      }
    }))
  }

  const STRENGTH_COLORS = {
    weak: 'bg-blue-200 dark:bg-blue-900/40',
    moderate: 'bg-blue-400 dark:bg-blue-700/60',
    strong: 'bg-blue-600 dark:bg-blue-500/80',
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-gray-600 dark:text-gray-400">Loading...</div>
      </div>
    )
  }

  return (
    <div className="flex flex-col h-full bg-gray-50 dark:bg-gray-900">
      {/* Header */}
      <div className="border-b border-gray-200 dark:border-gray-700 p-4 bg-white dark:bg-gray-800">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">Relationship Matrix</h1>
            <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
              {entities.length} entities, {relationships.length} relationships
            </p>
          </div>
          <button
            onClick={() => openEditor()}
            className="px-4 py-2 bg-blue-600 dark:bg-blue-700 text-white rounded-lg hover:bg-blue-700 dark:hover:bg-blue-600 font-medium text-sm"
          >
            + New Relationship
          </button>
        </div>
      </div>

      {/* Matrix Grid */}
      <div className="flex-1 overflow-auto p-4">
        {entities.length === 0 ? (
          <div className="text-center text-gray-600 dark:text-gray-400 mt-12">
            <p className="text-lg mb-2">No relationships yet</p>
            <p className="text-sm">Create relationships between entities to see the matrix</p>
          </div>
        ) : (
          <div className="overflow-auto">
            <table className="border-collapse text-xs">
              <thead>
                <tr>
                  <th className="p-2 border border-gray-300 dark:border-gray-600 bg-gray-100 dark:bg-gray-800 sticky left-0 z-10" />
                  {entities.map(id => (
                    <th
                      key={id}
                      className="p-2 border border-gray-300 dark:border-gray-600 bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300 font-medium min-w-[80px]"
                    >
                      <div className="truncate max-w-[80px]" title={id}>{id.substring(0, 8)}</div>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {entities.map(sourceId => (
                  <tr key={sourceId}>
                    <td className="p-2 border border-gray-300 dark:border-gray-600 bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300 font-medium sticky left-0 z-10">
                      <div className="truncate max-w-[80px]" title={sourceId}>{sourceId.substring(0, 8)}</div>
                    </td>
                    {entities.map(targetId => {
                      const rel = getCellContent(sourceId, targetId)
                      const isSelf = sourceId === targetId

                      return (
                        <td
                          key={targetId}
                          className={`p-1 border border-gray-300 dark:border-gray-600 text-center ${
                            isSelf
                              ? 'bg-gray-200 dark:bg-gray-700'
                              : rel
                                ? `${STRENGTH_COLORS[rel.strength as keyof typeof STRENGTH_COLORS] || STRENGTH_COLORS.moderate} cursor-pointer`
                                : 'bg-white dark:bg-gray-900'
                          }`}
                          onClick={() => rel && openEditor(rel.id)}
                          title={rel ? `${rel.relationship_type}${rel.label ? ': ' + rel.label : ''}` : ''}
                        >
                          {rel && (
                            <span className="text-[10px] text-gray-800 dark:text-gray-200">
                              {rel.relationship_type?.charAt(0).toUpperCase() || '·'}
                            </span>
                          )}
                        </td>
                      )
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* Legend */}
        {entities.length > 0 && (
          <div className="mt-4 flex items-center gap-4 text-xs text-gray-500">
            <span>Strength:</span>
            <span className="flex items-center gap-1"><span className="w-3 h-3 bg-blue-200 dark:bg-blue-900/40 rounded" /> Weak</span>
            <span className="flex items-center gap-1"><span className="w-3 h-3 bg-blue-400 dark:bg-blue-700/60 rounded" /> Moderate</span>
            <span className="flex items-center gap-1"><span className="w-3 h-3 bg-blue-600 dark:bg-blue-500/80 rounded" /> Strong</span>
          </div>
        )}
      </div>
    </div>
  )
}
