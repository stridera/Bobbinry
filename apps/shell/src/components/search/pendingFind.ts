'use client'

/**
 * Cross-chapter click-to-match handoff.
 *
 * Clicking a search result dispatches `bobbinry:navigate` and then
 * `bobbinry:search-highlight`. When the target chapter's editor isn't mounted
 * yet (result clicked from the outline view, or the editor view's dynamic
 * import hasn't resolved), that highlight event can fire before anyone is
 * listening. So we also stash the request here and re-dispatch it when the
 * destination editor announces itself via `bobbinry:active-chapter` — which
 * it does only after mounting.
 */

export interface SearchHighlightDetail {
  entityId: string
  field: string
  index: number
  query: string
  caseSensitive: boolean
  wholeWord: boolean
}

const EXPIRY_MS = 5000

let pending: { detail: SearchHighlightDetail; expiry: number } | null = null

export function requestSearchHighlight(detail: SearchHighlightDetail): void {
  window.dispatchEvent(new CustomEvent('bobbinry:search-highlight', { detail }))
  pending = { detail, expiry: Date.now() + EXPIRY_MS }
}

if (typeof window !== 'undefined') {
  window.addEventListener('bobbinry:active-chapter', (e: Event) => {
    if (!pending) return
    if (Date.now() > pending.expiry) {
      pending = null
      return
    }
    const chapter = (e as CustomEvent<{ id?: string } | null>).detail
    if (chapter?.id !== pending.detail.entityId) return
    const detail = pending.detail
    pending = null
    window.dispatchEvent(new CustomEvent('bobbinry:search-highlight', { detail }))
  })
}
