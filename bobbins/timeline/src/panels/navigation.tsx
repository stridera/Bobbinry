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
  const [timelines, setTimelines] = useState<any[]>([])
  const [eventCounts, setEventCounts] = useState<Map<string, number>>(new Map())
  const [loading, setLoading] = useState(true)
  const [selectedTimelineId, setSelectedTimelineId] = useState<string | null>(null)
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

  async function handleDelete(id: string) {
    if (!confirm('Delete this timeline and all its events? This cannot be undone.')) return
    try {
      await sdk.entities.delete('timelines', id)
      await loadData()
      if (selectedTimelineId === id) setSelectedTimelineId(null)
    } catch (error) {
      console.error('Failed to delete:', error)
    }
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
    <div className="h-full flex flex-col bg-white dark:bg-gray-800">
      <PanelActions>
        <button
          onClick={createTimeline}
          className="text-lg leading-none text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200 w-6 h-6 flex items-center justify-center"
          title="New Timeline"
        >
          +
        </button>
        <button
          onClick={loadData}
          className="text-xs text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200"
          title="Refresh"
        >
          ↻
        </button>
      </PanelActions>

      <div className="flex-1 overflow-y-auto">
        {timelines.length === 0 ? (
          <div className="p-4 text-center text-sm text-gray-500 dark:text-gray-400">
            <div className="mb-3">No timelines yet</div>
            <button
              onClick={createTimeline}
              className="px-3 py-1.5 text-xs bg-gray-100 hover:bg-gray-200 dark:bg-gray-700 dark:hover:bg-gray-600 text-gray-700 dark:text-gray-200 rounded"
            >
              Create Your First Timeline
            </button>
          </div>
        ) : (
          timelines.map(timeline => {
            const isSelected = selectedTimelineId === timeline.id
            const isEditing = editingId === timeline.id
            const count = eventCounts.get(timeline.id) || 0

            return (
              <div
                key={timeline.id}
                className={`px-3 py-2 cursor-pointer border-b border-gray-200 dark:border-gray-700/50 hover:bg-gray-100 dark:hover:bg-gray-700 ${isSelected ? 'bg-gray-100 dark:bg-gray-700' : ''}`}
                onClick={() => handleTimelineClick(timeline)}
                onContextMenu={(e) => { e.preventDefault(); handleDelete(timeline.id) }}
              >
                <div className="flex items-center gap-2">
                  {timeline.color && (
                    <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: timeline.color }} />
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
                      className="flex-1 px-1 py-0.5 bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded text-gray-900 dark:text-gray-100 text-sm"
                      onClick={(e) => e.stopPropagation()}
                    />
                  ) : (
                    <span className="flex-1 text-sm text-gray-800 dark:text-gray-200 truncate">{timeline.name}</span>
                  )}
                  <span className="text-xs text-gray-500">{count}</span>
                </div>
                {timeline.scale && (
                  <span className="text-[10px] text-gray-500 ml-4">{timeline.scale}</span>
                )}
              </div>
            )
          })
        )}
      </div>
    </div>
  )
}
