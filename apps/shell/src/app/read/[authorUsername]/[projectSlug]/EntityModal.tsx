'use client'

/**
 * Centered modal that shows an entity's full detail view. Same content as
 * the /entity/<id> subpage, just framed as a dialog for in-context browsing.
 * The backdrop closes it; there's no page blur since the codex grid behind
 * doesn't compete with the modal for attention.
 *
 * Relation-pill clicks inside the modal navigate in place (the caller's
 * onNavigateEntity pushes onto a stack; onBack pops) instead of doing a full
 * document navigation — cmd/middle-click still opens the entity's own page.
 */

import { useEffect } from 'react'
import { createPortal } from 'react-dom'
import EntityView from './EntityView'
import EntityHeaderActions from './EntityHeaderActions'
import EntityStackFallback from './EntityStackFallback'
import type { EntityStackEntry } from './useEntityStack'

interface EntityModalProps {
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

export default function EntityModal({ entry, projectId, apiToken, onClose, entityHrefBase, onNavigateEntity, onBack, onSubscribeNudge }: EntityModalProps) {
  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', handleKey)
    // Prevent body scroll while open
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      window.removeEventListener('keydown', handleKey)
      document.body.style.overflow = prev
    }
  }, [onClose])

  if (typeof document === 'undefined') return null

  const ariaLabel =
    entry.kind === 'entity'
      ? `${entry.entity.name ?? entry.type.label} details`
      : 'Entity details'

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto p-4 sm:p-8"
      role="dialog"
      aria-label={ariaLabel}
    >
      {/* Backdrop — dimmed but not blurred so the codex stays visible behind. */}
      <div
        className="fixed inset-0 bg-black/40"
        onClick={onClose}
        aria-hidden
      />

      <div className="relative my-auto flex max-h-[calc(100vh-3rem)] w-full max-w-5xl flex-col overflow-hidden rounded-xl border border-gray-200 bg-white shadow-2xl dark:border-gray-700 dark:bg-gray-900">
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
      </div>
    </div>,
    document.body
  )
}
