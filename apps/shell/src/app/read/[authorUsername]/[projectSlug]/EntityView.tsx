'use client'

/**
 * Shared render for a single published entity — the header (icon + name +
 * type label), variant picker, and LayoutRenderer body. Used by both
 * EntityModal (overlay render from the Entities tab + chapter highlight)
 * and the /entity/<id> subpage.
 *
 * Kept dumb: the caller handles the main entity fetch and passes in
 * projectId/apiToken so this view can resolve relation-field references
 * (class, race, etc.) against the public published-names table.
 */

import { useEffect, useMemo, useState } from 'react'
import { LayoutRenderer } from '@bobbinry/entities/components/LayoutRenderer'
import { ResolvedEntityNamesProvider, EntityNavProvider } from '@bobbinry/entities/components/UploadContext'
import { config } from '@/lib/config'
import type { PublishedType, PublishedEntity } from './entities-data'
import { resolveEntityForVariant } from './entities-data'

interface EntityViewProps {
  type: PublishedType
  entity: PublishedEntity
  /** Project containing this entity — used to look up published entity names for relation fields. */
  projectId: string
  /** Optional bearer token so tier-gated names resolve for subscribed viewers. */
  apiToken?: string | undefined
  /** Render chromeless (no header or variant bar) — use when the enclosing page has its own header. */
  bare?: boolean
  /** Show a trailing header action slot (e.g. "Open as page" link). */
  headerAction?: React.ReactNode
  /** Route base for linking to other entities from relation pills. E.g. `/read/elena/saga/entity` — id is appended. */
  entityHrefBase?: string | undefined
  /** When set, makes the entity header + variant bar stick at this Tailwind top-* class (e.g. `top-11` to sit below a 44px nav). */
  stickyHeaderTopClass?: string | undefined
}

export default function EntityView({ type, entity, projectId, apiToken, bare = false, headerAction, entityHrefBase, stickyHeaderTopClass }: EntityViewProps) {
  const visibleVariantIds = useMemo(() => {
    const ids: Array<string | null> = []
    if (entity.publishBase) ids.push(null)
    for (const id of entity.publishedVariantIds) ids.push(id)
    return ids
  }, [entity.publishBase, entity.publishedVariantIds])

  // Derive the initial variant selection from the first visible view each
  // time we switch entities, rather than syncing via setState-in-effect.
  const initialVariant = visibleVariantIds[0] ?? null
  const [selectedVariant, setSelectedVariant] = useState<string | null>(initialVariant)
  const [seenEntityId, setSeenEntityId] = useState(entity.id)
  if (seenEntityId !== entity.id) {
    setSelectedVariant(initialVariant)
    setSeenEntityId(entity.id)
  }

  const variantLabel = (id: string | null): string => {
    if (id === null) return 'Base'
    const item = entity.entityData._variants?.items?.[id]
    return item?.label ?? id
  }

  const versionableFieldSet = useMemo(() => {
    const names = new Set<string>()
    for (const f of type.customFields) if ((f as any).versionable) names.add(f.name)
    for (const name of type.versionableBaseFields ?? []) names.add(name)
    return names
  }, [type.customFields, type.versionableBaseFields])

  const resolvedEntity = useMemo(
    () => resolveEntityForVariant(entity.entityData, versionableFieldSet, selectedVariant),
    [entity.entityData, versionableFieldSet, selectedVariant]
  )

  // Fetch a flat id → display-name table so relation fields (class, race, etc.)
  // can resolve linked entities without an authenticated SDK context. The
  // endpoint returns one row per (entity, visible name/alias); we keep the
  // first row per id (base name) and skip subsequent alias rows.
  const [relationNames, setRelationNames] = useState<Map<string, string>>(new Map())
  useEffect(() => {
    if (!projectId) return
    let cancelled = false
    const headers: Record<string, string> = {}
    if (apiToken) headers['Authorization'] = `Bearer ${apiToken}`
    fetch(`${config.apiUrl}/api/public/projects/${projectId}/entities/published-names`, { headers })
      .then(r => (r.ok ? r.json() : null))
      .then((data: { entities?: Array<{ id: string; name: string }> } | null) => {
        if (cancelled || !data?.entities) return
        const map = new Map<string, string>()
        for (const row of data.entities) {
          if (!map.has(row.id)) map.set(row.id, row.name)
        }
        setRelationNames(map)
      })
      .catch(() => { /* relation pills fall back to "Locked" — acceptable */ })
    return () => { cancelled = true }
  }, [projectId, apiToken])

  const layout = type.editorLayout || type.listLayout
  const showVariantBar = visibleVariantIds.length > 1
  const showHeader = !bare
  const stickyWrapperClass = stickyHeaderTopClass
    ? `sticky ${stickyHeaderTopClass} z-20 bg-white/95 backdrop-blur-sm dark:bg-gray-900/95`
    : ''

  return (
    <div className="flex h-full min-h-0 flex-col">
      {(showHeader || showVariantBar) && (
        <div className={stickyWrapperClass}>
          {showHeader && (
            <div className="flex items-start justify-between gap-3 border-b border-gray-200 px-5 py-4 dark:border-gray-700">
              <div className="flex min-w-0 items-start gap-3">
                <span className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-lg bg-gray-100 text-xl dark:bg-gray-800">
                  {type.icon}
                </span>
                <div className="min-w-0">
                  <div className="text-xs uppercase tracking-wide text-gray-500 dark:text-gray-400">
                    {type.label}
                  </div>
                  <div className="truncate text-lg font-semibold text-gray-900 dark:text-gray-100">
                    {String(resolvedEntity.name ?? 'Untitled')}
                  </div>
                </div>
              </div>
              {headerAction && (
                <div className="flex-shrink-0">{headerAction}</div>
              )}
            </div>
          )}

          {showVariantBar && (
            <div className="flex items-center gap-2 border-b border-gray-200 px-5 py-2 text-xs dark:border-gray-700">
              <span className="text-gray-500 dark:text-gray-400">
                {type.variantAxis?.label ?? 'View'}:
              </span>
              <div className="flex flex-wrap gap-1">
                {visibleVariantIds.map(id => {
                  const active = id === selectedVariant
                  return (
                    <button
                      key={id ?? '__base__'}
                      type="button"
                      onClick={() => setSelectedVariant(id)}
                      className={`rounded-full px-2.5 py-1 text-xs font-medium transition-colors ${
                        active
                          ? 'bg-blue-600 text-white'
                          : 'bg-gray-100 text-gray-700 hover:bg-gray-200 dark:bg-gray-800 dark:text-gray-300 dark:hover:bg-gray-700'
                      }`}
                    >
                      {variantLabel(id)}
                    </button>
                  )
                })}
              </div>
            </div>
          )}
        </div>
      )}

      <div className="flex-1 overflow-y-auto px-5 py-5">
        <ResolvedEntityNamesProvider names={relationNames}>
          <EntityNavProvider
            getLinkProps={(_entityType, id) =>
              entityHrefBase ? { href: `${entityHrefBase}/${id}` } : null
            }
          >
            <LayoutRenderer
              layout={layout as any}
              fields={type.customFields as any}
              entity={resolvedEntity}
              onFieldChange={() => {}}
              readonly
            />
          </EntityNavProvider>
        </ResolvedEntityNamesProvider>
      </div>
    </div>
  )
}
