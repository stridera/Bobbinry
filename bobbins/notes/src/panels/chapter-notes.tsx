import { useState, useEffect, useMemo, useCallback } from 'react'
import { BobbinrySDK, PanelActions } from '@bobbinry/sdk'

interface ChapterNotesPanelProps {
  context?: {
    projectId?: string
    currentProject?: string
    currentView?: string
    apiToken?: string
  }
}

interface ChapterContext {
  entityId: string
  entityType: string
  bobbinId: string
  label: string
}

export default function ChapterNotesPanel({ context }: ChapterNotesPanelProps) {
  const [notes, setNotes] = useState<any[]>([])
  const [loading, setLoading] = useState(false)
  const [activeChapter, setActiveChapter] = useState<ChapterContext | null>(null)
  const [selectedNoteId, setSelectedNoteId] = useState<string | null>(null)
  const [editingNoteId, setEditingNoteId] = useState<string | null>(null)
  const [editingValue, setEditingValue] = useState('')

  const [sdk] = useState(() => new BobbinrySDK('notes'))
  const projectId = useMemo(() => context?.projectId || context?.currentProject, [context?.projectId, context?.currentProject])

  useEffect(() => {
    if (context?.apiToken) {
      sdk.api.setAuthToken(context.apiToken)
    }
  }, [context?.apiToken, sdk])

  useEffect(() => {
    if (projectId) {
      sdk.setProject(projectId)
    }
  }, [projectId, sdk])

  // Listen for navigation events to detect active manuscript chapter
  useEffect(() => {
    function handleNavigate(e: Event) {
      const detail = (e as CustomEvent).detail
      if (!detail) return

      // Only track manuscript content nodes (chapters/scenes)
      if (detail.bobbinId === 'manuscript' && detail.entityType === 'content' && detail.entityId) {
        setActiveChapter({
          entityId: detail.entityId,
          entityType: detail.entityType,
          bobbinId: 'manuscript',
          label: detail.metadata?.title || detail.metadata?.name || 'Chapter'
        })
      }
    }

    function handleContextChange(e: Event) {
      const detail = (e as CustomEvent).detail
      if (!detail) return

      if (detail.bobbinId === 'manuscript' && detail.entityType === 'content' && detail.entityId) {
        setActiveChapter(prev => {
          // Keep existing label if we already have one and the new event doesn't provide one
          const label = detail.metadata?.title || detail.metadata?.name || prev?.label || 'Chapter'
          return {
            entityId: detail.entityId,
            entityType: detail.entityType,
            bobbinId: 'manuscript',
            label
          }
        })
      }
    }

    window.addEventListener('bobbinry:navigate', handleNavigate)
    window.addEventListener('bobbinry:view-context-change', handleContextChange)
    return () => {
      window.removeEventListener('bobbinry:navigate', handleNavigate)
      window.removeEventListener('bobbinry:view-context-change', handleContextChange)
    }
  }, [])

  const loadChapterNotes = useCallback(async () => {
    if (!activeChapter || !projectId || !context?.apiToken) return

    try {
      setLoading(true)
      const res = await sdk.entities.query({ collection: 'notes', limit: 1000 })
      const allNotes = (res.data as any[]) || []

      // Filter notes linked to the active chapter
      const chapterNotes = allNotes.filter((note: any) => {
        const links = note.linked_entities || []
        return links.some((link: any) =>
          link.entityId === activeChapter.entityId && link.bobbinId === 'manuscript'
        )
      })

      // Sort: pinned first, then by updated_at
      chapterNotes.sort((a: any, b: any) => {
        if (a.pinned && !b.pinned) return -1
        if (!a.pinned && b.pinned) return 1
        return (b.updated_at || '').localeCompare(a.updated_at || '')
      })

      setNotes(chapterNotes)
    } catch (err) {
      console.error('[Chapter Notes] Failed to load:', err)
    } finally {
      setLoading(false)
    }
  }, [activeChapter, projectId, context?.apiToken, sdk])

  // Reload notes when active chapter changes
  useEffect(() => {
    if (activeChapter && projectId && context?.apiToken) {
      loadChapterNotes()
    } else {
      setNotes([])
    }
  }, [activeChapter, projectId, context?.apiToken, loadChapterNotes])

  async function createChapterNote() {
    if (!activeChapter) return

    try {
      const newNote = await sdk.entities.create('notes', {
        title: 'New Note',
        content: '',
        folder_id: null,
        tags: [],
        linked_entities: [{
          entityId: activeChapter.entityId,
          collection: 'content',
          bobbinId: 'manuscript',
          label: activeChapter.label
        }],
        pinned: false,
        color: null,
        icon: null,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      }) as any

      await loadChapterNotes()
      setEditingNoteId(newNote.id)
      setEditingValue('New Note')
    } catch (err) {
      console.error('[Chapter Notes] Failed to create:', err)
    }
  }

  function handleNoteClick(note: any) {
    setSelectedNoteId(note.id)
    window.dispatchEvent(new CustomEvent('bobbinry:navigate', {
      detail: {
        entityType: 'notes',
        entityId: note.id,
        bobbinId: 'notes',
        metadata: { view: 'note-editor' }
      }
    }))
  }

  async function handleRename(noteId: string, newTitle: string) {
    if (!newTitle.trim()) {
      setEditingNoteId(null)
      return
    }
    try {
      await sdk.entities.update('notes', noteId, {
        title: newTitle.trim(),
        updated_at: new Date().toISOString()
      })
      await loadChapterNotes()
      setEditingNoteId(null)
    } catch (err) {
      console.error('[Chapter Notes] Failed to rename:', err)
    }
  }

  async function handleUnlink(noteId: string) {
    if (!activeChapter) return

    const note = notes.find(n => n.id === noteId)
    if (!note) return

    const updatedLinks = (note.linked_entities || []).filter((link: any) =>
      !(link.entityId === activeChapter.entityId && link.bobbinId === 'manuscript')
    )

    try {
      await sdk.entities.update('notes', noteId, {
        linked_entities: updatedLinks,
        updated_at: new Date().toISOString()
      })
      await loadChapterNotes()
    } catch (err) {
      console.error('[Chapter Notes] Failed to unlink:', err)
    }
  }

  async function handleDelete(noteId: string) {
    if (!confirm('Delete this note? This cannot be undone.')) return
    try {
      await sdk.entities.delete('notes', noteId)
      await loadChapterNotes()
      if (selectedNoteId === noteId) setSelectedNoteId(null)
    } catch (err) {
      console.error('[Chapter Notes] Failed to delete:', err)
    }
  }

  if (!projectId) {
    return (
      <div className="p-4 text-center text-sm text-gray-500 dark:text-gray-400">
        No project selected
      </div>
    )
  }

  if (!activeChapter) {
    return (
      <div className="h-full flex flex-col bg-gray-800">
        <PanelActions>
          <span className="text-xs text-gray-500">Chapter Notes</span>
        </PanelActions>
        <div className="flex-1 flex items-center justify-center p-4">
          <div className="text-center text-sm text-gray-500">
            <div className="text-2xl mb-2">📝</div>
            <div>Select a chapter to see its notes</div>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="h-full flex flex-col bg-gray-800">
      <PanelActions>
        <button
          onClick={createChapterNote}
          className="text-lg leading-none text-gray-400 hover:text-gray-200 w-6 h-6 flex items-center justify-center"
          title="New chapter note"
        >
          +
        </button>
        <button
          onClick={loadChapterNotes}
          className="text-xs text-gray-400 hover:text-gray-200"
          title="Refresh"
        >
          ↻
        </button>
      </PanelActions>

      {/* Chapter indicator */}
      <div className="px-3 py-1.5 border-b border-gray-700 bg-gray-750">
        <div className="text-[10px] uppercase tracking-wide text-gray-500">Chapter</div>
        <div className="text-xs text-gray-300 truncate">{activeChapter.label}</div>
      </div>

      {/* Notes list */}
      <div className="flex-1 overflow-y-auto">
        {loading ? (
          <div className="p-4 text-center text-sm text-gray-500">
            <div className="animate-pulse">Loading...</div>
          </div>
        ) : notes.length === 0 ? (
          <div className="p-4 text-center text-sm text-gray-400">
            <div className="mb-3">No notes for this chapter</div>
            <button
              onClick={createChapterNote}
              className="px-3 py-1.5 text-xs bg-gray-700 hover:bg-gray-600 text-gray-200 rounded"
            >
              Add a Note
            </button>
          </div>
        ) : (
          notes.map((note: any) => (
            <div
              key={note.id}
              className={`px-3 py-2 cursor-pointer hover:bg-gray-700 border-b border-gray-700/50 group ${selectedNoteId === note.id ? 'bg-gray-700' : ''}`}
              onClick={() => handleNoteClick(note)}
              onContextMenu={(e) => { e.preventDefault(); handleDelete(note.id) }}
            >
              <div className="flex items-center gap-1.5">
                {note.pinned && <span className="text-xs">📌</span>}
                {editingNoteId === note.id ? (
                  <input
                    type="text"
                    value={editingValue}
                    onChange={(e) => setEditingValue(e.target.value)}
                    onBlur={() => handleRename(note.id, editingValue)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') handleRename(note.id, editingValue)
                      else if (e.key === 'Escape') setEditingNoteId(null)
                    }}
                    autoFocus
                    onFocus={(e) => e.target.select()}
                    className="flex-1 px-1 py-0.5 bg-gray-800 border border-gray-600 rounded text-gray-100 text-sm"
                    onClick={(e) => e.stopPropagation()}
                  />
                ) : (
                  <span className="flex-1 text-sm text-gray-200 truncate">{note.title || 'Untitled'}</span>
                )}
                <button
                  onClick={(e) => { e.stopPropagation(); handleUnlink(note.id) }}
                  className="text-xs text-gray-500 hover:text-gray-300 opacity-0 group-hover:opacity-100 transition-opacity"
                  title="Unlink from chapter"
                >
                  ✕
                </button>
              </div>
              {note.content && (
                <div className="text-xs text-gray-500 mt-0.5 truncate">
                  {note.content.replace(/<[^>]*>/g, '').slice(0, 60)}
                </div>
              )}
              {note.tags && note.tags.length > 0 && (
                <div className="flex gap-1 mt-1">
                  {note.tags.slice(0, 3).map((tag: string, i: number) => (
                    <span key={i} className="text-[10px] px-1.5 py-0.5 bg-gray-700 text-gray-400 rounded">{tag}</span>
                  ))}
                </div>
              )}
            </div>
          ))
        )}
      </div>
    </div>
  )
}
