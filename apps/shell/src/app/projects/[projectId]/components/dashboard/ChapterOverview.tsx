'use client'

import { useCallback, useEffect, useMemo, useState, type ChangeEvent, type ReactNode } from 'react'
import Link from 'next/link'
import { useSession } from 'next-auth/react'
import { apiFetch } from '@/lib/api'
import {
  CONTENT_TYPES,
  CONTENT_TYPE_GROUPS,
  CONTENT_TYPE_LABELS,
  countsTowardWordCount,
  type ContentType,
} from '@bobbinry/types'
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core'
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'

interface Chapter {
  id: string
  slug?: string | null
  title: string
  order: number
  collectionName: string
  contentType: ContentType
  archivedAt: string | null
  wordCount: number
  commentCount: number
  reactionCount: number
  annotationCount: number
  publication: {
    publishStatus: string
    publishedAt: string | null
    viewCount: number
    uniqueViewCount: number
    completionCount: number
    avgReadTimeSeconds: number | null
  } | null
}

interface ChapterOverviewProps {
  chapters: Chapter[]
  projectId: string
  readerBaseUrl: string | null
  onStatusChange?: () => void
}

type FilterKey = 'all' | 'manuscript' | 'outlines' | 'reference' | 'archived'

const STATUS_COLORS: Record<string, string> = {
  draft: 'bg-gray-100 text-gray-700 dark:bg-gray-700 dark:text-gray-300',
  complete: 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300',
  scheduled: 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300',
  published: 'bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300',
  archived: 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300',
}

const STATUS_LABELS: Record<string, string> = {
  complete: 'ready',
}

const ROW_TINTS: Record<string, string> = {
  complete: 'bg-blue-50/40 dark:bg-blue-950/10',
  published: 'bg-green-50/30 dark:bg-green-950/10',
}

const TYPE_COLORS: Record<ContentType, string> = {
  chapter: 'bg-blue-50 text-blue-700 ring-blue-200 dark:bg-blue-900/30 dark:text-blue-300 dark:ring-blue-800',
  scene: 'bg-indigo-50 text-indigo-700 ring-indigo-200 dark:bg-indigo-900/30 dark:text-indigo-300 dark:ring-indigo-800',
  prologue: 'bg-purple-50 text-purple-700 ring-purple-200 dark:bg-purple-900/30 dark:text-purple-300 dark:ring-purple-800',
  epilogue: 'bg-pink-50 text-pink-700 ring-pink-200 dark:bg-pink-900/30 dark:text-pink-300 dark:ring-pink-800',
  interlude: 'bg-teal-50 text-teal-700 ring-teal-200 dark:bg-teal-900/30 dark:text-teal-300 dark:ring-teal-800',
  outline: 'bg-amber-50 text-amber-700 ring-amber-200 dark:bg-amber-900/30 dark:text-amber-300 dark:ring-amber-800',
  supporting_doc: 'bg-stone-100 text-stone-700 ring-stone-200 dark:bg-stone-800/40 dark:text-stone-300 dark:ring-stone-700',
}

// Author-facing copy for header hints. Centralised so the inline legend and
// per-column tooltips stay in sync.
const TYPE_HINT =
  'Manuscript: Chapter · Scene · Prologue · Epilogue · Interlude. ' +
  'Outline collects planning notes; Supporting Doc holds reference material. ' +
  'Click a row’s badge to change the type.'

const WORDS_HINT =
  'Project word total counts narrative types only — Chapter, Scene, Prologue, ' +
  'Epilogue, Interlude. Outline and Supporting Doc are tracked but excluded.'

function matchesFilter(c: Chapter, filter: FilterKey): boolean {
  if (filter === 'archived') return c.archivedAt !== null
  if (c.archivedAt !== null) return false
  if (filter === 'all') return true
  return CONTENT_TYPE_GROUPS[c.contentType] === filter
}

