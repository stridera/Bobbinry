'use client'

import { useMemo, useState } from 'react'
import { ModalFrame } from '@bobbinry/ui-components'
import {
  useSearchReplace,
  type SearchMatch,
  type SearchScope,
} from '@/hooks/useSearchReplace'

interface ActiveChapter {
  id: string
  title: string
}

interface SearchReplaceModalProps {
  projectId: string
  apiToken: string
  activeChapter: ActiveChapter | null
  initialScope: 'project' | 'chapter'
  onClose: () => void
}

const COLLECTION_LABELS: Record<string, string> = {
  content: 'Chapter',
  containers: 'Container',
  character: 'Character',
  place: 'Place',
  lore: 'Lore',
}

function collectionLabel(collection: string): string {
  return COLLECTION_LABELS[collection] ?? collection
}

function fieldLabel(field: string): string {
  if (!field) return ''
  return field.charAt(0).toUpperCase() + field.slice(1).replace(/_/g, ' ')
}

interface GroupedMatches {
  entityId: string
  collection: string
  matches: SearchMatch[]
}

function groupMatches(matches: SearchMatch[]): GroupedMatches[] {
  const order: string[] = []
  const byEntity = new Map<string, GroupedMatches>()
  for (const m of matches) {
    let group = byEntity.get(m.entityId)
    if (!group) {
      group = { entityId: m.entityId, collection: m.collection, matches: [] }
      byEntity.set(m.entityId, group)
      order.push(m.entityId)
    }
    group.matches.push(m)
  }
  return order.map(id => byEntity.get(id)!)
}

