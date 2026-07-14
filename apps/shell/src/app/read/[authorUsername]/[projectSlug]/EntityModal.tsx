'use client'

/**
 * Centered modal that shows an entity's full detail view. Same content as
 * the /entity/<id> subpage, just framed as a dialog for in-context browsing.
 * The backdrop closes it; there's no page blur since the codex grid behind
 * doesn't compete with the modal for attention.
 */

import { useEffect } from 'react'
import { createPortal } from 'react-dom'
import EntityView from './EntityView'
import EntityHeaderActions from './EntityHeaderActions'
import type { PublishedEntity, PublishedType } from './entities-data'

interface EntityModalProps {
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

export default function EntityModal({ type, entity, projectId, apiToken, onClose, subpageHref, entityHrefBase }: EntityModalProps) {
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

  const headerAction = <EntityHeaderActions subpageHref={subpageHref} onClose={onClose} />

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto p-4 sm:p-8"
      role="dialog"
      aria-label={`${entity.name ?? type.label} details`}
    >
      {/* Backdrop — dimmed but not blurred so the codex stays visible behind. */}
      <div
        className="fixed inset-0 bg-black/40"
        onClick={onClose}
        aria-hidden
      />

      <div className="relative my-auto flex max-h-[calc(100vh-3rem)] w-full max-w-3xl flex-col overflow-hidden rounded-xl border border-gray-200 bg-white shadow-2xl dark:border-gray-700 dark:bg-gray-900">
        <EntityView
          type={type}
          entity={entity}
          projectId={projectId}
          apiToken={apiToken}
          headerAction={headerAction}
          entityHrefBase={entityHrefBase}
        />
      </div>
    </div>,
    document.body
  )
}
