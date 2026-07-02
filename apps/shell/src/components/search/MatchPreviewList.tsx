'use client'

import { useMemo } from 'react'
import type { SearchMatch } from '@/hooks/useSearchReplace'

const COLLECTION_LABELS: Record<string, string> = {
  content: 'Chapter',
  containers: 'Container',
  character: 'Character',
  place: 'Place',
  lore: 'Lore',
}

export function collectionLabel(collection: string): string {
  return COLLECTION_LABELS[collection] ?? collection
}

export function fieldLabel(field: string): string {
  if (!field) return ''
  return field.charAt(0).toUpperCase() + field.slice(1).replace(/_/g, ' ')
}

export interface GroupedMatches {
  entityId: string
  collection: string
  matches: SearchMatch[]
}

export function groupMatches(matches: SearchMatch[]): GroupedMatches[] {
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

interface MatchPreviewListProps {
  matches: SearchMatch[]
  /** Display titles keyed by entityId; falls back to a short id. */
  entityTitles?: Record<string, string> | undefined
  /** Render per-match / per-group checkboxes (search & replace mode). */
  selectable?: boolean
  excluded?: Set<string> | undefined
  onToggleMatch?: ((id: string) => void) | undefined
  onToggleGroup?: ((group: GroupedMatches) => void) | undefined
  /** Clicking a match row (outside the checkbox) — used for navigation. */
  onMatchClick?: ((match: SearchMatch) => void) | undefined
  /** Tighter padding for dropdown panels. */
  compact?: boolean
  /** The chapter open in the editor — its group gets a "you are here" accent. */
  activeEntityId?: string | undefined
}

export function MatchPreviewList({
  matches,
  entityTitles,
  selectable = false,
  excluded,
  onToggleMatch,
  onToggleGroup,
  onMatchClick,
  compact = false,
  activeEntityId,
}: MatchPreviewListProps) {
  const grouped = useMemo(() => groupMatches(matches), [matches])
  const pad = compact ? 'px-2.5 py-1.5' : 'px-3 py-2'

  return (
    <>
      {grouped.map(group => {
        const groupSelected = group.matches.filter(m => !excluded?.has(m.id)).length
        const allOff = groupSelected === 0
        const title = entityTitles?.[group.entityId]
        const isActive = activeEntityId != null && group.entityId === activeEntityId
        return (
          <div
            key={group.entityId}
            className={`${compact ? 'mb-2.5' : 'mb-4'} border rounded-lg overflow-hidden ${
              isActive
                ? 'border-blue-200 dark:border-blue-900'
                : 'border-gray-200 dark:border-gray-700'
            }`}
          >
            <div className={`flex items-center justify-between ${pad} ${
              isActive ? 'bg-blue-50/60 dark:bg-blue-950/30' : 'bg-gray-50 dark:bg-gray-900/40'
            }`}>
              <label className={`inline-flex items-center gap-2 min-w-0 ${selectable ? 'cursor-pointer' : ''}`}>
                {selectable && (
                  <input
                    type="checkbox"
                    checked={!allOff}
                    ref={el => {
                      if (el) el.indeterminate = groupSelected > 0 && groupSelected < group.matches.length
                    }}
                    onChange={() => onToggleGroup?.(group)}
                  />
                )}
                <span className="text-sm font-medium text-gray-800 dark:text-gray-200 shrink-0">
                  {collectionLabel(group.collection)}
                </span>
                {title ? (
                  <span className="text-xs text-gray-500 dark:text-gray-400 truncate">{title}</span>
                ) : (
                  <span className="text-xs text-gray-500 dark:text-gray-500 font-mono">
                    {group.entityId.slice(0, 8)}
                  </span>
                )}
                {isActive && (
                  <span className="shrink-0 text-[10px] font-medium uppercase tracking-wide text-blue-600 dark:text-blue-400">
                    Open now
                  </span>
                )}
              </label>
              {selectable && (
                <span className="text-xs text-gray-500 dark:text-gray-400 shrink-0 ml-2">
                  {groupSelected} of {group.matches.length} selected
                </span>
              )}
            </div>
            <ul className="divide-y divide-gray-100 dark:divide-gray-700">
              {group.matches.map(m => (
                <li key={m.id} className={`${pad} flex items-start gap-3`}>
                  {selectable && (
                    <input
                      type="checkbox"
                      checked={!excluded?.has(m.id)}
                      onChange={() => onToggleMatch?.(m.id)}
                      className="mt-1"
                    />
                  )}
                  <div
                    className={`min-w-0 flex-1 ${onMatchClick ? 'cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-700/40 -mx-1 px-1 rounded transition-colors' : ''}`}
                    onClick={onMatchClick ? () => onMatchClick(m) : undefined}
                  >
                    <div className="text-xs uppercase tracking-wide text-gray-500 dark:text-gray-400 mb-0.5">
                      {fieldLabel(m.field)}
                    </div>
                    <div className="text-sm text-gray-800 dark:text-gray-200 font-mono break-words whitespace-pre-wrap">
                      <span className="text-gray-500 dark:text-gray-400">{m.contextBefore}</span>
                      {m.segments.map((seg, i) =>
                        seg.match ? (
                          <span
                            key={i}
                            className="bg-yellow-200 dark:bg-yellow-900/60 text-gray-900 dark:text-yellow-100 px-0.5 rounded"
                          >
                            {seg.text}
                          </span>
                        ) : (
                          <span key={i} className="text-gray-700 dark:text-gray-300">{seg.text}</span>
                        ),
                      )}
                      <span className="text-gray-500 dark:text-gray-400">{m.contextAfter}</span>
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          </div>
        )
      })}
    </>
  )
}
