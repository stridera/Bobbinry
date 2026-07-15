'use client'

/**
 * Reader's Entities tab: the author's published codex, grouped by type.
 *
 * Sticky sub-nav of type sections on the left, card grid on the right.
 * Clicking a card opens the EntityDetailDrawer. A compact "N locked"
 * nudge above the list points gated readers at the Support section.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { htmlToPlainText } from '@bobbinry/sdk'
import { config } from '@/lib/config'
import EntityModal from './EntityModal'
import { CroppedImage } from '@/components/CroppedImage'
import { resolveCardDescription, resolveCardThumbnail } from './entities-data'
import type { EntitiesPayload, PublishedEntity, PublishedType } from './entities-data'
import { useEntityStack } from './useEntityStack'

const OVERVIEW_PREVIEW_LIMIT = 10

/** Card grid shared by overview and focused sections — portrait cards, 2–5 up. */
const CARD_GRID_CLASS = 'grid gap-4 grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 2xl:grid-cols-5'

/** Grid for sections with no artwork — wider, text-led compact cards. */
const COMPACT_GRID_CLASS = 'grid gap-3 sm:grid-cols-2 lg:grid-cols-3'

/**
 * The portrait image well is only earned when a section actually has art.
 * Sections where no entry has a thumbnail render as compact text cards
 * instead of rows of tall empty icon wells.
 */
function typeHasArt(type: PublishedType): boolean {
  return type.entities.some(e => resolveCardThumbnail(e) !== null)
}

interface EntitiesTabProps {
  projectId: string
  authorUsername: string
  projectSlug: string
  apiToken?: string | undefined
  initialPayload?: EntitiesPayload | null
  /** Type id when viewing a single section in focused mode; null = overview. */
  focusedSection: string | null
  /** Navigate to a focused section, or back to overview when null. */
  onGoToSection: (typeId: string | null) => void
  /** Jump to the Support tab. Pass a tier level to highlight that card. */
  onSubscribeNudge: (tierLevel?: number) => void
}

