import { useState, useEffect, useMemo } from 'react'
import { BobbinrySDK, PanelActions } from '@bobbinry/sdk'

interface NavigationPanelProps {
  context?: {
    projectId?: string
    currentProject?: string
    currentView?: string
    apiToken?: string
  }
}

export default function NavigationPanel({ context }: NavigationPanelProps) {
  const [relationships, setRelationships] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [selectedType, setSelectedType] = useState<string | null>(null)

  const [sdk] = useState(() => new BobbinrySDK('relationships'))
  const projectId = useMemo(() => context?.projectId || context?.currentProject, [context?.projectId, context?.currentProject])

  useEffect(() => {
    if (context?.apiToken) {
      sdk.api.setAuthToken(context.apiToken)
    }
  }, [context?.apiToken, sdk])

  useEffect(() => {
    if (projectId && context?.apiToken) {
      sdk.setProject(projectId)
      loadData()
    } else if (!projectId) {
      setLoading(false)
      setRelationships([])
    }
  }, [projectId, context?.apiToken])

  async function loadData() {
    try {
      setLoading(true)
      const res = await sdk.entities.query({ collection: 'relationships', limit: 1000 })
      setRelationships((res.data as any[]) || [])
    } catch (error) {
      console.error('[Relationships Navigation] Failed to load:', error)
    } finally {
      setLoading(false)
    }
  }

  const typeCounts = useMemo(() => {
    const counts = new Map<string, number>()
    for (const rel of relationships) {
      const type = rel.relationship_type || 'unknown'
      counts.set(type, (counts.get(type) || 0) + 1)
    }
    return counts
  }, [relationships])

  const types = useMemo(() => Array.from(typeCounts.keys()).sort(), [typeCounts])

  function openGraph(type?: string) {
    window.dispatchEvent(new CustomEvent('bobbinry:navigate', {
      detail: {
        entityType: 'relationships',
        entityId: 'graph',
        bobbinId: 'relationships',
        metadata: { view: 'graph', filterType: type || null }
      }
    }))
  }

  function openMatrix() {
    window.dispatchEvent(new CustomEvent('bobbinry:navigate', {
      detail: {
        entityType: 'relationships',
        entityId: 'matrix',
        bobbinId: 'relationships',
        metadata: { view: 'matrix' }
      }
    }))
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

  if (loading) {
    return (
      <div className="p-4 text-center text-sm text-gray-500 dark:text-gray-400">
        <div className="animate-pulse">Loading...</div>
      </div>
    )
  }

  if (!projectId) {
    return (
      <div className="p-4 text-center text-sm text-gray-500 dark:text-gray-400">
        No project selected
      </div>
    )
  }

  return (
    <div className="h-full flex flex-col bg-gray-800">
      <PanelActions>
        <button
          onClick={() => openEditor()}
          className="text-lg leading-none text-gray-400 hover:text-gray-200 w-6 h-6 flex items-center justify-center"
          title="New Relationship"
        >
          +
        </button>
        <button
          onClick={loadData}
          className="text-xs text-gray-400 hover:text-gray-200"
          title="Refresh"
        >
          ↻
        </button>
      </PanelActions>

      <div className="flex-1 overflow-y-auto">
        {/* Quick Views */}
        <div className="px-3 py-2 border-b border-gray-700">
          <div className="text-[10px] text-gray-500 uppercase tracking-wide mb-1">Views</div>
          <button
            onClick={() => openGraph()}
            className="w-full text-left px-2 py-1.5 text-sm text-gray-200 hover:bg-gray-700 rounded flex items-center gap-2"
          >
            <span>🕸️</span> Graph View
          </button>
          <button
            onClick={openMatrix}
            className="w-full text-left px-2 py-1.5 text-sm text-gray-200 hover:bg-gray-700 rounded flex items-center gap-2"
          >
            <span>📊</span> Matrix View
          </button>
        </div>

        {/* Relationship Types */}
        <div className="px-3 py-2">
          <div className="text-[10px] text-gray-500 uppercase tracking-wide mb-1">Types</div>
          {types.length === 0 ? (
            <div className="text-center text-sm text-gray-400 py-4">
              <div className="mb-2">No relationships yet</div>
              <button
                onClick={() => openEditor()}
                className="px-3 py-1.5 text-xs bg-gray-700 hover:bg-gray-600 text-gray-200 rounded"
              >
                Create First Relationship
              </button>
            </div>
          ) : (
            types.map(type => (
              <button
                key={type}
                onClick={() => openGraph(type)}
                className={`w-full text-left px-2 py-1.5 text-sm hover:bg-gray-700 rounded flex items-center justify-between ${selectedType === type ? 'bg-gray-700 text-white' : 'text-gray-200'}`}
              >
                <span className="truncate capitalize">{type}</span>
                <span className="text-xs text-gray-500">{typeCounts.get(type)}</span>
              </button>
            ))
          )}
        </div>

        {/* Summary */}
        <div className="px-3 py-2 border-t border-gray-700 mt-auto">
          <div className="text-xs text-gray-500">
            {relationships.length} relationship{relationships.length !== 1 ? 's' : ''} · {types.length} type{types.length !== 1 ? 's' : ''}
          </div>
        </div>
      </div>
    </div>
  )
}
