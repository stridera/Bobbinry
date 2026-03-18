import { useState, useEffect } from 'react'
import type { BobbinrySDK } from '@bobbinry/sdk'

interface PinboardViewProps {
  projectId: string
  bobbinId: string
  viewId: string
  sdk: BobbinrySDK
  metadata?: Record<string, any>
}

export default function PinboardView({
  sdk,
  projectId,
}: PinboardViewProps) {
  const [notes, setNotes] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState<'pinned' | 'all'>('pinned')
  const [searchTerm, setSearchTerm] = useState('')

  useEffect(() => {
    loadNotes()
  }, [])

  async function loadNotes() {
    try {
      setLoading(true)
      const res = await sdk.entities.query({ collection: 'notes', limit: 1000 })
      setNotes((res.data as any[]) || [])
    } catch (err) {
      console.error('[Pinboard] Failed to load notes:', err)
    } finally {
      setLoading(false)
    }
  }

  function handleNoteClick(note: any) {
    window.dispatchEvent(new CustomEvent('bobbinry:navigate', {
      detail: {
        entityType: 'notes',
        entityId: note.id,
        bobbinId: 'notes',
        metadata: { view: 'note-editor' }
      }
    }))
  }

  async function togglePin(e: React.MouseEvent, note: any) {
    e.stopPropagation()
    try {
      await sdk.entities.update('notes', note.id, {
        pinned: !note.pinned,
        updated_at: new Date().toISOString()
      })
      await loadNotes()
    } catch (err) {
      console.error('[Pinboard] Failed to toggle pin:', err)
    }
  }

  const filteredNotes = notes
    .filter(n => filter === 'all' || n.pinned)
    .filter(n => {
      if (!searchTerm.trim()) return true
      const term = searchTerm.toLowerCase()
      return (n.title || '').toLowerCase().includes(term) ||
        (n.content || '').toLowerCase().includes(term) ||
        (n.tags || []).some((t: string) => t.toLowerCase().includes(term))
    })

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-gray-600 dark:text-gray-400">Loading...</div>
      </div>
    )
  }

  return (
    <div className="flex flex-col h-full bg-gray-50 dark:bg-gray-900">
      {/* Header */}
      <div className="border-b border-gray-200 dark:border-gray-700 p-4 bg-white dark:bg-gray-800">
        <div className="flex items-center justify-between mb-3">
          <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">📌 Pinboard</h1>
          <div className="flex gap-2">
            <button
              onClick={() => setFilter('pinned')}
              className={`px-3 py-1 text-sm rounded ${filter === 'pinned' ? 'bg-blue-600 text-white' : 'bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-300'}`}
            >
              Pinned
            </button>
            <button
              onClick={() => setFilter('all')}
              className={`px-3 py-1 text-sm rounded ${filter === 'all' ? 'bg-blue-600 text-white' : 'bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-300'}`}
            >
              All
            </button>
          </div>
        </div>
        <input
          type="text"
          placeholder="Search notes..."
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100"
        />
      </div>

      {/* Masonry Grid */}
      <div className="flex-1 overflow-auto p-6">
        {filteredNotes.length === 0 ? (
          <div className="text-center text-gray-600 dark:text-gray-400 mt-12">
            <p className="text-lg mb-2">{filter === 'pinned' ? 'No pinned notes' : 'No notes found'}</p>
            <p className="text-sm">Pin notes from the editor to see them here</p>
          </div>
        ) : (
          <div className="columns-1 md:columns-2 lg:columns-3 xl:columns-4 gap-4 space-y-4">
            {filteredNotes.map(note => (
              <div
                key={note.id}
                onClick={() => handleNoteClick(note)}
                className="break-inside-avoid border border-gray-200 dark:border-gray-700 rounded-lg p-4 cursor-pointer bg-white dark:bg-gray-800 hover:shadow-lg hover:border-blue-400 dark:hover:border-blue-600 transition-all"
                style={note.color ? { borderLeftColor: note.color, borderLeftWidth: '4px' } : undefined}
              >
                <div className="flex items-start justify-between mb-2">
                  <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100 flex-1 truncate">
                    {note.title || 'Untitled'}
                  </h3>
                  <button
                    onClick={(e) => togglePin(e, note)}
                    className={`inline-flex items-center gap-0.5 rounded-full border px-1.5 py-0.5 text-[10px] font-medium transition-colors ml-2 flex-shrink-0 ${
                      note.pinned
                        ? 'border-amber-400 bg-amber-50 text-amber-700 dark:border-amber-500 dark:bg-amber-900/30 dark:text-amber-300'
                        : 'border-gray-300 bg-transparent text-gray-400 hover:border-gray-400 hover:text-gray-600 dark:border-gray-600 dark:hover:border-gray-500 dark:hover:text-gray-300'
                    }`}
                  >
                    📌 {note.pinned ? 'Pinned' : 'Pin'}
                  </button>
                </div>
                {note.content && (
                  <p className="text-xs text-gray-600 dark:text-gray-400 line-clamp-4 mb-2">
                    {note.content.substring(0, 200)}
                  </p>
                )}
                {note.tags && note.tags.length > 0 && (
                  <div className="flex flex-wrap gap-1">
                    {note.tags.slice(0, 4).map((tag: string, i: number) => (
                      <span key={i} className="px-1.5 py-0.5 bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-400 rounded text-[10px]">
                        {tag}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
