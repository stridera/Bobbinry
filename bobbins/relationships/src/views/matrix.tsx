import { useState, useEffect, useMemo, type CSSProperties } from 'react'
import type { BobbinrySDK } from '@bobbinry/sdk'
import { resolveEntityNames, type ResolvedEntity } from '../entity-names'

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
  const [entityNames, setEntityNames] = useState<Map<string, ResolvedEntity>>(new Map())
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    loadData()
  }, [])

  async function loadData() {
    try {
      setLoading(true)
      const res = await sdk.entities.query({ collection: 'relationships', limit: 1000 })
      const rels = (res.data as any[]) || []
      setRelationships(rels)
      const names = await resolveEntityNames(sdk, rels)
      setEntityNames(names)
    } catch (err) {
      console.error('[Matrix] Failed to load:', err)
    } finally {
      setLoading(false)
    }
  }

  function labelFor(id: string): string {
    return entityNames.get(id)?.name || `(${id.slice(0, 8)})`
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

  function openEditor(
    id?: string,
    prefill?: { sourceId: string; sourceCollection: string; targetId: string; targetCollection: string }
  ) {
    const metadata: Record<string, any> = { view: 'relationship-editor', isNew: !id }
    if (prefill) metadata.prefill = prefill
    window.dispatchEvent(new CustomEvent('bobbinry:navigate', {
      detail: {
        entityType: 'relationships',
        entityId: id || 'new',
        bobbinId: 'relationships',
        metadata
      }
    }))
  }

  // Inline diagonal-hatch background to mark self cells as "not applicable" —
  // a flat color was indistinguishable from "empty off-diagonal" in dark mode.
  const SELF_HATCH_STYLE: CSSProperties = {
    backgroundImage:
      'repeating-linear-gradient(45deg, rgba(156,163,175,0.25) 0 2px, transparent 2px 8px)'
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
          <div className="text-center text-gray-600 dark:text-gray-400 mt-12 max-w-sm mx-auto">
            <p className="text-lg mb-2">No relationships yet</p>
            <p className="text-sm mb-4">Add a relationship to start building the matrix.</p>
            <button
              onClick={() => openEditor()}
              className="px-4 py-2 bg-blue-600 dark:bg-blue-700 text-white rounded-lg hover:bg-blue-700 dark:hover:bg-blue-600 font-medium text-sm"
            >
              + Create First Relationship
            </button>
          </div>
        ) : (
          <div className="overflow-auto">
            <table className="border-collapse text-xs">
              <thead>
                <tr>
                  <th className="p-2 border border-gray-300 dark:border-gray-600 bg-gray-100 dark:bg-gray-800 sticky left-0 z-10" />
                  {entities.map(id => {
                    const name = labelFor(id)
                    return (
                      <th
                        key={id}
                        className="p-2 border border-gray-300 dark:border-gray-600 bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300 font-medium min-w-[100px]"
                      >
                        <div className="truncate max-w-[120px]" title={name}>{name}</div>
                      </th>
                    )
                  })}
                </tr>
              </thead>
              <tbody>
                {entities.map(sourceId => {
                  const sourceName = labelFor(sourceId)
                  return (
                  <tr key={sourceId}>
                    <td className="p-2 border border-gray-300 dark:border-gray-600 bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300 font-medium sticky left-0 z-10">
                      <div className="truncate max-w-[120px]" title={sourceName}>{sourceName}</div>
                    </td>
                    {entities.map(targetId => {
                      const rel = getCellContent(sourceId, targetId)
                      const isSelf = sourceId === targetId
                      const sourceCollection = entityNames.get(sourceId)?.collection
                      const targetCollection = entityNames.get(targetId)?.collection
                      const canCreate = !isSelf && !rel && !!sourceCollection && !!targetCollection

                      return (
                        <td
                          key={targetId}
                          style={isSelf ? SELF_HATCH_STYLE : undefined}
                          className={`p-1 border border-gray-300 dark:border-gray-600 text-center ${
                            isSelf
                              ? 'bg-gray-100 dark:bg-gray-800'
                              : rel
                                ? `${STRENGTH_COLORS[rel.strength as keyof typeof STRENGTH_COLORS] || STRENGTH_COLORS.moderate} cursor-pointer hover:ring-2 hover:ring-blue-400 dark:hover:ring-blue-500`
                                : canCreate
                                  ? 'bg-white dark:bg-gray-800 cursor-pointer hover:bg-blue-50 dark:hover:bg-blue-900/30'
                                  : 'bg-white dark:bg-gray-800'
                          }`}
                          onClick={() => {
                            if (rel) openEditor(rel.id)
                            else if (canCreate) openEditor(undefined, {
                              sourceId, sourceCollection: sourceCollection!,
                              targetId, targetCollection: targetCollection!
                            })
                          }}
                          title={
                            rel
                              ? `${rel.relationship_type}${rel.label ? ': ' + rel.label : ''}`
                              : canCreate
                                ? `Click to link ${sourceName} → ${labelFor(targetId)}`
                                : ''
                          }
                        >
                          {rel && (
                            <span className="block truncate text-[10px] text-gray-800 dark:text-gray-200 px-1">
                              {rel.relationship_type || '·'}
                            </span>
                          )}
                          {canCreate && (
                            <span className="text-[10px] text-gray-300 dark:text-gray-600 select-none">+</span>
                          )}
                        </td>
                      )
                    })}
                  </tr>
                  )
                })}
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