export default function EntitiesTab({
  projectId,
  authorUsername,
  projectSlug,
  apiToken,
  initialPayload,
  focusedSection,
  onGoToSection,
  onSubscribeNudge,
}: EntitiesTabProps) {
  const [payload, setPayload] = useState<EntitiesPayload | null>(initialPayload ?? null)
  const [loading, setLoading] = useState(!initialPayload)
  const [error, setError] = useState<string | null>(null)
  const sectionRefs = useRef<Record<string, HTMLElement | null>>({})

  // Relation pills navigate in place: the codex payload already holds every
  // entity the reader can see, so lookups are local; misses (tier-locked)
  // fall back to a fetch inside the stack hook.
  const entityById = useMemo(() => {
    const map = new Map<string, { type: PublishedType; entity: PublishedEntity }>()
    for (const t of payload?.types ?? []) {
      for (const e of t.entities) map.set(e.id, { type: t, entity: e })
    }
    return map
  }, [payload])
  const resolveLocal = useCallback((id: string) => entityById.get(id) ?? null, [entityById])
  const stack = useEntityStack({ projectId, apiToken, resolveLocal })

  useEffect(() => {
    if (initialPayload) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- hydration bridge
      setPayload(initialPayload)
      setLoading(false)
      return
    }
    let cancelled = false
    setLoading(true)
    setError(null)
    const headers: Record<string, string> = {}
    if (apiToken) headers['Authorization'] = `Bearer ${apiToken}`
    fetch(`${config.apiUrl}/api/public/projects/${projectId}/entities`, { headers })
      .then(async r => {
        if (!r.ok) throw new Error(`Failed to load entities (${r.status})`)
        return r.json() as Promise<EntitiesPayload>
      })
      .then(data => {
        if (!cancelled) setPayload(data)
      })
      .catch(err => {
        if (!cancelled) setError(err?.message ?? 'Failed to load entities')
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => { cancelled = true }
  }, [projectId, apiToken, initialPayload])

  const scrollToSection = useCallback((typeId: string) => {
    const el = sectionRefs.current[typeId]
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }, [])

  if (loading) {
    return (
      <div className="py-16 text-center text-sm text-gray-500 dark:text-gray-400">
        Loading codex…
      </div>
    )
  }

  if (error) {
    return (
      <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700 dark:border-red-800 dark:bg-red-900/20 dark:text-red-300">
        {error}
      </div>
    )
  }

  if (!payload || payload.types.length === 0) {
    return (
      <div className="py-16 text-center">
        <p className="text-sm text-gray-500 dark:text-gray-400">
          This project hasn't published any entities yet.
        </p>
        {payload && (payload.lockedPreviews.types > 0 || payload.lockedPreviews.entities > 0) && (
          <LockedNudge
            locked={payload.lockedPreviews}
            minLockedTier={findMinLockedTier(payload)}
            onClick={onSubscribeNudge}
          />
        )}
      </div>
    )
  }

  const totalEntities = payload.types.reduce((acc, t) => acc + t.entities.length, 0)
  const focused = focusedSection
    ? payload.types.find(t => t.typeId === focusedSection) ?? null
    : null

  return (
    <div className="grid gap-8 lg:grid-cols-[230px_minmax(0,1fr)]">
      {/* Sub-nav — same shell for both modes; active item is highlighted in focused mode. */}
      <aside className="lg:sticky lg:top-4 lg:self-start">
        <div className="rounded-lg border border-gray-200 bg-white p-3 dark:border-gray-700 dark:bg-gray-900/40">
          <div className="mb-2 flex items-center justify-between text-xs font-medium uppercase tracking-wide text-gray-500 dark:text-gray-400">
            <span>Codex</span>
            <span className="font-mono text-[10px]">{totalEntities}</span>
          </div>
          <ul className="space-y-0.5">
            {focused && (
              <li>
                <button
                  type="button"
                  onClick={() => onGoToSection(null)}
                  className="flex w-full items-center gap-2 rounded-md px-2 py-1 text-left text-xs text-gray-500 transition-colors hover:bg-gray-100 hover:text-gray-800 dark:text-gray-400 dark:hover:bg-gray-800 dark:hover:text-gray-200"
                >
                  <svg className="h-3 w-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                  </svg>
                  <span>All sections</span>
                </button>
              </li>
            )}
            {payload.types.map(t => {
              const active = focused?.typeId === t.typeId
              return (
                <li key={t.typeId}>
                  <button
                    type="button"
                    onClick={() => (focused ? onGoToSection(t.typeId) : scrollToSection(t.typeId))}
                    className={`flex w-full items-center gap-2 rounded-md px-2 py-1 text-left text-sm transition-colors ${
                      active
                        ? 'bg-blue-50 font-medium text-blue-700 dark:bg-blue-900/30 dark:text-blue-300'
                        : 'text-gray-700 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-800'
                    }`}
                  >
                    <span className="text-base">{t.icon}</span>
                    <span className="flex-1 truncate">{t.label}</span>
                    <span className="text-[10px] tabular-nums text-gray-400 dark:text-gray-500">
                      {t.entities.length}
                    </span>
                  </button>
                </li>
              )
            })}
          </ul>
        </div>
      </aside>

      {focused ? (
        <FocusedSection
          type={focused}
          onBack={() => onGoToSection(null)}
          onOpen={e => stack.open(focused, e)}
          onSubscribeNudge={onSubscribeNudge}
        />
      ) : (
        <Overview
          payload={payload}
          sectionRefs={sectionRefs}
          onOpen={(type, entity) => stack.open(type, entity)}
          onViewAll={typeId => onGoToSection(typeId)}
          onSubscribeNudge={onSubscribeNudge}
        />
      )}

      {stack.current && (
        <EntityModal
          entry={stack.current}
          projectId={projectId}
          apiToken={apiToken}
          entityHrefBase={`/read/${authorUsername}/${projectSlug}/entity`}
          onNavigateEntity={id => { void stack.navigate(id) }}
          onBack={stack.canGoBack ? stack.back : undefined}
          onSubscribeNudge={onSubscribeNudge}
          onClose={stack.close}
        />
      )}
    </div>
  )
}

function Overview({
  payload,
  sectionRefs,
  onOpen,
  onViewAll,
  onSubscribeNudge,
}: {
  payload: EntitiesPayload
  sectionRefs: React.MutableRefObject<Record<string, HTMLElement | null>>
  onOpen: (type: PublishedType, entity: PublishedEntity) => void
  onViewAll: (typeId: string) => void
  onSubscribeNudge: (tierLevel?: number) => void
}) {
  return (
    <div className="min-w-0 space-y-10">
      {(payload.lockedPreviews.types > 0 || payload.lockedPreviews.entities > 0) && (
        <LockedNudge
          locked={payload.lockedPreviews}
          minLockedTier={findMinLockedTier(payload)}
          onClick={onSubscribeNudge}
        />
      )}

      {payload.types.map(t => {
        const overflow = Math.max(0, t.entities.length - OVERVIEW_PREVIEW_LIMIT)
        const previewEntities = t.entities.slice(0, OVERVIEW_PREVIEW_LIMIT)
        const compact = !typeHasArt(t)
        return (
          <section
            key={t.typeId}
            id={`codex-${t.typeId}`}
            ref={el => { sectionRefs.current[t.typeId] = el }}
            className="scroll-mt-4"
          >
            <div className="mb-3 flex items-end justify-between gap-3 border-b border-gray-200 pb-2 dark:border-gray-800">
              <div className="flex items-center gap-3">
                <span className="text-2xl">{t.icon}</span>
                <h3 className="font-display text-lg font-semibold text-gray-900 dark:text-gray-100">
                  {t.label}
                </h3>
                <span className="text-xs text-gray-500 dark:text-gray-400">
                  {t.entities.length} {t.entities.length === 1 ? 'entry' : 'entries'}
                </span>
              </div>
              {t.minimumTierLevel > 0 && <TierBadge level={t.minimumTierLevel} />}
            </div>

            {t.entities.length === 0 && !hasLocked(t) ? (
              <p className="text-sm text-gray-500 dark:text-gray-400 italic">
                Nothing published in this section yet.
              </p>
            ) : (
              <>
                <div className={compact ? COMPACT_GRID_CLASS : CARD_GRID_CLASS}>
                  {previewEntities.map(e => (
                    <EntityCard key={e.id} type={t} entity={e} compact={compact} onOpen={() => onOpen(t, e)} />
                  ))}
                  {Object.entries(t.lockedByTier ?? {})
                    .map(([k, v]) => [Number(k), v] as const)
                    .sort(([a], [b]) => a - b)
                    .flatMap(([tier, count]) =>
                      Array.from({ length: count }, (_, i) => (
                        <LockedTeaserCard
                          key={`locked-${t.typeId}-${tier}-${i}`}
                          typeIcon={t.icon}
                          typeLabel={t.label}
                          tierLevel={tier}
                          compact={compact}
                          onClick={onSubscribeNudge}
                        />
                      ))
                    )}
                </div>
                {overflow > 0 && (
                  <div className="mt-3 flex justify-end">
                    <button
                      type="button"
                      onClick={() => onViewAll(t.typeId)}
                      className="group inline-flex items-center gap-1.5 text-sm text-blue-600 hover:text-blue-700 dark:text-blue-400 dark:hover:text-blue-300"
                    >
                      View all {t.entities.length} {t.label.toLowerCase()}
                      <svg
                        className="h-3.5 w-3.5 transition-transform group-hover:translate-x-0.5"
                        fill="none"
                        stroke="currentColor"
                        viewBox="0 0 24 24"
                      >
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                      </svg>
                    </button>
                  </div>
                )}
              </>
            )}
          </section>
        )
      })}
    </div>
  )
}

function FocusedSection({
  type,
  onBack,
  onOpen,
  onSubscribeNudge,
}: {
  type: PublishedType
  onBack: () => void
  onOpen: (entity: PublishedEntity) => void
  onSubscribeNudge: (tierLevel?: number) => void
}) {
  const [query, setQuery] = useState('')
  const normalized = query.trim().toLowerCase()
  const compact = useMemo(() => !typeHasArt(type), [type])
  const filtered = useMemo(() => {
    if (!normalized) return type.entities
    return type.entities.filter(e => {
      const haystack = [
        e.name ?? '',
        htmlToPlainText(resolveCardDescription(e)),
        ...(Array.isArray(e.tags) ? e.tags : []),
      ]
        .join(' ')
        .toLowerCase()
      return haystack.includes(normalized)
    })
  }, [type.entities, normalized])

  return (
    <div className="min-w-0 space-y-4">
      <button
        type="button"
        onClick={onBack}
        className="group inline-flex items-center gap-1 text-xs text-gray-500 hover:text-gray-900 dark:text-gray-400 dark:hover:text-gray-100"
      >
        <svg
          className="h-3 w-3 transition-transform group-hover:-translate-x-0.5"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
        </svg>
        Back to codex
      </button>

      <div className="flex items-end justify-between gap-3 border-b border-gray-200 pb-3 dark:border-gray-800">
        <div className="flex items-center gap-3">
          <span className="text-3xl">{type.icon}</span>
          <div>
            <h2 className="font-display text-2xl font-semibold text-gray-900 dark:text-gray-100">
              {type.label}
            </h2>
            <p className="text-xs text-gray-500 dark:text-gray-400">
              {type.entities.length} {type.entities.length === 1 ? 'entry' : 'entries'}
              {filtered.length !== type.entities.length && ` · showing ${filtered.length}`}
            </p>
          </div>
        </div>
        {type.minimumTierLevel > 0 && <TierBadge level={type.minimumTierLevel} />}
      </div>

      <div className="relative">
        <svg
          className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400 dark:text-gray-500"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
        </svg>
        <input
          type="search"
          value={query}
          onChange={e => setQuery(e.target.value)}
          placeholder={`Search ${type.label.toLowerCase()}…`}
          className="w-full rounded-lg border border-gray-200 bg-white py-2 pl-9 pr-3 text-sm text-gray-900 placeholder:text-gray-400 focus:border-blue-400 focus:outline-none focus:ring-2 focus:ring-blue-100 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100 dark:placeholder:text-gray-500 dark:focus:border-blue-500 dark:focus:ring-blue-900/30"
          autoFocus
        />
      </div>

      {filtered.length === 0 && type.entities.length > 0 ? (
        <p className="py-10 text-center text-sm text-gray-500 dark:text-gray-400">
          No {type.label.toLowerCase()} match “{query}”.
        </p>
      ) : type.entities.length === 0 && !hasLocked(type) ? (
        <p className="py-10 text-center text-sm text-gray-500 dark:text-gray-400 italic">
          Nothing published in this section yet.
        </p>
      ) : (
        <div className={compact ? COMPACT_GRID_CLASS : CARD_GRID_CLASS}>
          {filtered.map(e => (
            <EntityCard key={e.id} type={type} entity={e} compact={compact} onOpen={() => onOpen(e)} />
          ))}
          {!normalized &&
            Object.entries(type.lockedByTier ?? {})
              .map(([k, v]) => [Number(k), v] as const)
              .sort(([a], [b]) => a - b)
              .flatMap(([tier, count]) =>
                Array.from({ length: count }, (_, i) => (
                  <LockedTeaserCard
                    key={`locked-focused-${type.typeId}-${tier}-${i}`}
                    typeIcon={type.icon}
                    typeLabel={type.label}
                    tierLevel={tier}
                    compact={compact}
                    onClick={onSubscribeNudge}
                  />
                ))
              )}
        </div>
      )}
    </div>
  )
}

function EntityCard({
  type,
  entity,
  compact = false,
  onOpen,
}: {
  type: PublishedType
  entity: PublishedEntity
  /** Text-led card for sections with no artwork — no image well. */
  compact?: boolean
  onOpen: () => void
}) {
  // Prefer the first published variant's name override when base isn't shown
  // so card titles match what the reader will see in the drawer.
  const displayName = useMemo(() => {
    if (entity.publishBase) return entity.name
    const firstVariantId = entity.publishedVariantIds[0]
    if (!firstVariantId) return entity.name
    const override = entity.entityData._variants?.items?.[firstVariantId]?.overrides?.name
    return typeof override === 'string' ? override : entity.name
  }, [entity])

  // Descriptions are stored as rich-text HTML; strip tags for the card preview
  // so `<p></p>` markers don't leak into the line-clamped text.
  const description = htmlToPlainText(resolveCardDescription(entity)) || null

  const thumbnail = resolveCardThumbnail(entity)

  if (compact) {
    return (
      <button
        type="button"
        onClick={onOpen}
        className="group relative flex items-start gap-3 rounded-lg border border-gray-200 bg-white p-3 text-left transition-all hover:border-blue-300 hover:shadow-md dark:border-gray-700 dark:bg-gray-800 dark:hover:border-blue-600"
      >
        <span
          aria-hidden
          className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-md bg-gray-100 text-lg dark:bg-gray-900"
        >
          {type.icon}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-start gap-2">
            <div className="min-w-0 flex-1 truncate font-medium text-gray-900 group-hover:text-blue-600 dark:text-gray-100 dark:group-hover:text-blue-400">
              {displayName ?? 'Untitled'}
            </div>
            {entity.minimumTierLevel > 0 && <TierBadge level={entity.minimumTierLevel} compact />}
          </div>
          {description && (
            <p className="mt-1 line-clamp-3 text-xs text-gray-500 dark:text-gray-400">
              {description}
            </p>
          )}
          {entity.tags.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-1">
              {entity.tags.slice(0, 2).map(tag => (
                <span
                  key={tag}
                  className="rounded-full bg-gray-100 px-2 py-0.5 text-[10px] text-gray-600 dark:bg-gray-700 dark:text-gray-300"
                >
                  {tag}
                </span>
              ))}
            </div>
          )}
        </div>
      </button>
    )
  }

  return (
    <button
      type="button"
      onClick={onOpen}
      className="group relative flex flex-col overflow-hidden rounded-lg border border-gray-200 bg-white text-left transition-all hover:border-blue-300 hover:shadow-md dark:border-gray-700 dark:bg-gray-800 dark:hover:border-blue-600"
    >
      {thumbnail ? (
        <div className="w-full overflow-hidden transition-transform group-hover:scale-[1.02]">
          <CroppedImage
            src={thumbnail.url}
            crop={thumbnail.crop}
            variant="thumb"
            alt={thumbnail.alt}
            className="aspect-[3/4] w-full bg-gray-100 dark:bg-gray-900"
          />
        </div>
      ) : (
        // Icon well matches the image aspect so rows of mixed cards align.
        <div className="flex aspect-[3/4] w-full items-center justify-center bg-gray-100 text-4xl opacity-60 dark:bg-gray-900">
          {type.icon}
        </div>
      )}
      <div className="flex-1 p-2.5">
        <div className="flex items-start gap-2">
          <div className="min-w-0 flex-1">
            <div className="truncate font-medium text-gray-900 group-hover:text-blue-600 dark:text-gray-100 dark:group-hover:text-blue-400">
              {displayName ?? 'Untitled'}
            </div>
            {description && (
              <p className="mt-1 line-clamp-2 text-xs text-gray-500 dark:text-gray-400">
                {description}
              </p>
            )}
          </div>
          {entity.minimumTierLevel > 0 && <TierBadge level={entity.minimumTierLevel} compact />}
        </div>
        {entity.tags.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-1">
            {entity.tags.slice(0, 2).map(tag => (
              <span
                key={tag}
                className="rounded-full bg-gray-100 px-2 py-0.5 text-[10px] text-gray-600 dark:bg-gray-700 dark:text-gray-300"
              >
                {tag}
              </span>
            ))}
          </div>
        )}
      </div>
    </button>
  )
}

