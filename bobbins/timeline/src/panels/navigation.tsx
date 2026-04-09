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
import { Dialog } from '@bobbinry/ui-components'

interface NavigationPanelProps {
  context?: {
    projectId?: string
    currentProject?: string
    currentView?: string
    apiToken?: string
  }
}

export default function NavigationPanel({ context }: NavigationPanelProps) {
  const [timelines, setTimelines] = useState<any[]>([])
  const [eventCounts, setEventCounts] = useState<Map<string, number>>(new Map())
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [selectedTimelineId, setSelectedTimelineId] = useState<string | null>(null)
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editingValue, setEditingValue] = useState('')

  const [sdk] = useState(() => new BobbinrySDK('timeline'))
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
      setTimelines([])
    }
  }, [projectId, context?.apiToken])

  useEffect(() => {
    function handleViewContextChange(e: Event) {
      const detail = (e as CustomEvent).detail
      if (detail?.metadata?.timelineId) {
        setSelectedTimelineId(detail.metadata.timelineId)
      }
    }
    window.addEventListener('bobbinry:view-context-change', handleViewContextChange)
    return () => window.removeEventListener('bobbinry:view-context-change', handleViewContextChange)
  }, [])

  async function loadData() {
    try {
      setLoading(true)
      setError(null)
      const [timelinesRes, eventsRes] = await Promise.all([
        sdk.entities.query({ collection: 'timelines', limit: 1000 }),
        sdk.entities.query({ collection: 'timeline_events', limit: 1000 })
      ])

      const timelineData = (timelinesRes.data as any[]) || []
      const eventData = (eventsRes.data as any[]) || []

      // Count events per timeline
      const counts = new Map<string, number>()
      for (const event of eventData) {
        const tid = event.timeline_id
        counts.set(tid, (counts.get(tid) || 0) + 1)
      }

      setTimelines(timelineData)
      setEventCounts(counts)
    } catch (error) {
      console.error('[Timeline Navigation] Failed to load:', error)
      setError('Failed to load timelines.')
    } finally {
      setLoading(false)
    }
  }

  function handleTimelineClick(timeline: any) {
    setSelectedTimelineId(timeline.id)
    window.dispatchEvent(new CustomEvent('bobbinry:navigate', {
      detail: {
        entityType: 'timelines',
        entityId: timeline.id,
        bobbinId: 'timeline',
        metadata: { view: 'timeline', timelineId: timeline.id }
      }
    }))
  }

  async function createTimeline() {
    try {
      const newTimeline = await sdk.entities.create('timelines', {
        name: 'New Timeline',
        description: '',
        scale: 'years',
        color: null,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      }) as any

      await loadData()
      setEditingId(newTimeline.id)
      setEditingValue('New Timeline')
    } catch (error) {
      console.error('Failed to create timeline:', error)
    }
  }

  async function handleRename(id: string, newName: string) {
    if (!newName.trim()) {
      setEditingId(null)
      return
    }
    try {
      await sdk.entities.update('timelines', id, {
        name: newName.trim(),
        updated_at: new Date().toISOString()
      })
      await loadData()
      setEditingId(null)
    } catch (error) {
      console.error('Failed to rename:', error)
    }
  }

  async function confirmDelete() {
    const id = pendingDeleteId
    if (!id) return
    setPendingDeleteId(null)
    try {
      await sdk.entities.delete('timelines', id)
      await loadData()
      if (selectedTimelineId === id) setSelectedTimelineId(null)
    } catch (error) {
      console.error('Failed to delete:', error)
    }
  }

  if (loading) {
    return <PanelLoadingState label="Loading timelines…" />
  }

  if (!projectId) {
    return <PanelEmptyState title="No project selected" description="Open a project to browse timeline collections." />
  }

  return (
    <PanelFrame>
      <PanelActions>
        <PanelIconButton
          onClick={createTimeline}
          title="New Timeline"
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

      <PanelBody className="space-y-3" padded={false}>
        <div className="flex items-center justify-between gap-3 px-3 pt-3">
          <PanelSectionTitle>Timeline Collections</PanelSectionTitle>
          <PanelPill>{timelines.length} total</PanelPill>
        </div>

        {error ? <PanelMessage tone="error">{error}</PanelMessage> : null}

        {timelines.length === 0 ? (
          <PanelEmptyState
            title="No timelines yet"
            description="Create a timeline to organize events and chronology."
            action={
              <PanelActionButton
                onClick={createTimeline}
                tone="primary"
              >
                Create timeline
              </PanelActionButton>
            }
          />
        ) : (
          timelines.map(timeline => {
            const isSelected = selectedTimelineId === timeline.id
            const isEditing = editingId === timeline.id
            const count = eventCounts.get(timeline.id) || 0

            return (
              <div
                key={timeline.id}
                className={`cursor-pointer border-b border-gray-200 px-3 py-2 dark:border-gray-700/50 ${
                  isSelected ? 'bg-gray-100 dark:bg-gray-700' : 'hover:bg-gray-100 dark:hover:bg-gray-700'
                }`}
                onClick={() => handleTimelineClick(timeline)}
                onContextMenu={(e) => { e.preventDefault(); setPendingDeleteId(timeline.id) }}
              >
                <div className="flex items-center gap-2">
                  {timeline.color && (
                    <span className="h-2 w-2 flex-shrink-0 rounded-full" style={{ backgroundColor: timeline.color }} />
                  )}
                  {isEditing ? (
                    <input
                      type="text"
                      value={editingValue}
                      onChange={(e) => setEditingValue(e.target.value)}
                      onBlur={() => handleRename(timeline.id, editingValue)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') handleRename(timeline.id, editingValue)
                        else if (e.key === 'Escape') setEditingId(null)
                      }}
                      autoFocus
                      onFocus={(e) => e.target.select()}
                      className="flex-1 rounded border border-gray-300 bg-white px-1 py-0.5 text-sm text-gray-900 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100"
                      onClick={(e) => e.stopPropagation()}
                    />
                  ) : (
                    <span className="flex-1 truncate text-sm text-gray-800 dark:text-gray-200">{timeline.name}</span>
                  )}
                  <PanelPill>{count}</PanelPill>
                </div>
                {timeline.scale && (
                  <div className="mt-1 pl-4 text-[11px] uppercase tracking-[0.14em] text-gray-500 dark:text-gray-400">
                    {timeline.scale}
                  </div>
                )}
              </div>
            )
          })
        )}
      </PanelBody>
      <Dialog
        open={pendingDeleteId !== null}
        title="Delete this timeline?"
        message="This will also delete all of its events. This cannot be undone."
        variant="danger"
        confirmLabel="Delete"
        onConfirm={confirmDelete}
        onCancel={() => setPendingDeleteId(null)}
      />
    </PanelFrame>
  )
}
