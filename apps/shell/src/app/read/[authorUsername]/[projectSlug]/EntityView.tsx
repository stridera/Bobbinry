'use client'

/**
 * Shared render for a single published entity — the header (icon + name +
 * type label), variant picker, and LayoutRenderer body. Used by both
 * EntityModal (overlay render from the Entities tab + chapter highlight)
 * and the /entity/<id> subpage.
 *
 * Kept dumb: the caller handles data fetching, selection state is internal.
 */

import { useMemo, useState } from 'react'
import { LayoutRenderer } from '@bobbinry/entities/components/LayoutRenderer'
import type { PublishedType, PublishedEntity } from './entities-data'
import { resolveEntityForVariant } from './entities-data'

interface EntityViewProps {
  type: PublishedType
  entity: PublishedEntity
  /** Render chromeless (no header or variant bar) — use when the enclosing page has its own header. */
  bare?: boolean
  /** Show a trailing header action slot (e.g. "Open as page" link). */
  headerAction?: React.ReactNode
}

export default function EntityView({ type, entity, bare = false, headerAction }: EntityViewProps) {
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

  const layout = type.editorLayout || type.listLayout
  const showVariantBar = visibleVariantIds.length > 1

  return (
    <div className="flex h-full min-h-0 flex-col">
      {!bare && (
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

      <div className="flex-1 overflow-y-auto px-5 py-5">
        <LayoutRenderer
          layout={layout as any}
          fields={type.customFields as any}
          entity={resolvedEntity}
          onFieldChange={() => {}}
          readonly
        />
      </div>
    </div>
  )
}
