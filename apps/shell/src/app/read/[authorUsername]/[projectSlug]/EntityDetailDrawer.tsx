'use client'

/**
 * Right-sliding drawer that renders a single published entity through the
 * entities bobbin's LayoutRenderer. Includes a variant picker when the
 * entity has more than one published variant (or Base + variant).
 */

import { useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { LayoutRenderer } from '@bobbinry/entities/components/LayoutRenderer'
import type { PublishedType, PublishedEntity } from './entities-data'
import { resolveEntityForVariant } from './entities-data'

interface EntityDetailDrawerProps {
  type: PublishedType
  entity: PublishedEntity
  onClose: () => void
}

export default function EntityDetailDrawer({ type, entity, onClose }: EntityDetailDrawerProps) {
  // Published visible views of this entity. `null` represents the base view.
  const visibleVariantIds = useMemo(() => {
    const ids: Array<string | null> = []
    if (entity.publishBase) ids.push(null)
    for (const id of entity.publishedVariantIds) ids.push(id)
    return ids
  }, [entity.publishBase, entity.publishedVariantIds])

  const [selectedVariant, setSelectedVariant] = useState<string | null>(() => visibleVariantIds[0] ?? null)

  useEffect(() => {
    setSelectedVariant(visibleVariantIds[0] ?? null)
  }, [entity.id, visibleVariantIds])

  // ESC to close
  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', handleKey)
    return () => window.removeEventListener('keydown', handleKey)
  }, [onClose])

  const variants = entity.entityData._variants
  const variantLabel = (id: string | null): string => {
    if (id === null) return 'Base'
    const item = variants?.items?.[id]
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

  if (typeof document === 'undefined') return null

  const layout = type.editorLayout || type.listLayout

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-stretch justify-end"
      role="dialog"
      aria-label={`${resolvedEntity.name ?? type.label} details`}
    >
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/40 backdrop-blur-[2px]"
        onClick={onClose}
      />

      {/* Panel */}
      <div className="relative flex h-full w-full max-w-xl flex-col border-l border-gray-200 bg-white shadow-2xl dark:border-gray-700 dark:bg-gray-900">
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
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="flex h-8 w-8 items-center justify-center rounded-md text-gray-500 hover:bg-gray-100 hover:text-gray-900 dark:text-gray-400 dark:hover:bg-gray-800 dark:hover:text-gray-100"
          >
            <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {visibleVariantIds.length > 1 && (
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
    </div>,
    document.body
  )
}
