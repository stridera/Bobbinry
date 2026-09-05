/**
 * Search & replace → editor bridge: scroll to a clicked match.
 *
 * The search panel dispatches `bobbinry:search-highlight` after navigating to a
 * chapter. The destination editor often hasn't mounted/loaded yet when the
 * event fires, so the request is stashed at module scope (it survives the view
 * remount) and applied once the matching chapter's content is in the editor.
 */
import type { Editor } from '@tiptap/react'
import { findMatchRanges, setSearchHighlight } from '../extensions/search-highlight'

export interface SearchHighlightRequest {
  entityId: string
  field: string
  index: number
  query: string
  caseSensitive: boolean
  wholeWord: boolean
}

// Kept until the active chapter navigates away or a grace window elapses, so a
// background content reconcile (a second applyContent after the server version
// check) re-applies the highlight rather than clobbering it.
let pendingSearchHighlight: SearchHighlightRequest | null = null
let pendingHighlightExpiry = 0
const HIGHLIGHT_GRACE_MS = 4000

export function getPendingSearchHighlight(): SearchHighlightRequest | null {
  return pendingSearchHighlight
}

export function isPendingHighlightExpired(now = Date.now()): boolean {
  return now > pendingHighlightExpiry
}

function setPendingHighlight(req: SearchHighlightRequest, now: number): void {
  pendingSearchHighlight = req
  pendingHighlightExpiry = now + HIGHLIGHT_GRACE_MS
}

export function clearPendingHighlight(): void {
  pendingSearchHighlight = null
  pendingHighlightExpiry = 0
}

// The listener lives at module scope (not in a component effect) so the stash
// is written even when NO editor is mounted — e.g. a match clicked from the
// outline view dispatches navigate + search-highlight before this view's
// dynamic import has even resolved. A mounted editor registers itself here to
// be poked when a request arrives while it's already showing the chapter.
let applyPendingHighlightHook: (() => void) | null = null

/** Register (or clear, with null) the mounted editor's apply callback. */
export function setApplyPendingHighlightHook(hook: (() => void) | null): void {
  applyPendingHighlightHook = hook
}

if (typeof window !== 'undefined') {
  window.addEventListener('bobbinry:search-highlight', (e: Event) => {
    const detail = (e as CustomEvent<SearchHighlightRequest>).detail
    if (!detail?.entityId || !detail.query) return
    setPendingHighlight(detail, Date.now())
    applyPendingHighlightHook?.()
  })
}

// Scroll the editor's `.overflow-y-auto` container so the given document
// position is visible (centered). The second pass catches the load-settle
// race where a re-render resets scrollTop right after the first scroll.
export function scrollEditorToPos(editor: Editor, from: number): void {
  const doScroll = () => {
    try {
      // Prefer the active-match decoration span: it wraps exactly the matched
      // text, so centering it is precise even inside paragraphs taller than
      // the scroll viewport (centering the whole <p> can leave the match
      // off-screen).
      const activeEl = editor.view.dom.querySelector('.search-match-active')
      if (activeEl) {
        activeEl.scrollIntoView({ behavior: 'smooth', block: 'center' })
        return
      }
      const domAtPos = editor.view.domAtPos(from)
      const node = domAtPos.node instanceof HTMLElement ? domAtPos.node : domAtPos.node.parentElement
      node?.scrollIntoView({ behavior: 'smooth', block: 'center' })
    } catch {
      const coords = editor.view.coordsAtPos(from)
      const scrollParent = editor.view.dom.closest('.overflow-y-auto')
      if (scrollParent) {
        const parentRect = scrollParent.getBoundingClientRect()
        scrollParent.scrollTo({
          top: scrollParent.scrollTop + (coords.top - parentRect.top) - parentRect.height / 3,
          behavior: 'smooth',
        })
      }
    }
  }
  requestAnimationFrame(doScroll)
  window.setTimeout(() => {
    if (editor.isDestroyed) return
    const scrollParent = editor.view.dom.closest('.overflow-y-auto')
    // Retry only if something yanked us back to the top after the first pass.
    if (scrollParent && scrollParent.scrollTop === 0) doScroll()
  }, 250)
}

// Select and scroll to the req.index-th occurrence of the query, and light up
// every occurrence via the SearchHighlight decorations. Occurrence numbering
// matches the server's match indices (see search-highlight.ts header).
export function runSearchHighlight(editor: Editor, req: SearchHighlightRequest): void {
  // Only the chapter body lives in this editor; other fields just open.
  if (req.field !== 'body') return
  const opts = { query: req.query, caseSensitive: req.caseSensitive, wholeWord: req.wholeWord }
  const ranges = findMatchRanges(editor.state.doc, opts)
  if (ranges.length === 0) return
  const activeIndex = Math.min(req.index, ranges.length - 1)
  setSearchHighlight(editor, { ...opts, activeIndex })
  const target = ranges[activeIndex]!
  // Explicit click on a match = intent to edit there, so place the caret too
  // (unlike Enter-cycling, which keeps focus in the search input).
  editor.commands.setTextSelection(target)
  editor.commands.focus()
  scrollEditorToPos(editor, target.from)
}