function hasLocked(t: PublishedType): boolean {
  if (!t.lockedByTier) return false
  return Object.values(t.lockedByTier).some(n => n > 0)
}

function LockedTeaserCard({
  typeIcon,
  typeLabel,
  tierLevel,
  compact = false,
  onClick,
}: {
  typeIcon: string
  typeLabel: string
  tierLevel: number
  /** Match the short text-led cards of art-less sections. */
  compact?: boolean
  onClick: (tierLevel: number) => void
}) {
  return (
    <button
      type="button"
      onClick={() => onClick(tierLevel)}
      className={`group flex flex-col items-center justify-center gap-1.5 rounded-lg border border-dashed border-purple-300 bg-gradient-to-br from-purple-50 to-purple-100/50 p-4 text-center transition-all hover:border-purple-400 hover:from-purple-100 dark:border-purple-700 dark:from-purple-950/30 dark:to-purple-900/20 dark:hover:border-purple-600 ${
        compact ? 'min-h-[5.5rem]' : 'aspect-[3/4]'
      }`}
      title={`Locked ${typeLabel.toLowerCase().replace(/s$/, '')} — subscribe at Tier ${tierLevel}+ to unlock`}
      aria-label={`Locked — subscribe at Tier ${tierLevel} or higher to reveal`}
    >
      <span className="text-2xl opacity-50">{typeIcon}</span>
      <div className="flex items-center gap-1 text-sm font-semibold text-purple-700 dark:text-purple-300">
        <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
        </svg>
        Tier {tierLevel}+
      </div>
      <div className="text-[11px] text-purple-600 dark:text-purple-400 group-hover:text-purple-700 dark:group-hover:text-purple-300">
        Subscribe to unlock
      </div>
    </button>
  )
}

