/**
 * PublishControl
 *
 * Inline publish switch + minimum-tier picker. Shared by the entity
 * editor header and the Publishing view rows.
 */

import { useState } from 'react'
import type { SubscriptionTier } from '../publish-api'

export interface PublishControlProps {
  /** Current publish state. */
  isPublished: boolean
  /** Current minimum tier (0 = public). */
  minimumTierLevel: number
  /** Timestamp shown below the switch when set. Nullable. */
  publishedAt?: string | null
  /** Tiers available to the author, sorted by tierLevel asc. */
  tiers: SubscriptionTier[]
  /** Whether the author has any subscription tiers configured at all. */
  hasTiers: boolean
  /** Persist publish toggle. */
  onTogglePublish: (next: boolean) => Promise<void>
  /** Persist tier change. */
  onChangeTier: (nextLevel: number) => Promise<void>
  /** Compact layout for tight headers. */
  compact?: boolean
}

export function PublishControl({
  isPublished,
  minimumTierLevel,
  publishedAt,
  tiers,
  hasTiers,
  onTogglePublish,
  onChangeTier,
  compact = false,
}: PublishControlProps) {
  const [pending, setPending] = useState<'publish' | 'tier' | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function handleToggle() {
    setPending('publish')
    setError(null)
    try {
      await onTogglePublish(!isPublished)
    } catch (err: any) {
      setError(err?.message ?? 'Could not update publish state')
    } finally {
      setPending(null)
    }
  }

  async function handleTierChange(e: React.ChangeEvent<HTMLSelectElement>) {
    const next = Number(e.target.value)
    setPending('tier')
    setError(null)
    try {
      await onChangeTier(next)
    } catch (err: any) {
      setError(err?.message ?? 'Could not update minimum tier')
    } finally {
      setPending(null)
    }
  }

  const gap = compact ? 'gap-2' : 'gap-3'

  return (
    <div className={`flex flex-col ${compact ? 'gap-1' : 'gap-1.5'}`}>
      <div className={`flex items-center ${gap}`}>
        <Toggle
          on={isPublished}
          onClick={handleToggle}
          disabled={pending === 'publish'}
          label={isPublished ? 'Published' : 'Draft'}
        />
        <span
          className={`text-xs font-medium ${
            isPublished
              ? 'text-emerald-600 dark:text-emerald-400'
              : 'text-gray-500 dark:text-gray-400'
          }`}
        >
          {isPublished ? 'Published' : 'Draft'}
        </span>

        {hasTiers && (
          <>
            <span className="text-xs text-gray-400 dark:text-gray-500">·</span>
            <label className="flex items-center gap-1.5 text-xs">
              <span className="text-gray-500 dark:text-gray-400">Tier</span>
              <select
                value={minimumTierLevel}
                onChange={handleTierChange}
                disabled={pending === 'tier' || !isPublished}
                className={`rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 px-1.5 py-0.5 text-xs text-gray-900 dark:text-gray-100 disabled:opacity-50 ${
                  compact ? 'max-w-[7rem]' : 'max-w-[10rem]'
                }`}
                title={
                  isPublished
                    ? 'Minimum subscriber tier to view this'
                    : 'Publish first to gate by tier'
                }
              >
                <option value={0}>Public</option>
                {tiers.map(t => (
                  <option key={t.id} value={t.tierLevel}>
                    {`T${t.tierLevel} · ${t.name}`}
                  </option>
                ))}
              </select>
            </label>
          </>
        )}
      </div>

      {publishedAt && !compact && (
        <span className="text-[11px] text-gray-500 dark:text-gray-400">
          First published {formatRelative(publishedAt)}
        </span>
      )}

      {error && (
        <span className="text-[11px] text-red-600 dark:text-red-400">{error}</span>
      )}
    </div>
  )
}

function Toggle({
  on,
  onClick,
  disabled,
  label,
}: {
  on: boolean
  onClick: () => void
  disabled?: boolean
  label: string
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      onClick={onClick}
      disabled={disabled}
      className={`relative inline-flex h-5 w-9 flex-shrink-0 cursor-pointer items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-1 disabled:opacity-60 ${
        on ? 'bg-emerald-500' : 'bg-gray-300 dark:bg-gray-600'
      }`}
    >
      <span
        className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${
          on ? 'translate-x-[18px]' : 'translate-x-0.5'
        }`}
      />
    </button>
  )
}

function formatRelative(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  const seconds = Math.round((Date.now() - d.getTime()) / 1000)
  if (seconds < 60) return 'just now'
  const minutes = Math.round(seconds / 60)
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.round(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.round(hours / 24)
  if (days < 30) return `${days}d ago`
  return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })
}
