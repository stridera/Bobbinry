import { useState, useEffect, useCallback } from 'react'
import { ConfirmModal } from '@bobbinry/sdk'
import type { BobbinrySDK } from '@bobbinry/sdk'

interface NoteEditorViewProps {
  projectId: string
  bobbinId: string
  viewId: string
  sdk: BobbinrySDK
  entityId?: string
  metadata?: Record<string, any>
}

export default function NoteEditorView({
  sdk,
  projectId,
  entityId,
}: NoteEditorViewProps) {
  const [note, setNote] = useState<Record<string, any> | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [saveStatus, setSaveStatus] = useState<'saved' | 'unsaved' | 'saving'>('saved')
  const [error, setError] = useState<string | null>(null)
  const [tagInput, setTagInput] = useState('')
  const [folders, setFolders] = useState<any[]>([])
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)
  const [deleting, setDeleting] = useState(false)

  async function handleDeleteNote() {
    if (!entityId) return
    setDeleting(true)
    try {
      await sdk.entities.delete('notes', entityId)
      window.dispatchEvent(new CustomEvent('bobbinry:entity-updated', {
        detail: { entityId, deleted: true }
      }))
      setNote(null)
    } catch (err) {
      console.error('[NoteEditor] Failed to delete:', err)
    } finally {
      setDeleting(false)
      setShowDeleteConfirm(false)
    }
  }

  useEffect(() => {
    if (entityId && entityId !== 'pinboard') {
      loadNote()
      loadFolders()
    }
  }, [entityId])

  async function loadNote() {
    try {
      setLoading(true)
      setError(null)
      const response = await sdk.entities.get('notes', entityId!)
      setNote(response as any)
    } catch (err: any) {
      console.error('[NoteEditor] Failed to load note:', err)
      setError(err.message || 'Failed to load note')
    } finally {
      setLoading(false)
    }
  }

  async function loadFolders() {
    try {
      const res = await sdk.entities.query({ collection: 'folders', limit: 1000 })
      setFolders((res.data as any[]) || [])
    } catch (err) {
      console.error('[NoteEditor] Failed to load folders:', err)
    }
  }

  const saveNote = useCallback(async (updates: Record<string, any>) => {
    if (!entityId || !note) return
    try {
      setSaving(true)
      setSaveStatus('saving')
      await sdk.entities.update('notes', entityId, {
        ...updates,
        updated_at: new Date().toISOString()
      })
      setNote(prev => prev ? { ...prev, ...updates } : prev)
      setSaveStatus('saved')

      window.dispatchEvent(new CustomEvent('bobbinry:entity-updated', {
        detail: { entityId, changes: updates }
      }))
    } catch (err) {
      console.error('[NoteEditor] Failed to save:', err)
      setSaveStatus('unsaved')
    } finally {
      setSaving(false)
    }
  }, [entityId, note, sdk])

  function handleAddTag() {
    const tag = tagInput.trim()
    if (!tag || !note) return
    const tags = [...(note.tags || []), tag]
    setTagInput('')
    setNote(prev => prev ? { ...prev, tags } : prev)
    saveNote({ tags })
  }

  function handleRemoveTag(tag: string) {
    if (!note) return
    const tags = (note.tags || []).filter((t: string) => t !== tag)
    setNote(prev => prev ? { ...prev, tags } : prev)
    saveNote({ tags })
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

  if (!note) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-gray-600 dark:text-gray-400">Select a note to edit</div>
      </div>
    )
  }

  return (
    <div className="flex flex-col h-full bg-gray-50 dark:bg-gray-900">
      {/* Header */}
      <div className="border-b border-gray-200 dark:border-gray-700 p-4 bg-white dark:bg-gray-800">
        <div className="flex items-center justify-between">
          <input
            type="text"
            value={note.title || ''}
            onChange={(e) => {
              setNote(prev => prev ? { ...prev, title: e.target.value } : prev)
              setSaveStatus('unsaved')
            }}
            onBlur={() => saveNote({ title: note.title })}
            className="text-2xl font-bold bg-transparent border-none outline-none text-gray-900 dark:text-gray-100 flex-1"
            placeholder="Note title..."
          />
          <div className="flex items-center gap-3">
            <button
              onClick={() => saveNote({ pinned: !note.pinned })}
              className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium transition-colors ${note.pinned ? 'border-amber-400 bg-amber-50 text-amber-700 dark:border-amber-500 dark:bg-amber-900/30 dark:text-amber-300' : 'border-gray-300 bg-transparent text-gray-400 hover:border-gray-400 hover:text-gray-600 dark:border-gray-600 dark:hover:border-gray-500 dark:hover:text-gray-300'}`}
              title={note.pinned ? 'Unpin' : 'Pin'}
            >
              📌 {note.pinned ? 'Pinned' : 'Pin'}
            </button>
            <span className="text-xs text-gray-400">
              {saveStatus === 'saving' ? 'Saving...' : saveStatus === 'unsaved' ? 'Unsaved' : 'Saved'}
            </span>
            <button
              onClick={() => setShowDeleteConfirm(true)}
              className="text-gray-400 hover:text-red-500 dark:text-gray-500 dark:hover:text-red-400 transition-colors"
              title="Delete note"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
              </svg>
            </button>
          </div>
        </div>
      </div>

      <div className="flex flex-1 overflow-hidden">
        {/* Editor */}
        <div className="flex-1 overflow-auto p-6">
          <textarea
            value={note.content || ''}
            onChange={(e) => {
              setNote(prev => prev ? { ...prev, content: e.target.value } : prev)
              setSaveStatus('unsaved')
            }}
            onBlur={() => saveNote({ content: note.content })}
            className="w-full h-full min-h-[400px] bg-transparent border-none outline-none text-gray-900 dark:text-gray-100 resize-none font-mono text-sm leading-relaxed"
            placeholder="Start writing..."
          />
        </div>

        {/* Metadata Sidebar */}
        <div className="w-64 border-l border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-4 overflow-y-auto space-y-4">
          {/* Folder */}
          <div>
            <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">Folder</label>
            <select
              value={note.folder_id || ''}
              onChange={(e) => {
                const folder_id = e.target.value || null
                setNote(prev => prev ? { ...prev, folder_id } : prev)
                saveNote({ folder_id })
              }}
              className="w-full px-2 py-1.5 text-sm border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100"
            >
              <option value="">No folder</option>
              {folders.map((f: any) => (
                <option key={f.id} value={f.id}>{f.name}</option>
              ))}
            </select>
          </div>

          {/* Tags */}
          <div>
            <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">Tags</label>
            <div className="flex flex-wrap gap-1 mb-2">
              {(note.tags || []).map((tag: string, i: number) => (
                <span
                  key={i}
                  className="inline-flex items-center gap-1 px-2 py-0.5 bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 rounded text-xs"
                >
                  {tag}
                  <button
                    onClick={() => handleRemoveTag(tag)}
                    className="text-gray-400 hover:text-red-500"
                  >
                    ×
                  </button>
                </span>
              ))}
            </div>
            <div className="flex gap-1">
              <input
                type="text"
                value={tagInput}
                onChange={(e) => setTagInput(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') handleAddTag() }}
                placeholder="Add tag..."
                className="flex-1 px-2 py-1 text-xs border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100"
              />
              <button
                onClick={handleAddTag}
                className="px-2 py-1 text-xs bg-gray-200 dark:bg-gray-700 rounded hover:bg-gray-300 dark:hover:bg-gray-600 text-gray-700 dark:text-gray-300"
              >
                +
              </button>
            </div>
          </div>

          {/* Color */}
          <div>
            <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">Color</label>
            <div className="flex gap-1 flex-wrap">
              {[null, '#ef4444', '#f59e0b', '#22c55e', '#3b82f6', '#8b5cf6', '#ec4899'].map((color, i) => (
                <button
                  key={i}
                  onClick={() => {
                    setNote(prev => prev ? { ...prev, color } : prev)
                    saveNote({ color })
                  }}
                  className={`w-6 h-6 rounded-full border-2 ${note.color === color ? 'border-white ring-2 ring-blue-500' : 'border-gray-300 dark:border-gray-600'}`}
                  style={{ backgroundColor: color || '#6b7280' }}
                  title={color || 'Default'}
                />
              ))}
            </div>
          </div>

          {/* Linked Entities */}
          <div>
            <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">Linked Entities</label>
            {(note.linked_entities || []).length === 0 ? (
              <p className="text-xs text-gray-400">No linked entities</p>
            ) : (
              <div className="space-y-1">
                {(note.linked_entities || []).map((link: any, i: number) => (
                  <div key={i} className="text-xs text-gray-300 bg-gray-700 px-2 py-1 rounded">
                    {link.label || link.entityId}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      <ConfirmModal
        open={showDeleteConfirm}
        title="Delete Note"
        description={`"${note.title || 'Untitled'}" will be permanently deleted. This cannot be undone.`}
        confirmLabel="Delete"
        variant="danger"
        loading={deleting}
        onConfirm={handleDeleteNote}
        onCancel={() => setShowDeleteConfirm(false)}
      />
    </div>
  )
}
