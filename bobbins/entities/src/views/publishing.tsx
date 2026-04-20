/**
 * Publishing View
 *
 * Consolidated author-facing UI for marking entity types and entities as
 * "publish to reader," gating them behind a minimum subscription tier,
 * and controlling the order they appear in the reader's Entities tab.
 *
 * Reorder is done via arrow buttons (up/down one step) rather than
 * drag-and-drop to keep the entities bobbin dep-light. The server-side
 * reorder endpoints take the full ordered list, so we rewrite it on each
 * move. Fine for typical worldbuilding scale (<500 entities per type).
 */

import { useCallback, useEffect, useMemo, useState } from 'react'
import type { BobbinrySDK } from '@bobbinry/sdk'
import { getTypeId, normalizeTypeConfig } from '../types'
import type { EntityTypeDefinition } from '../types'
import { getVariants, sortedVariantIds } from '../variants'
import { PublishControl, type VariantOption } from '../components/PublishControl'
import {
  fetchProjectOwner,
  fetchSubscriptionTiers,
  patchEntityPublish,
  patchTypePublish,
  reorderEntities,
  reorderTypes,
  type SubscriptionTier,
} from '../publish-api'

interface PublishingViewProps {
  projectId: string
  bobbinId: string
  viewId: string
  sdk: BobbinrySDK
}

interface PublishableRow {
  id: string
  name: string
  isPublished: boolean
  publishedAt: string | null
  publishOrder: number
  minimumTierLevel: number
  publishBase: boolean
  publishedVariantIds: string[]
  variantAccessLevels: Record<string, number>
  variants: VariantOption[]
}

interface PublishableType {
  rowId: string // underlying entity row id (for PATCH)
  typeId: string
  label: string
  icon: string
  config: EntityTypeDefinition
  isPublished: boolean
  publishedAt: string | null
  publishOrder: number
  minimumTierLevel: number
}

