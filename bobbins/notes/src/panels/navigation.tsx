import { useState, useEffect, useMemo } from 'react'
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

interface NavigationPanelProps {
  context?: {
    projectId?: string
    currentProject?: string
    currentView?: string
    apiToken?: string
  }
}

interface FolderNode {
  id: string
  name: string
  color: string | null
  icon: string | null
  order: number
  parentFolder: string | null
  children: FolderNode[]
}

export default function NavigationPanel({ context }: NavigationPanelProps) {
  const [folders, setFolders] = useState<FolderNode[]>([])
  const [notes, setNotes] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [selectedFolderId, setSelectedFolderId] = useState<string | null>(null)
  const [selectedNoteId, setSelectedNoteId] = useState<string | null>(null)
  const [expandedFolders, setExpandedFolders] = useState<Set<string>>(new Set())
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editingValue, setEditingValue] = useState('')
  const [showDropdown, setShowDropdown] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const [sdk] = useState(() => new BobbinrySDK('notes'))
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
      setFolders([])
      setNotes([])
    }
  }, [projectId, context?.apiToken])

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      const target = e.target as HTMLElement
      if (!target.closest('.dropdown-container')) {
        setShowDropdown(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  useEffect(() => {
    function handleViewContextChange(e: Event) {
      const detail = (e as CustomEvent).detail
      if (detail?.entityId) {
        setSelectedNoteId(detail.entityId)
      }
    }
    window.addEventListener('bobbinry:view-context-change', handleViewContextChange)
    return () => window.removeEventListener('bobbinry:view-context-change', handleViewContextChange)
  }, [])

  async function loadData() {
    try {
      setLoading(true)
      setError(null)
      const [foldersRes, notesRes] = await Promise.all([
        sdk.entities.query({ collection: 'folders', limit: 1000 }),
        sdk.entities.query({ collection: 'notes', limit: 1000 })
      ])

      const folderData = (foldersRes.data as any[]) || []
      const noteData = (notesRes.data as any[]) || []

      // Build folder tree
      const folderMap = new Map<string, FolderNode>()
      for (const f of folderData) {
        folderMap.set(f.id, {
          id: f.id,
          name: f.name || 'Untitled Folder',
          color: f.color,
          icon: f.icon,
          order: f.order || 0,
          parentFolder: f.parent_folder || null,
          children: []
        })
      }

      const rootFolders: FolderNode[] = []
      for (const folder of folderMap.values()) {
        if (folder.parentFolder && folderMap.has(folder.parentFolder)) {
          folderMap.get(folder.parentFolder)!.children.push(folder)
        } else {
          rootFolders.push(folder)
        }
      }

      const sortFolders = (arr: FolderNode[]) => {
        arr.sort((a, b) => a.order - b.order)
        arr.forEach(f => sortFolders(f.children))
      }
      sortFolders(rootFolders)

      setFolders(rootFolders)
      setNotes(noteData)

      // Expand all folders by default
      const allIds = new Set<string>()
      folderMap.forEach((_, id) => allIds.add(id))
      setExpandedFolders(allIds)
    } catch (error) {
      console.error('[Notes Navigation] Failed to load:', error)
      setError('Failed to load notes')
    } finally {
      setLoading(false)
    }
  }

  const filteredNotes = useMemo(() => {
    if (!selectedFolderId) return notes.sort((a: any, b: any) => (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0))
    return notes
      .filter((n: any) => n.folder_id === selectedFolderId)
      .sort((a: any, b: any) => (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0))
  }, [notes, selectedFolderId])

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

  function handleFolderClick(folderId: string) {
    setSelectedFolderId(folderId === selectedFolderId ? null : folderId)
  }

  function toggleFolder(folderId: string) {
    setExpandedFolders(prev => {
      const next = new Set(prev)
      if (next.has(folderId)) next.delete(folderId)
      else next.add(folderId)
      return next
    })
  }

  async function createFolder(parentId: string | null = null) {
    try {
      const newFolder = await sdk.entities.create('folders', {
        name: 'New Folder',
        parent_folder: parentId,
        order: Date.now(),
        icon: null,
        color: null,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      }) as any

      await loadData()
      if (parentId) setExpandedFolders(prev => new Set(prev).add(parentId))
      setEditingId(newFolder.id)
      setEditingValue('New Folder')
    } catch (error) {
      console.error('Failed to create folder:', error)
    }
  }

  async function createNote(folderId: string | null = null) {
    try {
      const newNote = await sdk.entities.create('notes', {
        title: 'New Note',
        content: '',
        folder_id: folderId,
        tags: [],
        linked_entities: [],
        pinned: false,
        color: null,
        icon: null,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      }) as any

      await loadData()
      if (folderId) setExpandedFolders(prev => new Set(prev).add(folderId))
      setSelectedNoteId(newNote.id)
      handleNoteClick(newNote)
    } catch (error) {
      console.error('Failed to create note:', error)
    }
  }

  async function handleRename(id: string, collection: 'folders' | 'notes', newName: string) {
    if (!newName.trim()) {
      setEditingId(null)
      return
    }
    try {
      const field = collection === 'folders' ? 'name' : 'title'
      await sdk.entities.update(collection, id, {
        [field]: newName.trim(),
        updated_at: new Date().toISOString()
      })
      await loadData()
      setEditingId(null)
    } catch (error) {
      console.error('Failed to rename:', error)
    }
  }

  async function handleDelete(id: string, collection: 'folders' | 'notes') {
    const label = collection === 'folders' ? 'folder' : 'note'
    if (!confirm(`Delete this ${label}? This cannot be undone.`)) return
    try {
      await sdk.entities.delete(collection, id)
      await loadData()
      if (selectedNoteId === id) setSelectedNoteId(null)
    } catch (error) {
      console.error('Failed to delete:', error)
    }
  }

  function openPinboard() {
    window.dispatchEvent(new CustomEvent('bobbinry:navigate', {
      detail: {
        entityType: 'notes',
        entityId: 'pinboard',
        bobbinId: 'notes',
        metadata: { view: 'pinboard' }
      }
    }))
  }

  function renderFolder(folder: FolderNode, depth: number = 0): React.JSX.Element {
    const isExpanded = expandedFolders.has(folder.id)
    const isSelected = selectedFolderId === folder.id
    const hasChildren = folder.children.length > 0
    const isEditing = editingId === folder.id
    const icon = folder.icon || 'Folder'

    return (
      <div key={folder.id}>
        <div
          className={`pr-2 py-1 cursor-pointer hover:bg-gray-100 dark:hover:bg-gray-700 text-sm flex items-center gap-1.5 ${isSelected ? 'bg-gray-100 dark:bg-gray-700' : ''}`}
          style={{ paddingLeft: `${depth * 16 + 8}px` }}
          onClick={() => handleFolderClick(folder.id)}
          onContextMenu={(e) => {
            e.preventDefault()
            handleDelete(folder.id, 'folders')
          }}
        >
          {hasChildren ? (
            <span
              className="text-gray-400 text-xs w-3 flex-shrink-0 hover:text-gray-700 dark:hover:text-gray-200"
              onClick={(e) => { e.stopPropagation(); toggleFolder(folder.id) }}
            >
              {isExpanded ? '▼' : '▶'}
            </span>
          ) : (
            <span className="w-3 flex-shrink-0" />
          )}
          <span className="max-w-16 flex-shrink-0 truncate text-[11px] uppercase tracking-[0.14em] text-gray-400 dark:text-gray-500">{icon}</span>
          {isEditing ? (
            <input
              type="text"
              value={editingValue}
              onChange={(e) => setEditingValue(e.target.value)}
              onBlur={() => handleRename(folder.id, 'folders', editingValue)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleRename(folder.id, 'folders', editingValue)
                else if (e.key === 'Escape') setEditingId(null)
              }}
              autoFocus
              onFocus={(e) => e.target.select()}
              className="flex-1 px-1 py-0.5 bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded text-gray-900 dark:text-gray-100"
              onClick={(e) => e.stopPropagation()}
            />
          ) : (
            <span className="flex-1 text-gray-800 dark:text-gray-200 truncate">{folder.name}</span>
          )}
        </div>
        {hasChildren && isExpanded && folder.children.map(child => renderFolder(child, depth + 1))}
      </div>
    )
  }

  if (loading) {
    return <PanelLoadingState label="Loading notes…" />
  }

  if (!projectId) {
    return <PanelEmptyState title="No project selected" description="Open a project to browse notes and folders." />
  }

  return (
    <PanelFrame>
      <PanelActions>
        <div className="relative dropdown-container">
          <PanelIconButton
            onClick={() => setShowDropdown(!showDropdown)}
            title="Create new item"
          >
            <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M12 5v14M5 12h14" />
            </svg>
          </PanelIconButton>
          {showDropdown && (
            <div className="absolute right-0 top-full z-50 mt-1 min-w-[170px] rounded-lg border border-gray-200 bg-white p-1 shadow-lg dark:border-gray-700 dark:bg-gray-800">
              <button
                onClick={() => { createFolder(selectedFolderId); setShowDropdown(false) }}
                className="w-full rounded-md px-3 py-2 text-left text-sm text-gray-900 hover:bg-gray-100 dark:text-gray-100 dark:hover:bg-gray-700"
              >
                New folder
              </button>
              <button
                onClick={() => { createNote(selectedFolderId); setShowDropdown(false) }}
                className="w-full rounded-md px-3 py-2 text-left text-sm text-gray-900 hover:bg-gray-100 dark:text-gray-100 dark:hover:bg-gray-700"
              >
                New note
              </button>
            </div>
          )}
        </div>
        <PanelIconButton
          onClick={openPinboard}
          title="Pinboard"
        >
          <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M12 17v4m0-4l4-4m-4 4l-4-4m1-8h6l1 5H8l1-5z" />
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

      <PanelBody className="space-y-3">
        <div className="flex items-center justify-between gap-3">
          <PanelSectionTitle>{selectedFolderId ? 'Focused Folder' : 'Workspace Notes'}</PanelSectionTitle>
          <PanelPill>{notes.length} notes</PanelPill>
        </div>

        {error ? <PanelCard className="text-xs text-red-700 dark:text-red-300">{error}</PanelCard> : null}

        <div className="space-y-2">
          <div className="flex items-center justify-between gap-2">
            <PanelSectionTitle>Folders</PanelSectionTitle>
            {selectedFolderId ? (
              <button
                className="text-xs text-blue-600 hover:underline dark:text-blue-400"
                onClick={() => setSelectedFolderId(null)}
              >
                All notes
              </button>
            ) : null}
          </div>
          <PanelCard className="px-0 py-2">
            {folders.length === 0 ? (
              <div className="px-3 py-2 text-xs text-gray-500 dark:text-gray-400">No folders yet.</div>
            ) : (
              folders.map(folder => renderFolder(folder))
            )}
          </PanelCard>
        </div>

        <div className="space-y-2">
          <PanelSectionTitle>{selectedFolderId ? 'Folder Notes' : 'Recent Notes'}</PanelSectionTitle>
          {filteredNotes.length === 0 ? (
            <PanelEmptyState
              title="No notes yet"
              description="Create a note to build out your research and working references."
              action={<PanelActionButton onClick={() => createNote(selectedFolderId)}>Create note</PanelActionButton>}
            />
          ) : (
            <PanelCard className="px-0 py-1">
              {filteredNotes.map((note: any) => (
                <div
                  key={note.id}
                  className={`cursor-pointer border-b border-gray-200 px-3 py-2 last:border-b-0 hover:bg-gray-100 dark:border-gray-700/60 dark:hover:bg-gray-700/60 ${selectedNoteId === note.id ? 'bg-gray-100 dark:bg-gray-700/60' : ''}`}
                  onClick={() => handleNoteClick(note)}
                  onContextMenu={(e) => { e.preventDefault(); handleDelete(note.id, 'notes') }}
                >
                  <div className="flex items-center gap-2">
                    {note.pinned ? <PanelPill>Pinned</PanelPill> : null}
                    <span className="min-w-0 flex-1 truncate text-sm text-gray-800 dark:text-gray-200">{note.title || 'Untitled'}</span>
                  </div>
                  {note.tags && note.tags.length > 0 ? (
                    <div className="mt-1 flex gap-1">
                      {note.tags.slice(0, 3).map((tag: string, i: number) => (
                        <span key={i} className="rounded bg-gray-100 px-1.5 py-0.5 text-[10px] text-gray-500 dark:bg-gray-700 dark:text-gray-400">{tag}</span>
                      ))}
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