export function SearchReplaceModal({
  projectId,
  apiToken,
  activeChapter,
  initialScope,
  onClose,
}: SearchReplaceModalProps) {
  const [query, setQuery] = useState('')
  const [replacement, setReplacement] = useState('')
  const [caseSensitive, setCaseSensitive] = useState(false)
  const [wholeWord, setWholeWord] = useState(false)
  const [scopeType, setScopeType] = useState<'project' | 'chapter'>(
    initialScope === 'chapter' && activeChapter ? 'chapter' : 'project',
  )
  const [excluded, setExcluded] = useState<Set<string>>(new Set())

  const {
    preview,
    previewing,
    runPreview,
    apply,
    applying,
    error,
    lastApply,
  } = useSearchReplace({ projectId, apiToken })

  const scope: SearchScope = useMemo(
    () =>
      scopeType === 'chapter' && activeChapter
        ? { type: 'chapter', chapterId: activeChapter.id }
        : { type: 'project' },
    [scopeType, activeChapter],
  )

  const grouped = useMemo(() => groupMatches(preview?.matches ?? []), [preview])

  const selectedIds = useMemo(() => {
    if (!preview) return [] as string[]
    return preview.matches.filter(m => !excluded.has(m.id)).map(m => m.id)
  }, [preview, excluded])

  const handlePreview = async () => {
    if (!query.trim()) return
    setExcluded(new Set())
    await runPreview({
      query,
      replacement,
      caseSensitive,
      wholeWord,
      scope,
    })
  }

  const handleApply = async () => {
    if (!preview || selectedIds.length === 0) return
    const res = await apply(
      { query, replacement, caseSensitive, wholeWord, scope },
      selectedIds,
      preview.entityVersions,
    )
    if (res && res.stale.length === 0 && res.applied.length > 0) {
      // Successful end-to-end — pop a fresh preview so the panel shows the
      // updated state (or nothing left to replace).
      await runPreview({ query, replacement, caseSensitive, wholeWord, scope })
    }
  }

  const toggleMatch = (id: string) => {
    setExcluded(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const toggleGroup = (group: GroupedMatches) => {
    const allOff = group.matches.every(m => excluded.has(m.id))
    setExcluded(prev => {
      const next = new Set(prev)
      if (allOff) {
        for (const m of group.matches) next.delete(m.id)
      } else {
        for (const m of group.matches) next.add(m.id)
      }
      return next
    })
  }

  return (
    <ModalFrame onClose={onClose} ariaLabel="Search and Replace">
      <div className="bg-white dark:bg-gray-800 rounded-xl shadow-xl w-full max-w-4xl max-h-[85vh] flex flex-col">
        <header className="px-6 py-4 border-b border-gray-200 dark:border-gray-700 flex items-center justify-between">
          <h2 className="font-display text-xl font-bold text-gray-900 dark:text-gray-100">
            Search &amp; Replace
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 transition-colors"
            aria-label="Close"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </header>

        <div className="px-6 py-4 border-b border-gray-200 dark:border-gray-700 space-y-3">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div>
              <label htmlFor="sr-find" className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">
                Find
              </label>
              <input
                id="sr-find"
                type="text"
                value={query}
                onChange={e => setQuery(e.target.value)}
                onKeyDown={e => {
                  if (e.key === 'Enter') {
                    e.preventDefault()
                    handlePreview()
                  }
                }}
                placeholder="Text to find"
                autoFocus
                className="w-full px-3 py-2 border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100 rounded-lg focus:ring-2 focus:ring-blue-500/40 focus:border-blue-500 dark:focus:border-blue-400"
              />
            </div>
            <div>
              <label htmlFor="sr-replace" className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">
                Replace with
              </label>
              <input
                id="sr-replace"
                type="text"
                value={replacement}
                onChange={e => setReplacement(e.target.value)}
                placeholder="Replacement text"
                className="w-full px-3 py-2 border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100 rounded-lg focus:ring-2 focus:ring-blue-500/40 focus:border-blue-500 dark:focus:border-blue-400"
              />
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
            <label className="inline-flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300 cursor-pointer">
              <input
                type="checkbox"
                checked={caseSensitive}
                onChange={e => setCaseSensitive(e.target.checked)}
                className="rounded border-gray-300 dark:border-gray-600"
              />
              <span>Case sensitive</span>
            </label>
            <label className="inline-flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300 cursor-pointer">
              <input
                type="checkbox"
                checked={wholeWord}
                onChange={e => setWholeWord(e.target.checked)}
                className="rounded border-gray-300 dark:border-gray-600"
              />
              <span>Whole word</span>
            </label>

            <div className="ml-auto inline-flex items-center gap-3 text-sm">
              <span className="text-xs font-medium text-gray-600 dark:text-gray-400">Scope:</span>
              <label className="inline-flex items-center gap-1.5 cursor-pointer">
                <input
                  type="radio"
                  name="sr-scope"
                  value="project"
                  checked={scopeType === 'project'}
                  onChange={() => setScopeType('project')}
                />
                <span className="text-gray-700 dark:text-gray-300">Whole project</span>
              </label>
              <label
                className={`inline-flex items-center gap-1.5 ${activeChapter ? 'cursor-pointer text-gray-700 dark:text-gray-300' : 'cursor-not-allowed text-gray-400 dark:text-gray-500'}`}
              >
                <input
                  type="radio"
                  name="sr-scope"
                  value="chapter"
                  checked={scopeType === 'chapter'}
                  onChange={() => activeChapter && setScopeType('chapter')}
                  disabled={!activeChapter}
                />
                <span>
                  {activeChapter ? `This chapter${activeChapter.title ? `: ${activeChapter.title}` : ''}` : 'This chapter'}
                </span>
              </label>
            </div>
          </div>

          <div className="flex items-center justify-between pt-1">
            <button
              type="button"
              onClick={handlePreview}
              disabled={!query.trim() || previewing}
              className="px-4 py-2 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 dark:bg-blue-700 dark:hover:bg-blue-600 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {previewing ? 'Searching…' : 'Find matches'}
            </button>
            {preview && (
              <div className="text-sm text-gray-600 dark:text-gray-400">
                {preview.matches.length === 0
                  ? 'No matches'
                  : `${selectedIds.length} of ${preview.matches.length} selected`}
                {preview.truncated && (
                  <span className="ml-2 text-amber-600 dark:text-amber-400">(results truncated)</span>
                )}
              </div>
            )}
          </div>

          {error && (
            <p className="text-sm text-red-600 dark:text-red-400">{error}</p>
          )}
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-4">
          {!preview && (
            <p className="text-sm text-gray-500 dark:text-gray-400">
              Enter a search term and click <span className="font-medium">Find matches</span> to preview replacements.
              Nothing is changed until you click <span className="font-medium">Replace selected</span>.
            </p>
          )}

          {preview && preview.matches.length === 0 && (
            <p className="text-sm text-gray-500 dark:text-gray-400">No matches found.</p>
          )}

          {preview && grouped.map(group => {
            const groupSelected = group.matches.filter(m => !excluded.has(m.id)).length
            const allOff = groupSelected === 0
            return (
              <div key={group.entityId} className="mb-4 border border-gray-200 dark:border-gray-700 rounded-lg overflow-hidden">
                <div className="flex items-center justify-between px-3 py-2 bg-gray-50 dark:bg-gray-900/40">
                  <label className="inline-flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={!allOff}
                      ref={el => {
                        if (el) el.indeterminate = groupSelected > 0 && groupSelected < group.matches.length
                      }}
                      onChange={() => toggleGroup(group)}
                    />
                    <span className="text-sm font-medium text-gray-800 dark:text-gray-200">
                      {collectionLabel(group.collection)}
                    </span>
                    <span className="text-xs text-gray-500 dark:text-gray-500 font-mono">
                      {group.entityId.slice(0, 8)}
                    </span>
                  </label>
                  <span className="text-xs text-gray-500 dark:text-gray-400">
                    {groupSelected} of {group.matches.length} selected
                  </span>
                </div>
                <ul className="divide-y divide-gray-100 dark:divide-gray-700">
                  {group.matches.map(m => (
                    <li key={m.id} className="px-3 py-2 flex items-start gap-3">
                      <input
                        type="checkbox"
                        checked={!excluded.has(m.id)}
                        onChange={() => toggleMatch(m.id)}
                        className="mt-1"
                      />
                      <div className="min-w-0 flex-1">
                        <div className="text-xs uppercase tracking-wide text-gray-500 dark:text-gray-400 mb-0.5">
                          {fieldLabel(m.field)}
                        </div>
                        <div className="text-sm text-gray-800 dark:text-gray-200 font-mono break-words whitespace-pre-wrap">
                          <span className="text-gray-500 dark:text-gray-400">{m.contextBefore}</span>
                          <span className="bg-yellow-200 dark:bg-yellow-900/60 text-gray-900 dark:text-yellow-100 px-0.5 rounded">
                            {m.matchText}
                          </span>
                          <span className="text-gray-500 dark:text-gray-400">{m.contextAfter}</span>
                        </div>
                      </div>
                    </li>
                  ))}
                </ul>
              </div>
            )
          })}

          {lastApply && (
            <div className="mt-4 p-3 rounded-lg bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800 text-sm text-emerald-900 dark:text-emerald-100">
              Replaced in {lastApply.applied.length} {lastApply.applied.length === 1 ? 'item' : 'items'}.
              {lastApply.stale.length > 0 && (
                <span className="block mt-1 text-amber-800 dark:text-amber-200">
                  {lastApply.stale.length} {lastApply.stale.length === 1 ? 'item was' : 'items were'} edited
                  while you were previewing — re-run the search to see the latest state.
                </span>
              )}
            </div>
          )}
        </div>

        <footer className="px-6 py-3 border-t border-gray-200 dark:border-gray-700 flex items-center justify-end gap-3">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 hover:text-gray-900 dark:hover:text-gray-100 transition-colors"
          >
            Close
          </button>
          <button
            type="button"
            onClick={handleApply}
            disabled={!preview || selectedIds.length === 0 || applying}
            className="px-4 py-2 text-sm font-medium text-white bg-emerald-600 hover:bg-emerald-700 dark:bg-emerald-700 dark:hover:bg-emerald-600 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {applying ? 'Replacing…' : `Replace ${selectedIds.length || ''} selected`.trim()}
          </button>
        </footer>
      </div>
    </ModalFrame>
  )
}