export function ChapterOverview({ chapters, projectId, readerBaseUrl, onStatusChange }: ChapterOverviewProps) {
  const { data: session } = useSession()
  const token = session?.apiToken

  const [filter, setFilter] = useState<FilterKey>('all')
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [actionInProgress, setActionInProgress] = useState<string | null>(null)
  const [bulkAction, setBulkAction] = useState<'archive' | 'restore' | 'delete' | null>(null)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [openTypeMenu, setOpenTypeMenu] = useState<string | null>(null)

  // Local copy so DnD reorder is optimistic — parent re-fetches asynchronously
  // via onStatusChange after each operation.
  const [localChapters, setLocalChapters] = useState<Chapter[]>(chapters)
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- sync local copy with parent prop
    setLocalChapters(chapters)
    setSelectedIds(new Set())
    setConfirmDelete(false)
  }, [chapters])

  const counts = useMemo(() => {
    let manuscript = 0, outlines = 0, reference = 0, archived = 0, all = 0
    for (const c of localChapters) {
      if (c.archivedAt) { archived++; continue }
      all++
      const group = CONTENT_TYPE_GROUPS[c.contentType]
      if (group === 'manuscript') manuscript++
      else if (group === 'outlines') outlines++
      else if (group === 'reference') reference++
    }
    return { all, manuscript, outlines, reference, archived }
  }, [localChapters])

  const filtered = useMemo(
    () => localChapters.filter(c => matchesFilter(c, filter)).sort((a, b) => a.order - b.order),
    [localChapters, filter],
  )

  // DnD is enabled only when the visible set is type-homogeneous (Outlines and
  // Reference qualify naturally; Manuscript / All / Archived rarely will).
  const visibleTypes = useMemo(() => new Set(filtered.map(c => c.contentType)), [filtered])
  const dndEnabled = filtered.length > 1 && visibleTypes.size === 1
  const homogeneousType: ContentType | null = dndEnabled ? filtered[0]!.contentType : null

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )

  const showingArchived = filter === 'archived'
  const allFilteredSelected = filtered.length > 0 && filtered.every(c => selectedIds.has(c.id))
  const someFilteredSelected = filtered.some(c => selectedIds.has(c.id))

  const toggleSelectAll = () => {
    if (allFilteredSelected) {
      setSelectedIds(prev => {
        const next = new Set(prev)
        for (const c of filtered) next.delete(c.id)
        return next
      })
    } else {
      setSelectedIds(prev => {
        const next = new Set(prev)
        for (const c of filtered) next.add(c.id)
        return next
      })
    }
  }

  const toggleOne = (id: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const toggleStatus = async (chapterId: string, currentStatus: string) => {
    if (!token) return
    const endpoint = currentStatus === 'draft'
      ? `/api/projects/${projectId}/chapters/${chapterId}/complete`
      : `/api/projects/${projectId}/chapters/${chapterId}/revert-to-draft`
    setActionInProgress(chapterId)
    try {
      const res = await apiFetch(endpoint, token, { method: 'POST' })
      if (res.ok) onStatusChange?.()
    } catch (err) {
      console.error('Failed to update chapter status:', err)
    } finally {
      setActionInProgress(null)
    }
  }

  const runBulk = async (action: 'archive' | 'restore' | 'delete') => {
    if (!token || selectedIds.size === 0) return
    const path =
      action === 'archive' ? '/api/entities/bulk-archive'
      : action === 'restore' ? '/api/entities/bulk-restore'
      : '/api/entities/bulk-delete'
    setBulkAction(action)
    try {
      const res = await apiFetch(path, token, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectId, ids: Array.from(selectedIds) }),
      })
      if (res.ok) {
        setSelectedIds(new Set())
        setConfirmDelete(false)
        onStatusChange?.()
      } else {
        console.error('Bulk action failed', action, await res.text())
      }
    } catch (err) {
      console.error('Bulk action error', action, err)
    } finally {
      setBulkAction(null)
    }
  }

  const changeContentType = async (chapterId: string, contentType: ContentType) => {
    if (!token) return
    setActionInProgress(chapterId)
    try {
      const res = await apiFetch(
        `/api/entities/${chapterId}/content-type?projectId=${projectId}`,
        token,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ contentType }),
        },
      )
      if (res.ok) {
        setLocalChapters(prev => prev.map(c => c.id === chapterId ? { ...c, contentType } : c))
        setOpenTypeMenu(null)
        onStatusChange?.()
      }
    } catch (err) {
      console.error('Failed to change content type', err)
    } finally {
      setActionInProgress(null)
    }
  }

  const handleDragEnd = useCallback(async (event: DragEndEvent) => {
    const { active, over } = event
    if (!over || active.id === over.id || !dndEnabled || !homogeneousType || !token) return

    const oldIndex = filtered.findIndex(c => c.id === active.id)
    const newIndex = filtered.findIndex(c => c.id === over.id)
    if (oldIndex < 0 || newIndex < 0) return

    const newOrder = arrayMove(filtered, oldIndex, newIndex)
    const orderedIds = newOrder.map(c => c.id)

    // Optimistic: rewrite local order so the row stays where dropped while the
    // server call is in flight.
    const orderMap = new Map(orderedIds.map((id, idx) => [id, idx]))
    setLocalChapters(prev => prev.map(c => {
      const idx = orderMap.get(c.id)
      return idx === undefined ? c : { ...c, order: idx }
    }))

    try {
      const res = await apiFetch('/api/entities/reorder', token, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          projectId,
          collection: 'content',
          contentType: homogeneousType,
          orderedIds,
        }),
      })
      if (!res.ok) {
        console.error('Reorder failed', await res.text())
        setLocalChapters(chapters)
      } else {
        onStatusChange?.()
      }
    } catch (err) {
      console.error('Reorder error', err)
      setLocalChapters(chapters)
    }
  }, [filtered, dndEnabled, homogeneousType, token, projectId, chapters, onStatusChange])

  if (chapters.length === 0) {
    return (
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700 p-6 animate-fade-in">
        <h2 className="font-display text-lg font-semibold text-gray-900 dark:text-gray-100 mb-4">Content</h2>
        <p className="text-sm text-gray-500 dark:text-gray-400 italic">Nothing here yet. Start writing to see chapters, outlines, and supporting docs.</p>
      </div>
    )
  }

  const chip = (key: FilterKey, label: string, count: number) => (
    <button
      key={key}
      onClick={() => { setFilter(key); setSelectedIds(new Set()); setConfirmDelete(false) }}
      className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium transition-colors ${
        filter === key
          ? 'bg-gray-900 text-white dark:bg-gray-100 dark:text-gray-900'
          : 'bg-gray-100 text-gray-700 hover:bg-gray-200 dark:bg-gray-700 dark:text-gray-300 dark:hover:bg-gray-600'
      }`}
    >
      <span>{label}</span>
      <span className={`tabular-nums ${filter === key ? 'opacity-80' : 'opacity-60'}`}>{count}</span>
    </button>
  )

  return (
    <div className="bg-white dark:bg-gray-800 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700 p-6 animate-fade-in">
      <div className="flex items-center justify-between mb-4 gap-3 flex-wrap">
        <h2 className="font-display text-lg font-semibold text-gray-900 dark:text-gray-100">Content</h2>
        <div className="flex items-center gap-2 flex-wrap">
          {chip('all', 'All', counts.all)}
          {chip('manuscript', 'Manuscript', counts.manuscript)}
          {chip('outlines', 'Outlines', counts.outlines)}
          {chip('reference', 'Reference', counts.reference)}
          {chip('archived', 'Archived', counts.archived)}
        </div>
      </div>

      {/* Always-visible legend. Anchors the column hints in plain prose so the
          info icons in the table head are reinforcement, not the only signal. */}
      <p className="text-[12px] leading-relaxed text-gray-500 dark:text-gray-400 mb-3 -mt-1">
        <span className="text-gray-700 dark:text-gray-300 font-medium">Manuscript</span>
        <span className="text-gray-400 dark:text-gray-500"> (counts toward word total)</span>
        <span className="mx-1.5 text-gray-300 dark:text-gray-600">·</span>
        <span className="text-gray-700 dark:text-gray-300 font-medium">Outlines</span>
        <span className="mx-1.5 text-gray-300 dark:text-gray-600">·</span>
        <span className="text-gray-700 dark:text-gray-300 font-medium">Reference</span>
        <span className="text-gray-400 dark:text-gray-500"> — change a row’s type from the </span>
        <span className="inline-flex items-center gap-0.5 px-1.5 py-px rounded-full text-[10px] ring-1 ring-inset bg-blue-50 text-blue-700 ring-blue-200 dark:bg-blue-900/30 dark:text-blue-300 dark:ring-blue-800">Chapter</span>
        <span className="text-gray-400 dark:text-gray-500"> badge.</span>
      </p>

      {!dndEnabled && filtered.length > 1 && !showingArchived && (
        <p className="text-xs text-gray-400 dark:text-gray-500 mb-2 italic">
          Filter to a single content type to drag-reorder.
        </p>
      )}

      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
        <div className="overflow-x-auto -mx-6 px-6">
          <table className="w-full text-sm border-separate border-spacing-0">
            <thead>
              <tr className="border-b border-gray-200 dark:border-gray-700 text-[11px] uppercase tracking-wider text-gray-400 dark:text-gray-500 font-medium">
                <th className="py-2.5 pl-1 pr-1 w-9 align-middle border-b border-gray-200 dark:border-gray-700">
                  <span className="flex items-center justify-center">
                    <Checkbox
                      checked={allFilteredSelected}
                      indeterminate={!allFilteredSelected && someFilteredSelected}
                      onChange={toggleSelectAll}
                      ariaLabel="Select all visible"
                    />
                  </span>
                </th>
                <th className="py-2.5 pr-1.5 w-5 align-middle border-b border-gray-200 dark:border-gray-700" aria-hidden="true" />
                <th className="py-2.5 pr-3 w-7 text-right align-middle border-b border-gray-200 dark:border-gray-700">#</th>
                <th className="py-2.5 pr-4 text-left align-middle border-b border-gray-200 dark:border-gray-700">Title</th>
                <th className="py-2.5 pr-4 text-left align-middle border-b border-gray-200 dark:border-gray-700">
                  <HeaderLabel label="Type" hint={TYPE_HINT} />
                </th>
                <th className="py-2.5 pr-4 text-right align-middle border-b border-gray-200 dark:border-gray-700">
                  <HeaderLabel label="Words" hint={WORDS_HINT} align="right" />
                </th>
                <th className="py-2.5 pr-4 text-left align-middle border-b border-gray-200 dark:border-gray-700">Status</th>
                {!showingArchived && (
                  <>
                    <th className="py-2.5 pr-4 text-right align-middle border-b border-gray-200 dark:border-gray-700">Reactions</th>
                    <th className="py-2.5 pr-4 text-right align-middle border-b border-gray-200 dark:border-gray-700">Comments</th>
                    <th className="py-2.5 text-right align-middle border-b border-gray-200 dark:border-gray-700">Feedback</th>
                  </>
                )}
              </tr>
            </thead>
            <tbody>
              <SortableContext items={filtered.map(c => c.id)} strategy={verticalListSortingStrategy}>
                {filtered.map((chapter, i) => (
                  <ChapterRow
                    key={chapter.id}
                    chapter={chapter}
                    index={i}
                    projectId={projectId}
                    readerBaseUrl={readerBaseUrl}
                    selected={selectedIds.has(chapter.id)}
                    onToggleSelect={() => toggleOne(chapter.id)}
                    showingArchived={showingArchived}
                    actionLoading={actionInProgress === chapter.id}
                    onToggleStatus={toggleStatus}
                    dndEnabled={dndEnabled}
                    typeMenuOpen={openTypeMenu === chapter.id}
                    onOpenTypeMenu={() => setOpenTypeMenu(prev => prev === chapter.id ? null : chapter.id)}
                    onCloseTypeMenu={() => setOpenTypeMenu(null)}
                    onChangeContentType={(t) => changeContentType(chapter.id, t)}
                  />
                ))}
              </SortableContext>
            </tbody>
          </table>
        </div>
      </DndContext>

      {selectedIds.size > 0 && (
        <div className="sticky bottom-4 mt-4 mx-auto max-w-2xl bg-gray-900 dark:bg-gray-700 text-white rounded-lg shadow-lg px-4 py-2.5 flex items-center justify-between gap-3">
          <span className="text-sm font-medium tabular-nums">{selectedIds.size} selected</span>
          <div className="flex items-center gap-2">
            <button
              onClick={() => { setSelectedIds(new Set()); setConfirmDelete(false) }}
              className="text-xs text-gray-300 hover:text-white px-2 py-1 rounded"
            >
              Clear
            </button>
            {showingArchived ? (
              <button
                onClick={() => runBulk('restore')}
                disabled={bulkAction !== null}
                className="text-xs bg-blue-600 hover:bg-blue-500 disabled:opacity-50 px-3 py-1 rounded-md font-medium"
              >
                {bulkAction === 'restore' ? 'Restoring…' : `Restore (${selectedIds.size})`}
              </button>
            ) : (
              <button
                onClick={() => runBulk('archive')}
                disabled={bulkAction !== null}
                className="text-xs bg-amber-600 hover:bg-amber-500 disabled:opacity-50 px-3 py-1 rounded-md font-medium"
              >
                {bulkAction === 'archive' ? 'Archiving…' : `Archive (${selectedIds.size})`}
              </button>
            )}
            {confirmDelete ? (
              <button
                onClick={() => runBulk('delete')}
                disabled={bulkAction !== null}
                className="text-xs bg-red-600 hover:bg-red-500 disabled:opacity-50 px-3 py-1 rounded-md font-medium ring-2 ring-red-300"
              >
                {bulkAction === 'delete' ? 'Deleting…' : `Confirm delete (${selectedIds.size})?`}
              </button>
            ) : (
              <button
                onClick={() => setConfirmDelete(true)}
                disabled={bulkAction !== null}
                className="text-xs bg-red-700/80 hover:bg-red-600 disabled:opacity-50 px-3 py-1 rounded-md font-medium"
              >
                Delete{showingArchived ? ' permanently' : ''}
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

interface ChapterRowProps {
  chapter: Chapter
  index: number
  projectId: string
  readerBaseUrl: string | null
  selected: boolean
  onToggleSelect: () => void
  showingArchived: boolean
  actionLoading: boolean
  onToggleStatus: (id: string, currentStatus: string) => void
  dndEnabled: boolean
  typeMenuOpen: boolean
  onOpenTypeMenu: () => void
  onCloseTypeMenu: () => void
  onChangeContentType: (t: ContentType) => void
}

function ChapterRow({
  chapter, index, projectId, readerBaseUrl, selected, onToggleSelect,
  showingArchived, actionLoading, onToggleStatus, dndEnabled,
  typeMenuOpen, onOpenTypeMenu, onCloseTypeMenu, onChangeContentType,
}: ChapterRowProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: chapter.id, disabled: !dndEnabled })

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  }

  const status = chapter.publication?.publishStatus || 'draft'
  const isPublished = status === 'published'
  const readerUrl = isPublished && readerBaseUrl ? `${readerBaseUrl}/${chapter.slug ?? chapter.id}` : null
  const canToggle = status === 'draft' || status === 'complete'
  const rowTint = selected
    ? 'bg-blue-50/60 dark:bg-blue-950/30'
    : ROW_TINTS[status] || ''
  const countsForWords = countsTowardWordCount(chapter.contentType)

  return (
    <tr
      ref={setNodeRef}
      style={style}
      className={`group border-b border-gray-100 dark:border-gray-700/50 last:border-0 hover:bg-gray-50/70 dark:hover:bg-gray-800/50 transition-colors ${rowTint}`}
    >
      <td className="py-2.5 pl-1 pr-1 align-middle w-9">
        <span className="flex items-center justify-center">
          <Checkbox
            checked={selected}
            onChange={onToggleSelect}
            ariaLabel={`Select ${chapter.title}`}
          />
        </span>
      </td>
      <td className="py-2.5 pr-1.5 align-middle w-5">
        <button
          {...attributes}
          {...listeners}
          disabled={!dndEnabled}
          aria-label="Drag to reorder"
          title={dndEnabled ? 'Drag to reorder' : 'Filter by a single content type to enable reordering'}
          className={`flex items-center justify-center p-0.5 -m-0.5 rounded text-gray-300 dark:text-gray-600 transition-all ${dndEnabled ? 'cursor-grab opacity-50 group-hover:opacity-100 hover:text-gray-600 dark:hover:text-gray-300 active:cursor-grabbing' : 'opacity-20 cursor-not-allowed'}`}
        >
          <svg className="w-3.5 h-3.5" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
            <circle cx="5" cy="3" r="1.3" />
            <circle cx="5" cy="8" r="1.3" />
            <circle cx="5" cy="13" r="1.3" />
            <circle cx="11" cy="3" r="1.3" />
            <circle cx="11" cy="8" r="1.3" />
            <circle cx="11" cy="13" r="1.3" />
          </svg>
        </button>
      </td>
      <td className="py-2.5 pr-3 w-7 text-right text-gray-400 dark:text-gray-500 tabular-nums">{index + 1}</td>
      <td className="py-2.5 pr-4 font-medium">
        <Link
          href={`/projects/${projectId}/manuscript/content/${chapter.id}`}
          className="text-blue-600 dark:text-blue-400 hover:text-blue-700 dark:hover:text-blue-300 hover:underline transition-colors"
        >
          {chapter.title}
        </Link>
      </td>
      <td className="py-2.5 pr-4 relative">
        <button
          onClick={onOpenTypeMenu}
          disabled={actionLoading}
          className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ring-1 ring-inset transition-colors disabled:opacity-50 ${TYPE_COLORS[chapter.contentType]}`}
          title="Change content type"
        >
          {CONTENT_TYPE_LABELS[chapter.contentType]}
          <svg className="w-3 h-3 opacity-60" viewBox="0 0 12 12" fill="currentColor" aria-hidden="true">
            <path d="M2 4l4 4 4-4z" />
          </svg>
        </button>
        {typeMenuOpen && (
          <>
            <div className="fixed inset-0 z-10" onClick={onCloseTypeMenu} aria-hidden="true" />
            <div className="absolute left-0 top-full mt-1 z-20 w-44 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-md shadow-lg py-1">
              {CONTENT_TYPES.map(t => (
                <button
                  key={t}
                  onClick={() => onChangeContentType(t)}
                  disabled={t === chapter.contentType}
                  className={`block w-full text-left px-3 py-1.5 text-xs hover:bg-gray-50 dark:hover:bg-gray-700 disabled:opacity-50 disabled:cursor-default ${t === chapter.contentType ? 'font-semibold text-gray-900 dark:text-gray-100' : 'text-gray-700 dark:text-gray-300'}`}
                >
                  {CONTENT_TYPE_LABELS[t]}
                  {t === chapter.contentType && <span className="ml-1 text-blue-500">✓</span>}
                </button>
              ))}
            </div>
          </>
        )}
      </td>
      <td className="py-2.5 pr-4 text-right tabular-nums">
        {chapter.wordCount > 0 ? (
          <span
            className={countsForWords ? 'text-gray-700 dark:text-gray-300' : 'text-gray-400 dark:text-gray-500 italic'}
            title={countsForWords ? undefined : 'Not in manuscript total'}
          >
            {chapter.wordCount.toLocaleString()}
          </span>
        ) : (
          <span className="text-gray-300 dark:text-gray-600">·</span>
        )}
      </td>
      <td className="py-2.5 pr-4">
        <div className="flex items-center gap-2">
          {readerUrl ? (
            <a
              href={readerUrl}
              target="_blank"
              rel="noopener noreferrer"
              className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium hover:ring-2 hover:ring-green-300 dark:hover:ring-green-600 transition-all ${STATUS_COLORS[status] || STATUS_COLORS.draft}`}
              title="View published chapter"
            >
              {STATUS_LABELS[status] || status} ↗
            </a>
          ) : (
            <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_COLORS[status] || STATUS_COLORS.draft}`}>
              {STATUS_LABELS[status] || status}
            </span>
          )}
          {!showingArchived && canToggle && (
            <button
              onClick={() => onToggleStatus(chapter.id, status)}
              disabled={actionLoading}
              className={`text-xs px-2 py-0.5 rounded-md border transition-colors disabled:opacity-50 ${
                status === 'draft'
                  ? 'border-blue-300 text-blue-600 hover:bg-blue-50 dark:border-blue-600 dark:text-blue-400 dark:hover:bg-blue-900/20'
                  : 'border-gray-300 text-gray-600 hover:bg-gray-50 dark:border-gray-600 dark:text-gray-400 dark:hover:bg-gray-800'
              }`}
            >
              {actionLoading ? '...' : status === 'draft' ? 'Mark Ready' : 'Revert to Draft'}
            </button>
          )}
        </div>
      </td>
      {!showingArchived && (
        <>
          <td className="py-2.5 pr-4 text-right text-gray-600 dark:text-gray-400 tabular-nums">
            {chapter.reactionCount > 0 ? chapter.reactionCount.toLocaleString() : <span className="text-gray-300 dark:text-gray-600">·</span>}
          </td>
          <td className="py-2.5 pr-4 text-right tabular-nums">
            {chapter.commentCount > 0 && readerUrl ? (
              <a href={`${readerUrl}#comments`} target="_blank" rel="noopener noreferrer" className="text-blue-600 dark:text-blue-400 hover:underline">
                {chapter.commentCount.toLocaleString()}
              </a>
            ) : chapter.commentCount > 0 ? (
              <span className="text-gray-600 dark:text-gray-400">{chapter.commentCount.toLocaleString()}</span>
            ) : (
              <span className="text-gray-300 dark:text-gray-600">·</span>
            )}
          </td>
          <td className="py-2.5 text-right tabular-nums">
            {chapter.annotationCount > 0 ? (
              <Link href={`/projects/${projectId}/feedback?chapterId=${chapter.id}`} className="text-blue-600 dark:text-blue-400 hover:underline">
                {chapter.annotationCount.toLocaleString()}
              </Link>
            ) : (
              <span className="text-gray-300 dark:text-gray-600">·</span>
            )}
          </td>
        </>
      )}
    </tr>
  )
}

