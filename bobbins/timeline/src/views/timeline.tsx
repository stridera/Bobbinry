import { useState, useEffect } from 'react'
import type { BobbinrySDK } from '@bobbinry/sdk'
import { Dialog } from '@bobbinry/ui-components'

interface TimelineViewProps {
  projectId: string
  bobbinId: string
  viewId: string
  sdk: BobbinrySDK
  entityId?: string
  metadata?: Record<string, any>
}

export default function TimelineView({
  sdk,
  projectId,
  entityId,
  metadata,
}: TimelineViewProps) {
  const [timeline, setTimeline] = useState<any | null>(null)
  const [events, setEvents] = useState<any[]>([])
  const [timelines, setTimelines] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [pendingDeleteEventId, setPendingDeleteEventId] = useState<string | null>(null)

  // Only treat the id as a real timeline id when it looks like a UUID — the
  // bobbin uses sentinels like 'home' to land on the picker without a 404.
  // Prefer metadata.timelineId; only fall back to entityId when it's clearly
  // a UUID (and may still turn out to be the wrong entity type — handled
  // below by checking whether loadTimeline actually resolved a timeline).
  const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
  const rawTimelineId = metadata?.timelineId || entityId
  const timelineIdCandidate = rawTimelineId && UUID_RE.test(rawTimelineId) ? rawTimelineId : null

  useEffect(() => {
    loadTimelines()
  }, [])

  useEffect(() => {
    if (timelineIdCandidate) {
      loadTimeline()
      loadEvents()
    } else {
      // No candidate at all — make sure we don't stall on the initial spinner.
      setTimeline(null)
      setEvents([])
      setLoading(false)
    }
  }, [timelineIdCandidate])

  // The "real" timeline id we use for create/navigate is only set when we
  // actually have a loaded timeline. Sentinel ids or relationship ids
  // that slipped through never reach here.
  const timelineId = timeline?.id ?? null

  async function loadTimelines() {
    try {
      const res = await sdk.entities.query({ collection: 'timelines', limit: 1000 })
      setTimelines((res.data as any[]) || [])
    } catch (err) {
      console.error('[Timeline] Failed to load timelines:', err)
    }
  }

  async function loadTimeline() {
    try {
      setLoading(true)
      setError(null)
      const res = await sdk.entities.get('timelines', timelineIdCandidate!)
      setTimeline(res)
      // SDK returns null for 404 — the candidate was a UUID but not a real
      // timeline (e.g. it was actually a relationship id we got from entityId
      // when this view appears as a tab on a non-timeline entity). Drop any
      // stale events so the render doesn't show "No events yet" for a
      // non-timeline entity.
      if (!res) setEvents([])
    } catch (err: any) {
      console.error('[Timeline] Failed to load timeline:', err)
      setError(err.message || 'Failed to load timeline')
    } finally {
      setLoading(false)
    }
  }

  async function loadEvents() {
    try {
      const res = await sdk.entities.query({ collection: 'timeline_events', limit: 1000 })
      const allEvents = (res.data as any[]) || []
      const filtered = allEvents
        .filter(e => e.timeline_id === timelineIdCandidate)
        .sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0))
      setEvents(filtered)
    } catch (err) {
      console.error('[Timeline] Failed to load events:', err)
    }
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
      selectTimeline(newTimeline.id)
    } catch (err) {
      console.error('[Timeline] Failed to create timeline:', err)
    }
  }

  async function createEvent() {
    if (!timelineId) return
    try {
      const newEvent = await sdk.entities.create('timeline_events', {
        title: 'New Event',
        description: '',
        date_label: 'Unknown Date',
        sort_order: events.length > 0 ? (events[events.length - 1].sort_order || 0) + 100 : 100,
        timeline_id: timelineId,
        linked_entities: [],
        tags: [],
        color: null,
        icon: null,
        duration_label: null,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      }) as any

      await loadEvents()
      openEventEditor(newEvent)
    } catch (err) {
      console.error('[Timeline] Failed to create event:', err)
    }
  }

  function openEventEditor(event: any) {
    window.dispatchEvent(new CustomEvent('bobbinry:navigate', {
      detail: {
        entityType: 'timeline_events',
        entityId: event.id,
        bobbinId: 'timeline',
        metadata: { view: 'event-editor', timelineId }
      }
    }))
  }

  function selectTimeline(id: string) {
    window.dispatchEvent(new CustomEvent('bobbinry:navigate', {
      detail: {
        entityType: 'timelines',
        entityId: id,
        bobbinId: 'timeline',
        metadata: { view: 'timeline', timelineId: id }
      }
    }))
  }

  function goToPicker() {
    // Re-enter the timeline view with a sentinel id so the picker renders.
    // The UUID guard above turns this into timelineId = null.
    window.dispatchEvent(new CustomEvent('bobbinry:navigate', {
      detail: {
        entityType: 'timelines',
        entityId: 'home',
        bobbinId: 'timeline',
        metadata: { view: 'timeline' }
      }
    }))
  }

  function handleDeleteEvent(e: React.MouseEvent, eventId: string) {
    e.stopPropagation()
    setPendingDeleteEventId(eventId)
  }

  async function confirmDeleteEvent() {
    const eventId = pendingDeleteEventId
    if (!eventId) return
    setPendingDeleteEventId(null)
    try {
      await sdk.entities.delete('timeline_events', eventId)
      await loadEvents()
    } catch (err) {
      console.error('[Timeline] Failed to delete event:', err)
    }
  }

  // Check the no-timeline state first — when there's no timelineId we never
  // kick off loadTimeline(), so `loading` stays at its initial `true` and
  // the loading check would stall on a spinner forever.
  if (!timelineId) {
    // True empty state: no timelines anywhere yet — show single big CTA.
    if (timelines.length === 0) {
      return (
        <div className="flex items-center justify-center h-full">
          <div className="text-center text-gray-600 dark:text-gray-400 max-w-sm">
            <p className="text-lg mb-2">No timelines yet</p>
            <p className="text-sm mb-4">
              Track plot points and world history on a chronological view.
            </p>
            <button
              onClick={createTimeline}
              className="px-4 py-2 bg-blue-600 dark:bg-blue-700 text-white rounded-lg hover:bg-blue-700 dark:hover:bg-blue-600 font-medium text-sm"
            >
              + Create Timeline
            </button>
          </div>
        </div>
      )
    }

    // Have timelines but none selected — render an in-view picker so users
    // don't have to hunt for the sidebar.
    return (
      <div className="flex flex-col h-full bg-gray-50 dark:bg-gray-900">
        <div className="border-b border-gray-200 dark:border-gray-700 p-4 bg-white dark:bg-gray-800">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">Timelines</h1>
              <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
                {timelines.length} timeline{timelines.length !== 1 ? 's' : ''} — pick one to view its events
              </p>
            </div>
            <button
              onClick={createTimeline}
              className="px-4 py-2 bg-blue-600 dark:bg-blue-700 text-white rounded-lg hover:bg-blue-700 dark:hover:bg-blue-600 font-medium text-sm"
            >
              + New Timeline
            </button>
          </div>
        </div>
        <div className="flex-1 overflow-auto p-6">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 max-w-5xl mx-auto">
            {timelines.map(t => (
              <button
                key={t.id}
                onClick={() => selectTimeline(t.id)}
                className="text-left bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg p-4 hover:shadow-md hover:border-blue-400 dark:hover:border-blue-600 transition-all"
                style={t.color ? { borderLeftColor: t.color, borderLeftWidth: '4px' } : undefined}
              >
                <div className="flex items-start gap-2">
                  <span
                    className="inline-block w-3 h-3 rounded-full mt-1 flex-shrink-0"
                    style={{ backgroundColor: t.color || '#6b7280' }}
                  />
                  <div className="flex-1 min-w-0">
                    <h3 className="font-medium text-gray-900 dark:text-gray-100 truncate">{t.name || 'Untitled timeline'}</h3>
                    {t.description && (
                      <p className="text-sm text-gray-600 dark:text-gray-400 mt-1 line-clamp-2">{t.description}</p>
                    )}
                    {t.scale && (
                      <p className="text-xs text-gray-500 dark:text-gray-500 mt-2">{t.scale}</p>
                    )}
                  </div>
                </div>
              </button>
            ))}
          </div>
        </div>
      </div>
    )
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
          <h2 className="text-lg font-semibold text-red-700 dark:text-red-300 mb-2">Error</h2>
          <p className="text-red-600 dark:text-red-400">{error}</p>
        </div>
      </div>
    )
  }

  return (
    <div className="flex flex-col h-full bg-gray-50 dark:bg-gray-900">
      {/* Header */}
      <div className="border-b border-gray-200 dark:border-gray-700 p-4 bg-white dark:bg-gray-800">
        <div className="flex items-center justify-between">
          <div>
            <button
              onClick={goToPicker}
              className="text-xs text-gray-500 hover:text-gray-900 dark:text-gray-400 dark:hover:text-gray-100 mb-1"
            >
              ← All Timelines
            </button>
            <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">
              {timeline?.name || 'Timeline'}
            </h1>
            {timeline?.description && (
              <p className="text-sm text-gray-600 dark:text-gray-400 mt-1">{timeline.description}</p>
            )}
            <p className="text-sm text-gray-500 mt-1">{events.length} event{events.length !== 1 ? 's' : ''}</p>
          </div>
          <button
            onClick={createEvent}
            className="px-4 py-2 bg-blue-600 dark:bg-blue-700 text-white rounded-lg hover:bg-blue-700 dark:hover:bg-blue-600 font-medium"
          >
            + New Event
          </button>
        </div>
      </div>

      {/* Vertical Timeline */}
      <div className="flex-1 overflow-auto p-6">
        {events.length === 0 ? (
          <div className="text-center text-gray-600 dark:text-gray-400 mt-12 max-w-sm mx-auto">
            <p className="text-lg mb-2">No events yet</p>
            <p className="text-sm mb-4">Add your first event to start building the chronology.</p>
            <button
              onClick={createEvent}
              className="px-4 py-2 bg-blue-600 dark:bg-blue-700 text-white rounded-lg hover:bg-blue-700 dark:hover:bg-blue-600 font-medium text-sm"
            >
              + Create First Event
            </button>
          </div>
        ) : (
          <div className="relative ml-8">
            {/* Vertical line */}
            <div className="absolute left-0 top-0 bottom-0 w-0.5 bg-gray-300 dark:bg-gray-600" />

            {events.map((event, index) => (
              <div key={event.id} className="relative pl-8 pb-8 last:pb-0">
                {/* Timeline dot */}
                <div
                  className="absolute left-0 -translate-x-1/2 w-4 h-4 rounded-full border-2 border-white dark:border-gray-900"
                  style={{ backgroundColor: event.color || timeline?.color || '#3b82f6' }}
                />

                {/* Event card */}
                <div
                  onClick={() => openEventEditor(event)}
                  className="border border-gray-200 dark:border-gray-700 rounded-lg p-4 bg-white dark:bg-gray-800 cursor-pointer hover:shadow-lg hover:border-blue-400 dark:hover:border-blue-600 transition-all"
                  style={event.color ? { borderLeftColor: event.color, borderLeftWidth: '4px' } : undefined}
                >
                  <div className="flex items-start justify-between">
                    <div className="flex-1">
                      <div className="flex items-center gap-2 mb-1">
                        <span className="text-xs font-medium text-blue-600 dark:text-blue-400 bg-blue-50 dark:bg-blue-900/30 px-2 py-0.5 rounded">
                          {event.date_label}
                        </span>
                        {event.duration_label && (
                          <span className="text-xs text-gray-500">{event.duration_label}</span>
                        )}
                      </div>
                      <h3 className="text-base font-semibold text-gray-900 dark:text-gray-100">
                        {event.icon && <span className="mr-1">{event.icon}</span>}
                        {event.title}
                      </h3>
                      {event.description && (
                        <p className="text-sm text-gray-600 dark:text-gray-400 mt-1 line-clamp-2">
                          {event.description}
                        </p>
                      )}
                      {event.tags && event.tags.length > 0 && (
                        <div className="flex flex-wrap gap-1 mt-2">
                          {event.tags.map((tag: string, i: number) => (
                            <span key={i} className="px-2 py-0.5 bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-400 rounded text-xs">
                              {tag}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                    <button
                      onClick={(e) => handleDeleteEvent(e, event.id)}
                      className="text-gray-400 hover:text-red-500 text-sm ml-2 flex-shrink-0"
                      title="Delete event"
                    >
                      ×
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
      <Dialog
        open={pendingDeleteEventId !== null}
        title="Delete this event?"
        message="This event will be removed from the timeline."
        variant="danger"
        confirmLabel="Delete"
        onConfirm={confirmDeleteEvent}
        onCancel={() => setPendingDeleteEventId(null)}
      />
    </div>
  )
}
