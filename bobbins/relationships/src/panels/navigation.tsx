import { useState, useEffect, useMemo } from 'react'
import {
  BobbinrySDK,
  PanelActions,
  PanelActionButton,
  PanelBody,
  PanelEmptyState,
  PanelFrame,
  PanelIconButton,
  PanelLoadingState,
  PanelMessage,
  PanelPill,
  PanelSectionTitle,
} from '@bobbinry/sdk'

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
  const [error, setError] = useState<string | null>(null)
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
      setError(null)
      const res = await sdk.entities.query({ collection: 'relationships', limit: 1000 })
      setRelationships((res.data as any[]) || [])
    } catch (error) {
      console.error('[Relationships Navigation] Failed to load:', error)
      setError('Failed to load relationships.')
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
    setSelectedType(type || null)
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
    return <PanelLoadingState label="Loading relationships…" />
  }

  if (!projectId) {
    return <PanelEmptyState title="No project selected" description="Open a project to browse relationship maps and types." />
  }

  return (
    <PanelFrame>
      <PanelActions>
        <PanelIconButton
          onClick={() => openEditor()}
          title="New Relationship"
        >
          <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M12 5v14M5 12h14" />
          </svg>
        </PanelIconButton>
        <PanelIconButton
          onClick={loadData}
          title="Refresh"
        >
          <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M4 4v6h6M20 20v-6h-6" />
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M20 9a8 8 0 00-13.66-4.95L4 10M4 15a8 8 0 0013.66 4.95L20 14" />
          </svg>
        </PanelIconButton>
      </PanelActions>

      <PanelBody className="space-y-4">
        <div className="flex items-center justify-between gap-3">
          <PanelSectionTitle>Relationship Maps</PanelSectionTitle>
          <PanelPill>{relationships.length} links</PanelPill>
        </div>

        {error ? <PanelMessage tone="error">{error}</PanelMessage> : null}

        <div className="space-y-2">
          <PanelSectionTitle>Views</PanelSectionTitle>
          <div className="space-y-1">
            <button
              onClick={() => openGraph()}
              className="flex w-full items-center gap-2 rounded-lg px-2 py-2 text-left text-sm text-gray-800 transition-colors hover:bg-gray-100 dark:text-gray-200 dark:hover:bg-gray-700"
            >
              <svg className="h-4 w-4 text-gray-400 dark:text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M8 8h.01M16 8h.01M12 12h.01M8 16h.01M16 16h.01M7 7l10 10M17 7L7 17" />
              </svg>
              Graph view
            </button>
            <button
              onClick={openMatrix}
              className="flex w-full items-center gap-2 rounded-lg px-2 py-2 text-left text-sm text-gray-800 transition-colors hover:bg-gray-100 dark:text-gray-200 dark:hover:bg-gray-700"
            >
              <svg className="h-4 w-4 text-gray-400 dark:text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M4 6h16M4 12h16M4 18h16M8 4v16M16 4v16" />
              </svg>
              Matrix view
            </button>
          </div>
        </div>

        <div className="space-y-2">
          <PanelSectionTitle>Types</PanelSectionTitle>
          {types.length === 0 ? (
            <PanelEmptyState
              title="No relationships yet"
              description="Create a relationship to see type-based navigation here."
              action={
                <PanelActionButton onClick={() => openEditor()} tone="primary">
                  Create relationship
                </PanelActionButton>
              }
            />
          ) : (
            <div className="space-y-1">
              {types.map(type => (
                <button
                  key={type}
                  onClick={() => openGraph(type)}
                  className={`flex w-full items-center justify-between rounded-lg px-2 py-2 text-left text-sm transition-colors ${
                    selectedType === type
                      ? 'bg-gray-100 text-gray-900 dark:bg-gray-700 dark:text-white'
                      : 'text-gray-800 hover:bg-gray-100 dark:text-gray-200 dark:hover:bg-gray-700'
                  }`}
                >
                  <span className="truncate capitalize">{type}</span>
                  <PanelPill>{typeCounts.get(type)}</PanelPill>
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="border-t border-gray-200 pt-3 text-xs text-gray-500 dark:border-gray-700 dark:text-gray-400">
          {relationships.length} relationship{relationships.length !== 1 ? 's' : ''} · {types.length} type{types.length !== 1 ? 's' : ''}
        </div>
      </PanelBody>
    </PanelFrame>
  )
}