// --- Subcomponents ----------------------------------------------------------

/** Themed checkbox. The native input drives state (a11y + keyboard) while a
 * styled span renders the visible square. Supports a tri-state indeterminate
 * appearance for "some-but-not-all selected" rows. */
function Checkbox({
  checked,
  indeterminate,
  onChange,
  ariaLabel,
}: {
  checked: boolean
  indeterminate?: boolean
  onChange: (e: ChangeEvent<HTMLInputElement>) => void
  ariaLabel: string
}) {
  const filled = checked || !!indeterminate
  return (
    <label className="relative inline-flex items-center justify-center cursor-pointer align-middle leading-none">
      <input
        type="checkbox"
        checked={checked}
        onChange={onChange}
        ref={(el) => { if (el) el.indeterminate = !!indeterminate }}
        aria-label={ariaLabel}
        className="peer sr-only"
      />
      <span
        className={`relative inline-block w-[15px] h-[15px] rounded-[3px] border transition-colors duration-150 ${
          filled
            ? checked
              ? 'bg-blue-600 border-blue-600 dark:bg-blue-500 dark:border-blue-500'
              : 'bg-gray-400 border-gray-400 dark:bg-gray-500 dark:border-gray-500'
            : 'bg-transparent border-gray-300 hover:border-gray-500 dark:border-gray-600 dark:hover:border-gray-400'
        } peer-focus-visible:ring-2 peer-focus-visible:ring-blue-400/40 peer-focus-visible:ring-offset-1 peer-focus-visible:ring-offset-white dark:peer-focus-visible:ring-offset-gray-800`}
      >
        {checked && (
          <svg
            viewBox="0 0 16 16"
            className="absolute inset-0 w-full h-full text-white"
            aria-hidden="true"
          >
            <path
              d="M3.75 8.25l2.75 2.75 5.75-5.75"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.25"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        )}
        {indeterminate && !checked && (
          <span
            className="absolute left-[3px] right-[3px] top-1/2 h-[2px] -translate-y-1/2 rounded-full bg-white"
            aria-hidden="true"
          />
        )}
      </span>
    </label>
  )
}

/** Table-head label with a small info dot that exposes the supplied hint via
 * the browser's native tooltip. The dot doubles as a visual cue that the
 * column has additional explanation, complementing the prose legend above the
 * table. */
function HeaderLabel({
  label,
  hint,
  align = 'left',
}: {
  label: string
  hint: ReactNode
  align?: 'left' | 'right'
}) {
  const hintString = typeof hint === 'string' ? hint : String(hint ?? '')
  return (
    <span className={`inline-flex items-center gap-1 ${align === 'right' ? 'justify-end' : ''}`}>
      <span>{label}</span>
      <span
        aria-label={hintString}
        title={hintString}
        className="inline-flex items-center justify-center w-3.5 h-3.5 rounded-full border border-gray-300 dark:border-gray-600 text-[9px] font-semibold text-gray-400 dark:text-gray-500 hover:text-gray-700 hover:border-gray-500 dark:hover:text-gray-200 dark:hover:border-gray-400 cursor-help transition-colors"
      >
        i
      </span>
    </span>
  )
}
