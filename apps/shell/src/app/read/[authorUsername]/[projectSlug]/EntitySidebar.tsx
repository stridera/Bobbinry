'use client'

/**
 * Right-docked panel that shows an entity's full detail view beside the
 * chapter text, so readers can keep reading with the reference open.
 * Same content as EntityModal, just docked instead of overlaid — no
 * backdrop, no scroll lock; the panel scrolls independently.
 */

import { useEffect } from 'react'
import EntityView from './EntityView'
import EntityHeaderActions from './EntityHeaderActions'
import type { PublishedEntity, PublishedType } from './entities-data'

interface EntitySidebarProps {
  type: PublishedType
  entity: PublishedEntity
  projectId: string
  apiToken?: string | undefined
  onClose: () => void
  /** Route to the entity's full subpage. Rendered as an "Open as page" link. */
  subpageHref: string
  /** Base for relation-pill links to sibling entities — `${base}/${id}`. */
  entityHrefBase?: string
}

export default function EntitySidebar({ type, entity, projectId, apiToken, onClose, subpageHref, entityHrefBase }: EntitySidebarProps) {
  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if (e.defaultPrevented) return
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', handleKey)
    return () => window.removeEventListener('keydown', handleKey)
  }, [onClose])

  return (
    <aside
      className="sticky top-8 hidden max-h-[calc(100vh-4rem)] w-96 flex-shrink-0 flex-col overflow-hidden border-l border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-900 lg:flex"
      role="complementary"
      aria-label={`${entity.name ?? type.label} details`}
    >
      <EntityView
        type={type}
        entity={entity}
        projectId={projectId}
        apiToken={apiToken}
        headerAction={<EntityHeaderActions subpageHref={subpageHref} onClose={onClose} />}
        entityHrefBase={entityHrefBase}
      />
    </aside>
  )
}
