'use client'

import { useState } from 'react'
import { useSession } from 'next-auth/react'
import { apiFetch } from '@/lib/api'

interface Tag {
  id: string
  tagCategory: string
  tagName: string
}

interface TagsEditorProps {
  projectId: string
  tags: Tag[]
  onTagsChange: (tags: Tag[]) => void
}

const CATEGORY_COLORS: Record<string, string> = {
  genre: 'bg-teal-100 text-teal-800 dark:bg-teal-900/40 dark:text-teal-300',
  theme: 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300',
  trope: 'bg-purple-100 text-purple-800 dark:bg-purple-900/40 dark:text-purple-300',
  setting: 'bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-300',
  custom: 'bg-gray-100 text-gray-800 dark:bg-gray-700 dark:text-gray-300'
}

const CATEGORIES = ['genre', 'theme', 'trope', 'setting', 'custom'] as const

/**
 * Rail section for discovery tags. Read mode is a flat chip cloud; a single
 * "Edit" toggle reveals the remove buttons and the add form. Tags are a
 * set-once thing, so the editing affordances stay out of the way.
 */
export function TagsEditor({ projectId, tags, onTagsChange }: TagsEditorProps) {
  const { data: session } = useSession()
  const [editing, setEditing] = useState(false)
  const [newCategory, setNewCategory] = useState<string>('genre')
  const [newName, setNewName] = useState('')
  const [adding, setAdding] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleAdd = async () => {
    if (!newName.trim() || !session?.apiToken) return
    setAdding(true)
    setError(null)

    // Optimistic add
    const tempId = `temp-${Date.now()}`
    const optimisticTag: Tag = { id: tempId, tagCategory: newCategory, tagName: newName.trim() }
    onTagsChange([...tags, optimisticTag])

    try {
      const response = await apiFetch(`/api/projects/${projectId}/tags`, session.apiToken, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tagCategory: newCategory, tagName: newName.trim() })
      })

      if (response.status === 409) {
        // Revert optimistic add
        onTagsChange(tags)
        setError('Tag already exists')
        return
      }

      if (!response.ok) {
        onTagsChange(tags)
        setError('Failed to add tag')
        return
      }

      const data = await response.json()
      // Replace temp with real tag
      onTagsChange(tags.filter(t => t.id !== tempId).concat(data.tag))
      setNewName('')
    } catch {
      onTagsChange(tags)
      setError('Failed to add tag')
    } finally {
      setAdding(false)
    }
  }

  const handleRemove = async (tagId: string) => {
    if (!session?.apiToken) return
    const original = [...tags]

    // Optimistic remove
    onTagsChange(tags.filter(t => t.id !== tagId))

    try {
      const response = await apiFetch(`/api/projects/${projectId}/tags/${tagId}`, session.apiToken, {
        method: 'DELETE'
      })
      if (!response.ok) {
        onTagsChange(original)
      }
    } catch {
      onTagsChange(original)
    }
  }

  // Keep category order stable so the cloud doesn't reshuffle on every add.
  const ordered = CATEGORIES.flatMap(cat => tags.filter(t => t.tagCategory === cat))

  return (
    <section>
      <div className="flex items-center justify-between mb-2">
        <h2 className="text-[11px] font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400">Tags</h2>
        <button
          onClick={() => { setEditing(v => !v); setError(null) }}
          className="text-xs text-gray-500 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-100 transition-colors cursor-pointer"
        >
          {editing ? 'Done' : 'Edit'}
        </button>
      </div>

      {ordered.length === 0 && !editing ? (
        <p className="text-sm text-gray-400 dark:text-gray-500">
          No tags yet. Tags help readers find your project.
        </p>
      ) : (
        <div className="flex flex-wrap gap-1.5">
          {ordered.map(tag => (
            <span
              key={tag.id}
              className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${CATEGORY_COLORS[tag.tagCategory] || CATEGORY_COLORS.custom}`}
              title={tag.tagCategory}
            >
              {tag.tagName}
              {editing && (
                <button
                  onClick={() => handleRemove(tag.id)}
                  className="ml-0.5 -mr-0.5 hover:opacity-70 transition-opacity cursor-pointer"
                  title="Remove tag"
                  aria-label={`Remove ${tag.tagName}`}
                >
                  &times;
                </button>
              )}
            </span>
          ))}
        </div>
      )}

      {editing && (
        <div className="mt-3 space-y-2">
          <div className="flex gap-1.5">
            <select
              value={newCategory}
              onChange={(e) => setNewCategory(e.target.value)}
              className="shrink-0 px-2 py-1.5 border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 rounded-md text-xs focus:ring-2 focus:ring-blue-500/40 outline-none"
              aria-label="Tag category"
            >
              {CATEGORIES.map(cat => (
                <option key={cat} value={cat}>{cat.charAt(0).toUpperCase() + cat.slice(1)}</option>
              ))}
            </select>
            <input
              type="text"
              value={newName}
              onChange={(e) => { setNewName(e.target.value); setError(null) }}
              onKeyDown={(e) => { if (e.key === 'Enter') handleAdd() }}
              placeholder="Add a tag…"
              aria-label="Tag name"
              className="min-w-0 flex-1 px-2 py-1.5 border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 rounded-md text-xs focus:ring-2 focus:ring-blue-500/40 outline-none"
            />
            <button
              onClick={handleAdd}
              disabled={adding || !newName.trim()}
              className="shrink-0 px-2.5 py-1.5 bg-blue-600 hover:bg-blue-700 dark:bg-blue-700 dark:hover:bg-blue-600 text-white rounded-md text-xs font-medium disabled:opacity-50 transition-colors cursor-pointer"
            >
              Add
            </button>
          </div>
          {error && <p className="text-xs text-red-600 dark:text-red-400">{error}</p>}
        </div>
      )}
    </section>
  )
}
