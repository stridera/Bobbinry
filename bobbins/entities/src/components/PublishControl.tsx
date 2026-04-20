/**
 * PublishControl
 *
 * Inline publish switch + minimum-tier picker. Shared by the entity
 * editor header and the Publishing view rows.
 */

import { useState } from 'react'
import type { SubscriptionTier } from '../publish-api'

export interface VariantOption {
  id: string
  label: string
}

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

  /**
   * Entity variants (sorted by axis). Passing a non-empty array enables the
   * variant-publish picker; leave empty/undefined for entities without
   * variants or when rendering on a type-def row.
   */
  variants?: VariantOption[]
  /** Whether the base (un-overlaid) view is published. Default true. */
  publishBase?: boolean
  /** Ids in `variants` that are currently published. */
  publishedVariantIds?: string[]
  /**
   * Persist the combined variant set. Called with the full next state so the
   * server can validate "at least one of base/variants is selected."
   */
  onChangeVariantSet?: (next: {
    publishBase: boolean
    publishedVariantIds: string[]
  }) => Promise<void>
  /**
   * Per-variant (and base) minimum tier overrides. Map of variant id or
   * '__base__' → min tier level. Missing keys default to 0. When omitted the
   * tier selectors are hidden.
   */
  variantAccessLevels?: Record<string, number>
  /**
   * Persist a single variant's tier override. level === 0 clears the override.
   */
  onChangeVariantTier?: (which: string | '__base__', level: number) => Promise<void> | void
  /**
   * Suppress the built-in variants expandable — useful when the caller (e.g.
   * the entity editor) manages variant publishing through another surface like
   * the variant manage bar.
   */
  hideVariantPicker?: boolean
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
  variants = [],
  publishBase = true,
  publishedVariantIds = [],
  onChangeVariantSet,
  variantAccessLevels,
  onChangeVariantTier,
  hideVariantPicker = false,
}: PublishControlProps) {
  const [pending, setPending] = useState<'publish' | 'tier' | 'variants' | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [variantPickerOpen, setVariantPickerOpen] = useState(false)

  const showVariantTiers = hasTiers && !!variantAccessLevels && !!onChangeVariantTier

  const hasVariants = !hideVariantPicker && variants.length > 0 && !!onChangeVariantSet
  const variantIdSet = new Set(publishedVariantIds)
  const variantCountLabel = hasVariants
    ? describeVariantSelection(publishBase, publishedVariantIds.length, variants.length)
    : null

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

  async function handleVariantChange(nextBase: boolean, nextVariantIds: string[]) {
    if (!onChangeVariantSet) return
    // Disallow publishing nothing when entity is live — the author gets
    // immediate feedback instead of a server roundtrip.
    if (isPublished && !nextBase && nextVariantIds.length === 0) {
      setError('Publishing requires at least the base or one variant to be visible')
      return
    }
    setPending('variants')
    setError(null)
    try {
      await onChangeVariantSet({ publishBase: nextBase, publishedVariantIds: nextVariantIds })
    } catch (err: any) {
      setError(err?.message ?? 'Could not update published variants')
    } finally {
      setPending(null)
    }
  }

  function toggleVariantId(id: string) {
    const next = new Set(publishedVariantIds)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    handleVariantChange(publishBase, Array.from(next))
  }

  function toggleBase(next: boolean) {
    handleVariantChange(next, publishedVariantIds)
  }

  async function handleVariantTierChange(which: string | '__base__', level: number) {
    if (!onChangeVariantTier) return
    setPending('variants')
    setError(null)
    try {
      await onChangeVariantTier(which, level)
    } catch (err: any) {
      setError(err?.message ?? 'Could not update variant tier')
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

      {hasVariants && (
        <div className="flex flex-col gap-1">
          <button
            type="button"
            onClick={() => setVariantPickerOpen(o => !o)}
            disabled={!isPublished || pending === 'variants'}
            className="flex items-center gap-1 self-start text-[11px] text-gray-600 dark:text-gray-300 hover:text-gray-900 dark:hover:text-gray-100 disabled:opacity-50"
            title={
              isPublished
                ? 'Choose which base + variants show on the reader'
                : 'Publish first to choose variants'
            }
          >
            <svg
              className={`h-2.5 w-2.5 transition-transform ${variantPickerOpen ? 'rotate-90' : ''}`}
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
            </svg>
            <span>{variantCountLabel}</span>
          </button>
          {variantPickerOpen && isPublished && (
            <div className="rounded-md border border-gray-200 bg-gray-50 p-2 dark:border-gray-700 dark:bg-gray-900/60">
              <VariantRow
                label="Base"
                checked={publishBase}
                disabled={pending === 'variants'}
                onChange={toggleBase}
                hint="Shared fields"
                tierSelector={
                  showVariantTiers ? (
                    <VariantTierSelect
                      level={variantAccessLevels?.['__base__'] ?? 0}
                      tiers={tiers}
                      disabled={!publishBase || pending === 'variants'}
                      onChange={level => handleVariantTierChange('__base__', level)}
                    />
                  ) : undefined
                }
              />
              {variants.map(v => (
                <VariantRow
                  key={v.id}
                  label={v.label}
                  checked={variantIdSet.has(v.id)}
                  disabled={pending === 'variants'}
                  onChange={() => toggleVariantId(v.id)}
                  tierSelector={
                    showVariantTiers ? (
                      <VariantTierSelect
                        level={variantAccessLevels?.[v.id] ?? 0}
                        tiers={tiers}
                        disabled={!variantIdSet.has(v.id) || pending === 'variants'}
                        onChange={level => handleVariantTierChange(v.id, level)}
                      />
                    ) : undefined
                  }
                />
              ))}
            </div>
          )}
        </div>
      )}

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

function describeVariantSelection(
  publishBase: boolean,
  selectedVariantCount: number,
  totalVariants: number
): string {
  if (publishBase && selectedVariantCount === 0) return 'Base only'
  if (!publishBase && selectedVariantCount === 0) return 'Nothing selected'
  if (!publishBase && selectedVariantCount === totalVariants) return 'All variants'
  if (publishBase && selectedVariantCount === totalVariants) return 'Base + all variants'
  if (publishBase) {
    return `Base + ${selectedVariantCount} of ${totalVariants} variants`
  }
  return `${selectedVariantCount} of ${totalVariants} variants`
}

function VariantRow({
  label,
  checked,
  onChange,
  disabled,
  hint,
  tierSelector,
}: {
  label: string
  checked: boolean
  onChange: (next: boolean) => void
  disabled?: boolean
  hint?: string
  tierSelector?: React.ReactNode
}) {
  return (
    <div className={`flex items-center gap-2 py-0.5 text-[12px] ${disabled ? 'opacity-60' : ''}`}>
      <label className={`flex flex-1 min-w-0 items-center gap-2 ${disabled ? '' : 'cursor-pointer'}`}>
        <input
          type="checkbox"
          checked={checked}
          disabled={disabled}
          onChange={e => onChange(e.target.checked)}
          className="h-3.5 w-3.5 accent-blue-600"
        />
        <span className="truncate text-gray-800 dark:text-gray-200">{label}</span>
        {hint && <span className="text-[10px] text-gray-500 dark:text-gray-400">· {hint}</span>}
      </label>
      {tierSelector}
    </div>
  )
}

function VariantTierSelect({
  level,
  tiers,
  disabled,
  onChange,
}: {
  level: number
  tiers: SubscriptionTier[]
  disabled?: boolean
  onChange: (level: number) => void
}) {
  return (
    <select
      value={level}
      disabled={disabled}
      onChange={e => onChange(Number(e.target.value))}
      title={disabled ? 'Enable this view first to gate it by tier' : 'Minimum subscriber tier for this view'}
      className="max-w-[7rem] rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 px-1.5 py-0.5 text-[11px] text-gray-900 dark:text-gray-100 disabled:opacity-50"
    >
      <option value={0}>Public</option>
      {tiers.map(t => (
        <option key={t.id} value={t.tierLevel}>{`T${t.tierLevel} · ${t.name}`}</option>
      ))}
    </select>
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