function TierBadge({ level, compact = false }: { level: number; compact?: boolean }) {
  return (
    <span
      className={`inline-flex flex-shrink-0 items-center gap-1 rounded-full bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-300 ${
        compact ? 'px-1.5 py-0.5 text-[10px]' : 'px-2 py-0.5 text-[11px]'
      }`}
      title={`Requires a tier ${level} subscription or higher`}
    >
      <svg className="h-2.5 w-2.5" fill="currentColor" viewBox="0 0 24 24">
        <path d="M12 2L15 8.5L22 9.3L17 14.2L18.2 21L12 17.8L5.8 21L7 14.2L2 9.3L9 8.5L12 2Z" />
      </svg>
      T{level}
    </span>
  )
}

/** Find the lowest tier level that gates any currently-hidden content. */
function findMinLockedTier(payload: EntitiesPayload): number | null {
  let min: number | null = null
  for (const t of payload.types) {
    for (const [tier] of Object.entries(t.lockedByTier ?? {})) {
      const n = Number(tier)
      if (!Number.isFinite(n)) continue
      if (min === null || n < min) min = n
    }
  }
  return min
}

function LockedNudge({
  locked,
  minLockedTier,
  onClick,
}: {
  locked: { types: number; entities: number; variants?: number }
  minLockedTier: number | null
  onClick: (tierLevel?: number) => void
}) {
  const bits: string[] = []
  if (locked.entities > 0) bits.push(`${locked.entities} ${locked.entities === 1 ? 'entry' : 'entries'}`)
  if (locked.types > 0) bits.push(`${locked.types} ${locked.types === 1 ? 'section' : 'sections'}`)
  const label = bits.join(' and ')
  const tierSuffix = minLockedTier !== null ? ` at Tier ${minLockedTier}+` : ''
  return (
    <button
      type="button"
      onClick={() => onClick(minLockedTier ?? undefined)}
      className="flex w-full items-center gap-3 rounded-lg border border-purple-200 bg-purple-50 px-4 py-3 text-left text-sm text-purple-800 transition-colors hover:bg-purple-100 dark:border-purple-800 dark:bg-purple-900/20 dark:text-purple-200 dark:hover:bg-purple-900/30"
    >
      <svg className="h-5 w-5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
      </svg>
      <span className="flex-1">
        <strong>Subscribe{tierSuffix} to unlock {label}.</strong>
        <span className="ml-1 text-purple-700 dark:text-purple-300">See tier options →</span>
      </span>
    </button>
  )
}
