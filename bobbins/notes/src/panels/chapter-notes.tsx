import { useState, useEffect, useMemo, useCallback } from 'react'
import {
  BobbinrySDK,
  PanelActions,
  PanelActionButton,
  PanelBody,
  PanelCard,
  PanelEmptyState,
  PanelFrame,
  PanelIconButton,
  PanelLoadingState,
  PanelPill,
  PanelSectionTitle,
} from '@bobbinry/sdk'

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
  const [error, setError] = useState<string | null>(null)

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
      setError(null)
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
      setError('Failed to load chapter notes')
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
    return <PanelEmptyState title="No project selected" description="Open a project to see notes attached to the active chapter." />
  }

  if (!activeChapter) {
    return (
      <PanelFrame>
        <PanelActions>
          <PanelPill>Waiting</PanelPill>
        </PanelActions>
        <PanelBody>
          <PanelEmptyState
            title="No chapter selected"
            description="Open a manuscript chapter to view or create linked notes here."
          />
        </PanelBody>
      </PanelFrame>
    )
  }

  return (
    <PanelFrame>
      <PanelActions>
        <PanelIconButton
          onClick={createChapterNote}
          title="New chapter note"
        >
          <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M12 5v14M5 12h14" />
          </svg>
        </PanelIconButton>
        <PanelIconButton
          onClick={loadChapterNotes}
          title="Refresh"
        >
          <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M4 4v6h6M20 20v-6h-6" />
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M20 9a8 8 0 00-13.66-4.95L4 10M4 15a8 8 0 0013.66 4.95L20 14" />
          </svg>
        </PanelIconButton>
      </PanelActions>

      <PanelBody className="space-y-3">
        <div className="flex items-center justify-between gap-3">
          <PanelSectionTitle>{activeChapter.label}</PanelSectionTitle>
          <PanelPill>{notes.length} linked</PanelPill>
        </div>

        {error ? <PanelCard className="text-xs text-red-700 dark:text-red-300">{error}</PanelCard> : null}

        <div className="space-y-2">
          <PanelSectionTitle>Linked Notes</PanelSectionTitle>
          {loading ? (
            <PanelLoadingState label="Loading chapter notes…" />
          ) : notes.length === 0 ? (
            <PanelEmptyState
              title="No notes for this chapter"
              description="Create linked notes for scene intent, continuity, or revision reminders."
              action={<PanelActionButton onClick={createChapterNote}>Add note</PanelActionButton>}
            />
          ) : (
            <PanelCard className="px-0 py-1">
              {notes.map((note: any) => (
                <div
                  key={note.id}
                  className={`group cursor-pointer border-b border-gray-200 px-3 py-2 last:border-b-0 hover:bg-gray-100 dark:border-gray-700/60 dark:hover:bg-gray-700/60 ${selectedNoteId === note.id ? 'bg-gray-100 dark:bg-gray-700/60' : ''}`}
                  onClick={() => handleNoteClick(note)}
                  onContextMenu={(e) => { e.preventDefault(); handleDelete(note.id) }}
                >
                  <div className="flex items-center gap-2">
                    {note.pinned ? <PanelPill>Pinned</PanelPill> : null}
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
                        className="flex-1 rounded border border-gray-300 bg-white px-1 py-0.5 text-sm text-gray-900 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100"
                        onClick={(e) => e.stopPropagation()}
                      />
                    ) : (
                      <span className="min-w-0 flex-1 truncate text-sm text-gray-800 dark:text-gray-200">{note.title || 'Untitled'}</span>
                    )}
                    <button
                      onClick={(e) => { e.stopPropagation(); handleUnlink(note.id) }}
                      className="text-xs text-gray-500 opacity-0 transition-opacity hover:text-gray-700 group-hover:opacity-100 dark:hover:text-gray-300"
                      title="Unlink from chapter"
                    >
                      Unlink
                    </button>
                  </div>
                  {note.content ? (
                    <div className="mt-0.5 text-xs text-gray-500 dark:text-gray-400">
                      {note.content.replace(/<[^>]*>/g, '').slice(0, 72)}
                    </div>
                  ) : null}
                </div>
              ))}
            </PanelCard>
          )}
        </div>
      </PanelBody>
    </PanelFrame>
  )
}
