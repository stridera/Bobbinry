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
import EntityStackFallback from './EntityStackFallback'
import type { EntityStackEntry } from './useEntityStack'

interface EntitySidebarProps {
  entry: EntityStackEntry
  projectId: string
  apiToken?: string | undefined
  onClose: () => void
  /** Base for relation-pill links and the "Open as page" link — `${base}/${slug ?? id}`. */
  entityHrefBase: string
  /** Navigate in place to another entity (pushes onto the caller's stack). */
  onNavigateEntity?: ((entityId: string) => void) | undefined
  /** Pop back to the previously viewed entity; undefined hides the back arrow. */
  onBack?: (() => void) | undefined
  /** Jump to the Support tab when a locked entry nudges the reader to subscribe. */
  onSubscribeNudge?: ((tierLevel?: number) => void) | undefined
}

export default function EntitySidebar({ entry, projectId, apiToken, onClose, entityHrefBase, onNavigateEntity, onBack, onSubscribeNudge }: EntitySidebarProps) {
  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if (e.defaultPrevented) return
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', handleKey)
    return () => window.removeEventListener('keydown', handleKey)
  }, [onClose])

  const ariaLabel =
    entry.kind === 'entity'
      ? `${entry.entity.name ?? entry.type.label} details`
      : 'Entity details'

  return (
    <aside
      className="sticky top-8 hidden max-h-[calc(100vh-4rem)] w-96 flex-shrink-0 flex-col overflow-hidden border-l border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-900 lg:flex xl:w-[27rem] 2xl:w-[30rem]"
      role="complementary"
      aria-label={ariaLabel}
    >
      {entry.kind === 'entity' ? (
        <EntityView
          type={entry.type}
          entity={entry.entity}
          projectId={projectId}
          apiToken={apiToken}
          headerAction={
            <EntityHeaderActions
              subpageHref={`${entityHrefBase}/${entry.entity.slug ?? entry.entity.id}`}
              onClose={onClose}
              onBack={onBack}
            />
          }
          entityHrefBase={entityHrefBase}
          onNavigateEntity={onNavigateEntity}
        />
      ) : (
        <EntityStackFallback
          entry={entry}
          onClose={onClose}
          onBack={onBack}
          onSubscribeNudge={onSubscribeNudge}
        />
      )}
    </aside>
  )
}
