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
    const icon = folder.icon || '📁'

    return (
      <div key={folder.id}>
        <div
          className={`pr-2 py-1 cursor-pointer hover:bg-gray-700 text-sm flex items-center gap-1.5 ${isSelected ? 'bg-gray-700' : ''}`}
          style={{ paddingLeft: `${depth * 16 + 8}px` }}
          onClick={() => handleFolderClick(folder.id)}
          onContextMenu={(e) => {
            e.preventDefault()
            handleDelete(folder.id, 'folders')
          }}
        >
          {hasChildren ? (
            <span
              className="text-gray-400 text-xs w-3 flex-shrink-0 hover:text-gray-200"
              onClick={(e) => { e.stopPropagation(); toggleFolder(folder.id) }}
            >
              {isExpanded ? '▼' : '▶'}
            </span>
          ) : (
            <span className="w-3 flex-shrink-0" />
          )}
          <span className="flex-shrink-0">{icon}</span>
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
              className="flex-1 px-1 py-0.5 bg-gray-800 border border-gray-600 rounded text-gray-100"
              onClick={(e) => e.stopPropagation()}
            />
          ) : (
            <span className="flex-1 text-gray-200 truncate">{folder.name}</span>
          )}
        </div>
        {hasChildren && isExpanded && folder.children.map(child => renderFolder(child, depth + 1))}
      </div>
    )
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
        <div className="relative dropdown-container">
          <button
            onClick={() => setShowDropdown(!showDropdown)}
            className="text-lg leading-none text-gray-400 hover:text-gray-200 w-6 h-6 flex items-center justify-center"
            title="Create new item"
          >
            +
          </button>
          {showDropdown && (
            <div className="absolute right-0 top-full mt-1 bg-gray-700 border border-gray-600 rounded shadow-lg z-50 min-w-[150px]">
              <button
                onClick={() => { createFolder(selectedFolderId); setShowDropdown(false) }}
                className="w-full text-left px-3 py-2 text-sm hover:bg-gray-600 text-gray-100"
              >
                📁 New Folder
              </button>
              <button
                onClick={() => { createNote(selectedFolderId); setShowDropdown(false) }}
                className="w-full text-left px-3 py-2 text-sm hover:bg-gray-600 text-gray-100 border-t border-gray-600"
              >
                📝 New Note
              </button>
            </div>
          )}
        </div>
        <button
          onClick={openPinboard}
          className="text-xs text-gray-400 hover:text-gray-200"
          title="Pinboard"
        >
          📌
        </button>
        <button
          onClick={loadData}
          className="text-xs text-gray-400 hover:text-gray-200"
          title="Refresh"
        >
          ↻
        </button>
      </PanelActions>

      {/* Folder Tree */}
      <div className="overflow-y-auto border-b border-gray-700">
        {selectedFolderId && (
          <div
            className="px-3 py-1 text-xs text-gray-400 hover:text-gray-200 cursor-pointer hover:bg-gray-700"
            onClick={() => setSelectedFolderId(null)}
          >
            ← All Notes
          </div>
        )}
        {folders.map(folder => renderFolder(folder))}
      </div>

      {/* Note List */}
      <div className="flex-1 overflow-y-auto">
        {filteredNotes.length === 0 ? (
          <div className="p-4 text-center text-sm text-gray-400">
            <div className="mb-3">No notes yet</div>
            <button
              onClick={() => createNote(selectedFolderId)}
              className="px-3 py-1.5 text-xs bg-gray-700 hover:bg-gray-600 text-gray-200 rounded"
            >
              Create Your First Note
            </button>
          </div>
        ) : (
          filteredNotes.map((note: any) => (
            <div
              key={note.id}
              className={`px-3 py-2 cursor-pointer hover:bg-gray-700 border-b border-gray-700/50 ${selectedNoteId === note.id ? 'bg-gray-700' : ''}`}
              onClick={() => handleNoteClick(note)}
              onContextMenu={(e) => { e.preventDefault(); handleDelete(note.id, 'notes') }}
            >
              <div className="flex items-center gap-1.5">
                {note.pinned && <span className="text-xs">📌</span>}
                <span className="text-sm text-gray-200 truncate">{note.title || 'Untitled'}</span>
              </div>
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
