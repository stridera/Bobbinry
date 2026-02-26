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

export function TagsEditor({ projectId, tags, onTagsChange }: TagsEditorProps) {
  const { data: session } = useSession()
  const [showAdd, setShowAdd] = useState(false)
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
      setShowAdd(false)
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

  // Group by category
  const grouped = CATEGORIES.reduce((acc, cat) => {
    const catTags = tags.filter(t => t.tagCategory === cat)
    if (catTags.length > 0) acc.push({ category: cat, tags: catTags })
    return acc
  }, [] as Array<{ category: string; tags: Tag[] }>)

  return (
    <div className="bg-white dark:bg-gray-800 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700 p-6 animate-fade-in">
      <div className="flex items-center justify-between mb-4">
        <h2 className="font-display text-lg font-semibold text-gray-900 dark:text-gray-100">Tags</h2>
        <button
          onClick={() => setShowAdd(!showAdd)}
          className="text-sm text-blue-600 dark:text-blue-400 hover:text-blue-700 dark:hover:text-blue-300 transition-colors cursor-pointer"
        >
          {showAdd ? 'Cancel' : '+ Add Tag'}
        </button>
      </div>

      {showAdd && (
        <div className="mb-4 p-3 bg-gray-50 dark:bg-gray-900/50 rounded-lg border border-gray-200 dark:border-gray-700">
          <div className="flex gap-2 items-end">
            <div className="flex-shrink-0">
              <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">Category</label>
              <select
                value={newCategory}
                onChange={(e) => setNewCategory(e.target.value)}
                className="px-3 py-2 border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 rounded-lg text-sm focus:ring-2 focus:ring-blue-500/40 outline-none"
              >
                {CATEGORIES.map(cat => (
                  <option key={cat} value={cat}>{cat.charAt(0).toUpperCase() + cat.slice(1)}</option>
                ))}
              </select>
            </div>
            <div className="flex-1">
              <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">Tag Name</label>
              <input
                type="text"
                value={newName}
                onChange={(e) => { setNewName(e.target.value); setError(null) }}
                onKeyDown={(e) => { if (e.key === 'Enter') handleAdd() }}
                placeholder="e.g. Fantasy, Romance..."
                className="w-full px-3 py-2 border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 rounded-lg text-sm focus:ring-2 focus:ring-blue-500/40 outline-none"
              />
            </div>
            <button
              onClick={handleAdd}
              disabled={adding || !newName.trim()}
              className="px-4 py-2 bg-blue-600 hover:bg-blue-700 dark:bg-blue-700 dark:hover:bg-blue-600 text-white rounded-lg text-sm font-medium disabled:opacity-50 transition-colors cursor-pointer"
            >
              {adding ? 'Adding...' : 'Add'}
            </button>
          </div>
          {error && <p className="text-xs text-red-600 dark:text-red-400 mt-2">{error}</p>}
        </div>
      )}

      {tags.length === 0 ? (
        <p className="text-sm text-gray-500 dark:text-gray-400 italic">No tags yet. Add tags to help readers discover your project.</p>
      ) : (
        <div className="space-y-3">
          {grouped.map(({ category, tags: catTags }) => (
            <div key={category}>
              <p className="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-1.5">
                {category}
              </p>
              <div className="flex flex-wrap gap-2">
                {catTags.map(tag => (
                  <span
                    key={tag.id}
                    className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium ${CATEGORY_COLORS[tag.tagCategory] || CATEGORY_COLORS.custom}`}
                  >
                    {tag.tagName}
                    <button
                      onClick={() => handleRemove(tag.id)}
                      className="ml-0.5 hover:opacity-70 transition-opacity cursor-pointer"
                      title="Remove tag"
                    >
                      &times;
                    </button>
                  </span>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