export default function PublishingView({ projectId, sdk }: PublishingViewProps) {
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [tiers, setTiers] = useState<SubscriptionTier[]>([])
  const [acceptsPayments, setAcceptsPayments] = useState(false)
  const [types, setTypes] = useState<PublishableType[]>([])
  const [entitiesByType, setEntitiesByType] = useState<Record<string, PublishableRow[]>>({})
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [showUnpublished, setShowUnpublished] = useState(true)
  const [busy, setBusy] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const [{ ownerId }, typeRes] = await Promise.all([
        fetchProjectOwner(sdk, projectId),
        sdk.entities.query({ collection: 'entity_type_definitions', limit: 500 }),
      ])

      const tierRes = await fetchSubscriptionTiers(sdk, ownerId)
      setTiers([...tierRes.tiers].sort((a, b) => a.tierLevel - b.tierLevel))
      setAcceptsPayments(tierRes.acceptsPayments)

      const rows = (typeRes.data as any[]).map(d => {
        const config = normalizeTypeConfig(d)
        return {
          rowId: d.id as string,
          typeId: getTypeId(config),
          label: config.label,
          icon: config.icon ?? '📋',
          config,
          isPublished: Boolean(d.isPublished),
          publishedAt: (d.publishedAt ?? null) as string | null,
          publishOrder: (d.publishOrder ?? 0) as number,
          minimumTierLevel: (d.minimumTierLevel ?? 0) as number,
        }
      })

      // Sort by publishOrder, then label. Published types float to the top
      // so authors can see what's live at a glance.
      rows.sort((a, b) => {
        if (a.isPublished !== b.isPublished) return a.isPublished ? -1 : 1
        if (a.publishOrder !== b.publishOrder) return a.publishOrder - b.publishOrder
        return a.label.localeCompare(b.label)
      })
      setTypes(rows)
    } catch (err: any) {
      console.error('[Publishing] Failed to load:', err)
      setError(err?.message ?? 'Failed to load publishing data')
    } finally {
      setLoading(false)
    }
  }, [projectId, sdk])

  useEffect(() => {
    refresh()
  }, [refresh])

  async function loadEntitiesForType(typeId: string) {
    if (entitiesByType[typeId]) return
    try {
      const res = await sdk.entities.query({ collection: typeId, limit: 1000 })
      const type = types.find(t => t.typeId === typeId)
      const axisKind = type?.config.variantAxis?.kind ?? null
      const rows: PublishableRow[] = (res.data as any[]).map(d => {
        const variantsBlock = getVariants(d)
        const ids = variantsBlock ? sortedVariantIds(d, axisKind) : []
        const variantOptions: VariantOption[] = ids.map(id => ({
          id,
          label: variantsBlock?.items[id]?.label ?? id,
        }))
        return {
          id: d.id as string,
          name: (d.name as string) ?? 'Untitled',
          isPublished: Boolean(d.isPublished),
          publishedAt: (d.publishedAt ?? null) as string | null,
          publishOrder: (d.publishOrder ?? 0) as number,
          minimumTierLevel: (d.minimumTierLevel ?? 0) as number,
          publishBase: d.publishBase ?? true,
          publishedVariantIds: Array.isArray(d.publishedVariantIds) ? d.publishedVariantIds : [],
          variantAccessLevels:
            d.variantAccessLevels && typeof d.variantAccessLevels === 'object'
              ? (d.variantAccessLevels as Record<string, number>)
              : {},
          variants: variantOptions,
        }
      })
      rows.sort((a, b) => {
        if (a.isPublished !== b.isPublished) return a.isPublished ? -1 : 1
        if (a.publishOrder !== b.publishOrder) return a.publishOrder - b.publishOrder
        return a.name.localeCompare(b.name)
      })
      setEntitiesByType(prev => ({ ...prev, [typeId]: rows }))
    } catch (err) {
      console.error('[Publishing] Failed to load entities for', typeId, err)
    }
  }

  function toggleExpand(typeId: string) {
    setExpanded(prev => {
      const next = new Set(prev)
      if (next.has(typeId)) next.delete(typeId)
      else {
        next.add(typeId)
        loadEntitiesForType(typeId)
      }
      return next
    })
  }

  // ---------- Type mutations ----------

  async function togglePublishType(t: PublishableType, next: boolean) {
    setBusy(`type:${t.typeId}`)
    try {
      const result = await patchTypePublish(sdk, projectId, t.typeId, { isPublished: next })
      setTypes(prev =>
        prev.map(r =>
          r.typeId === t.typeId
            ? { ...r, isPublished: result.isPublished, publishedAt: result.publishedAt }
            : r
        )
      )
    } finally {
      setBusy(null)
    }
  }

  async function changeTierForType(t: PublishableType, nextLevel: number) {
    setBusy(`type:${t.typeId}`)
    try {
      const result = await patchTypePublish(sdk, projectId, t.typeId, {
        minimumTierLevel: nextLevel,
      })
      setTypes(prev =>
        prev.map(r =>
          r.typeId === t.typeId ? { ...r, minimumTierLevel: result.minimumTierLevel } : r
        )
      )
    } finally {
      setBusy(null)
    }
  }

  async function moveType(typeId: string, delta: -1 | 1) {
    const idx = types.findIndex(t => t.typeId === typeId)
    if (idx === -1) return
    const target = idx + delta
    if (target < 0 || target >= types.length) return
    const next = [...types]
    ;[next[idx], next[target]] = [next[target]!, next[idx]!]
    // Optimistic: reassign publishOrder by index so the UI sorts stably next time
    next.forEach((t, i) => (t.publishOrder = i))
    setTypes(next)
    setBusy(`type:${typeId}`)
    try {
      await reorderTypes(sdk, projectId, next.map(t => t.typeId))
    } catch (err) {
      console.error('[Publishing] Reorder failed, reloading:', err)
      await refresh()
    } finally {
      setBusy(null)
    }
  }

  // ---------- Entity mutations ----------

  async function togglePublishEntity(typeId: string, row: PublishableRow, next: boolean) {
    setBusy(`entity:${row.id}`)
    try {
      const result = await patchEntityPublish(sdk, projectId, typeId, row.id, {
        isPublished: next,
      })
      setEntitiesByType(prev => ({
        ...prev,
        [typeId]: (prev[typeId] ?? []).map(r =>
          r.id === row.id
            ? { ...r, isPublished: result.isPublished, publishedAt: result.publishedAt }
            : r
        ),
      }))
    } finally {
      setBusy(null)
    }
  }

  async function changeTierForEntity(typeId: string, row: PublishableRow, nextLevel: number) {
    setBusy(`entity:${row.id}`)
    try {
      const result = await patchEntityPublish(sdk, projectId, typeId, row.id, {
        minimumTierLevel: nextLevel,
      })
      setEntitiesByType(prev => ({
        ...prev,
        [typeId]: (prev[typeId] ?? []).map(r =>
          r.id === row.id ? { ...r, minimumTierLevel: result.minimumTierLevel } : r
        ),
      }))
    } finally {
      setBusy(null)
    }
  }

  async function moveEntity(typeId: string, entityId: string, delta: -1 | 1) {
    const list = entitiesByType[typeId] ?? []
    const idx = list.findIndex(r => r.id === entityId)
    if (idx === -1) return
    const target = idx + delta
    if (target < 0 || target >= list.length) return
    const next = [...list]
    ;[next[idx], next[target]] = [next[target]!, next[idx]!]
    next.forEach((r, i) => (r.publishOrder = i))
    setEntitiesByType(prev => ({ ...prev, [typeId]: next }))
    setBusy(`entity:${entityId}`)
    try {
      await reorderEntities(sdk, projectId, typeId, next.map(r => r.id))
    } catch (err) {
      console.error('[Publishing] Entity reorder failed, reloading:', err)
      // Evict and re-fetch through the normal loader so variants stay in sync
      setEntitiesByType(prev => {
        const { [typeId]: _dropped, ...rest } = prev
        return rest
      })
      loadEntitiesForType(typeId)
    } finally {
      setBusy(null)
    }
  }

  async function changeVariantSetForEntity(
    typeId: string,
    row: PublishableRow,
    next: { publishBase: boolean; publishedVariantIds: string[] }
  ) {
    setBusy(`entity:${row.id}`)
    try {
      const result = await patchEntityPublish(sdk, projectId, typeId, row.id, next)
      setEntitiesByType(prev => ({
        ...prev,
        [typeId]: (prev[typeId] ?? []).map(r =>
          r.id === row.id
            ? {
                ...r,
                publishBase: result.publishBase,
                publishedVariantIds: result.publishedVariantIds,
              }
            : r
        ),
      }))
    } finally {
      setBusy(null)
    }
  }

  async function changeVariantTierForEntity(
    typeId: string,
    row: PublishableRow,
    which: string | '__base__',
    level: number
  ) {
    setBusy(`entity:${row.id}`)
    try {
      const next = { ...row.variantAccessLevels }
      if (level === 0) delete next[which]
      else next[which] = level
      const result = await patchEntityPublish(sdk, projectId, typeId, row.id, {
        variantAccessLevels: next,
      })
      setEntitiesByType(prev => ({
        ...prev,
        [typeId]: (prev[typeId] ?? []).map(r =>
          r.id === row.id
            ? { ...r, variantAccessLevels: result.variantAccessLevels }
            : r
        ),
      }))
    } finally {
      setBusy(null)
    }
  }

  const hasTiers = tiers.length > 0

  const filteredTypes = useMemo(
    () => (showUnpublished ? types : types.filter(t => t.isPublished)),
    [types, showUnpublished]
  )

  const stats = useMemo(() => {
    const liveTypes = types.filter(t => t.isPublished).length
    const liveEntities = Object.values(entitiesByType)
      .flat()
      .filter(e => e.isPublished).length
    return { liveTypes, liveEntities }
  }, [types, entitiesByType])

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center text-gray-500 dark:text-gray-400">
        Loading publishing settings…
      </div>
    )
  }

  if (error) {
    return (
      <div className="flex h-full items-center justify-center p-6">
        <div className="max-w-md rounded-lg border border-red-300 bg-red-50 p-6 dark:border-red-700 dark:bg-red-900/20">
          <h2 className="mb-2 text-lg font-semibold text-red-700 dark:text-red-300">
            Couldn't load publishing
          </h2>
          <p className="text-red-600 dark:text-red-400">{error}</p>
        </div>
      </div>
    )
  }

  return (
    <div className="flex h-full flex-col bg-gray-50 dark:bg-gray-900">
      {/* Header */}
      <div className="border-b border-gray-200 bg-white px-6 py-4 dark:border-gray-700 dark:bg-gray-800">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="text-xl font-semibold text-gray-900 dark:text-gray-100">
              Publishing
            </h1>
            <p className="mt-0.5 text-sm text-gray-600 dark:text-gray-400">
              Choose which entity sections and entries appear in your reader codex, and who can
              see each one.
            </p>
          </div>
          <div className="flex items-center gap-3 text-xs">
            <span className="text-gray-500 dark:text-gray-400">
              {stats.liveTypes} sections · {stats.liveEntities} entries live
            </span>
            <label className="flex items-center gap-1.5 text-gray-600 dark:text-gray-300">
              <input
                type="checkbox"
                checked={showUnpublished}
                onChange={e => setShowUnpublished(e.target.checked)}
                className="h-3.5 w-3.5 accent-blue-600"
              />
              Show drafts
            </label>
          </div>
        </div>

        {/* Tiers banner */}
        <div className="mt-3 rounded-md border border-gray-200 bg-gray-50 px-3 py-2 text-xs dark:border-gray-700 dark:bg-gray-900/60">
          {hasTiers ? (
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-medium text-gray-700 dark:text-gray-300">Your tiers:</span>
              {tiers.map(t => (
                <span
                  key={t.id}
                  className="inline-flex items-center gap-1 rounded-full border border-gray-200 bg-white px-2 py-0.5 text-[11px] text-gray-700 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-200"
                  title={t.description ?? undefined}
                >
                  <span className="font-mono text-gray-400 dark:text-gray-500">T{t.tierLevel}</span>
                  <span>{t.name}</span>
                </span>
              ))}
              {!acceptsPayments && (
                <span className="text-amber-700 dark:text-amber-400">
                  (Stripe not connected — tiers are visible but no one can subscribe yet)
                </span>
              )}
            </div>
          ) : (
            <span className="text-gray-500 dark:text-gray-400">
              No subscription tiers configured. Entities will be gated as public-only until you
              set up tiers in Settings → Monetization.
            </span>
          )}
        </div>
      </div>

      {/* Types list */}
      <div className="flex-1 overflow-y-auto px-6 py-4">
        {filteredTypes.length === 0 ? (
          <EmptyState
            title={types.length === 0 ? 'No entity types yet' : 'All types are drafts'}
            description={
              types.length === 0
                ? 'Create your first entity type (Characters, Races, Spells…) before publishing.'
                : 'Turn on "Show drafts" to manage unpublished sections.'
            }
          />
        ) : (
          <ul className="space-y-3">
            {filteredTypes.map((t, i) => {
              const isExpanded = expanded.has(t.typeId)
              const list = entitiesByType[t.typeId]
              const entityCount = list?.length ?? 0
              const publishedEntityCount = list?.filter(r => r.isPublished).length ?? 0

              return (
                <li
                  key={t.typeId}
                  className="overflow-hidden rounded-lg border border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-800"
                >
                  <div className="flex items-start gap-3 px-4 py-3">
                    <ReorderButtons
                      onUp={() => moveType(t.typeId, -1)}
                      onDown={() => moveType(t.typeId, 1)}
                      disableUp={i === 0}
                      disableDown={i === filteredTypes.length - 1}
                      busy={busy === `type:${t.typeId}`}
                    />

                    <button
                      type="button"
                      onClick={() => toggleExpand(t.typeId)}
                      className="flex flex-1 items-start gap-3 text-left"
                    >
                      <span className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-md bg-gray-100 text-lg dark:bg-gray-700">
                        {t.icon}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="flex items-center gap-2">
                          <span className="font-medium text-gray-900 dark:text-gray-100">
                            {t.label}
                          </span>
                          <svg
                            className={`h-3 w-3 text-gray-400 transition-transform ${
                              isExpanded ? 'rotate-90' : ''
                            }`}
                            fill="none"
                            stroke="currentColor"
                            viewBox="0 0 24 24"
                          >
                            <path
                              strokeLinecap="round"
                              strokeLinejoin="round"
                              strokeWidth={2}
                              d="M9 5l7 7-7 7"
                            />
                          </svg>
                        </span>
                        <span className="mt-0.5 block text-xs text-gray-500 dark:text-gray-400">
                          {list
                            ? `${publishedEntityCount} of ${entityCount} entities published`
                            : 'Expand to load entities'}
                        </span>
                      </span>
                    </button>

                    <div className="flex-shrink-0">
                      <PublishControl
                        isPublished={t.isPublished}
                        minimumTierLevel={t.minimumTierLevel}
                        publishedAt={t.publishedAt}
                        tiers={tiers}
                        hasTiers={hasTiers}
                        onTogglePublish={next => togglePublishType(t, next)}
                        onChangeTier={next => changeTierForType(t, next)}
                      />
                    </div>
                  </div>

                  {isExpanded && (
                    <div className="border-t border-gray-200 bg-gray-50 px-4 py-3 dark:border-gray-700 dark:bg-gray-900/40">
                      {!t.isPublished && list && list.some(r => r.isPublished) && (
                        <div className="mb-3 flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:border-amber-700/50 dark:bg-amber-900/20 dark:text-amber-200">
                          <svg className="mt-0.5 h-3.5 w-3.5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                          </svg>
                          <div className="flex-1">
                            <strong>{t.label} section isn't published to readers yet.</strong>{' '}
                            Published entries below won't be visible until you toggle the section on.
                          </div>
                          <button
                            type="button"
                            onClick={() => togglePublishType(t, true)}
                            disabled={busy === `type:${t.typeId}`}
                            className="flex-shrink-0 rounded border border-amber-300 bg-white px-2 py-0.5 text-[11px] font-medium text-amber-800 hover:bg-amber-100 disabled:opacity-60 dark:border-amber-700 dark:bg-gray-900 dark:text-amber-200 dark:hover:bg-amber-900/40"
                          >
                            Publish section
                          </button>
                        </div>
                      )}
                      {list === undefined ? (
                        <div className="py-4 text-center text-xs text-gray-500 dark:text-gray-400">
                          Loading entities…
                        </div>
                      ) : list.length === 0 ? (
                        <div className="py-4 text-center text-xs text-gray-500 dark:text-gray-400">
                          No {t.label.toLowerCase()} yet.
                        </div>
                      ) : (
                        <ul className="space-y-1">
                          {list.map((row, ridx) => (
                            <li
                              key={row.id}
                              className="flex items-center gap-3 rounded-md bg-white px-3 py-2 dark:bg-gray-800"
                            >
                              <ReorderButtons
                                onUp={() => moveEntity(t.typeId, row.id, -1)}
                                onDown={() => moveEntity(t.typeId, row.id, 1)}
                                disableUp={ridx === 0}
                                disableDown={ridx === list.length - 1}
                                busy={busy === `entity:${row.id}`}
                                small
                              />
                              <span className="min-w-0 flex-1 truncate text-sm text-gray-800 dark:text-gray-200">
                                {row.name}
                              </span>
                              <div className="flex-shrink-0">
                                <PublishControl
                                  isPublished={row.isPublished}
                                  minimumTierLevel={row.minimumTierLevel}
                                  publishedAt={row.publishedAt}
                                  tiers={tiers}
                                  hasTiers={hasTiers}
                                  onTogglePublish={next =>
                                    togglePublishEntity(t.typeId, row, next)
                                  }
                                  onChangeTier={next =>
                                    changeTierForEntity(t.typeId, row, next)
                                  }
                                  variants={row.variants}
                                  publishBase={row.publishBase}
                                  publishedVariantIds={row.publishedVariantIds}
                                  onChangeVariantSet={next =>
                                    changeVariantSetForEntity(t.typeId, row, next)
                                  }
                                  variantAccessLevels={row.variantAccessLevels}
                                  onChangeVariantTier={(which, level) =>
                                    changeVariantTierForEntity(t.typeId, row, which, level)
                                  }
                                  compact
                                />
                              </div>
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                  )}
                </li>
              )
            })}
          </ul>
        )}
      </div>
    </div>
  )
}

function ReorderButtons({
  onUp,
  onDown,
  disableUp,
  disableDown,
  busy,
  small = false,
}: {
  onUp: () => void
  onDown: () => void
  disableUp?: boolean
  disableDown?: boolean
  busy?: boolean
  small?: boolean
}) {
  const size = small ? 'h-5 w-5' : 'h-6 w-6'
  return (
    <div className="flex flex-col items-center gap-0.5">
      <button
        type="button"
        onClick={onUp}
        disabled={disableUp || busy}
        aria-label="Move up"
        className={`${size} flex items-center justify-center rounded text-gray-400 hover:bg-gray-100 hover:text-gray-700 disabled:opacity-30 disabled:hover:bg-transparent dark:text-gray-500 dark:hover:bg-gray-700 dark:hover:text-gray-300`}
      >
        <svg className="h-3 w-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 15l7-7 7 7" />
        </svg>
      </button>
      <button
        type="button"
        onClick={onDown}
        disabled={disableDown || busy}
        aria-label="Move down"
        className={`${size} flex items-center justify-center rounded text-gray-400 hover:bg-gray-100 hover:text-gray-700 disabled:opacity-30 disabled:hover:bg-transparent dark:text-gray-500 dark:hover:bg-gray-700 dark:hover:text-gray-300`}
      >
        <svg className="h-3 w-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>
    </div>
  )
}

function EmptyState({ title, description }: { title: string; description: string }) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-1 text-center">
      <p className="text-sm font-medium text-gray-700 dark:text-gray-300">{title}</p>
      <p className="max-w-sm text-xs text-gray-500 dark:text-gray-400">{description}</p>
    </div>
  )
}
