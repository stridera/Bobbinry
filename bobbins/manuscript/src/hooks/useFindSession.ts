import { useCallback, useEffect, useRef, type MutableRefObject } from 'react'
import type { Editor } from '@tiptap/react'
import {
  findMatchRanges,
  getSearchHighlightStorage,
  setSearchHighlight,
  MAX_FIND_MATCHES,
  type FindOptions,
} from '../extensions/search-highlight'
import {
  clearPendingHighlight,
  getPendingSearchHighlight,
  isPendingHighlightExpired,
  runSearchHighlight,
  scrollEditorToPos,
  setApplyPendingHighlightHook,
} from '../lib/search-highlight-bridge'

interface UseFindSessionArgs {
  /** Always the current editor (null before TipTap mounts). */
  editorRef: MutableRefObject<Editor | null>
  /** The entity currently shown; find state is reported against it. */
  activeEntityRef: MutableRefObject<string | null>
}

const EMPTY_FIND: FindOptions = { query: '', caseSensitive: false, wholeWord: false }

/**
 * The editor's side of the shell's find / search-and-replace UI:
 *
 * - live find session (browser-style Ctrl+F) driven by `bobbinry:find-*` events
 * - scroll-to-match after a search-panel click (`bobbinry:search-highlight`,
 *   stashed at module scope by search-highlight-bridge)
 * - `bobbinry:editor-focus-text` and `bobbinry:editor-replace-text` from other
 *   bobbins (annotations, search & replace)
 *
 * Everything reads the editor through refs so window listeners never go stale.
 */
export function useFindSession({ editorRef, activeEntityRef }: UseFindSessionArgs) {
  // Mirrors the SearchHighlight extension storage; kept in a ref so handlers
  // and applyContent see the latest values without re-subscribing.
  const findOptsRef = useRef<FindOptions>({ ...EMPTY_FIND })

  /** Tell the search UI how many in-chapter matches exist and which is active. */
  const emitFindState = useCallback((ed: Editor) => {
    const storage = getSearchHighlightStorage(ed)
    const total = findOptsRef.current.query
      ? findMatchRanges(ed.state.doc, findOptsRef.current).length
      : 0
    window.dispatchEvent(new CustomEvent('bobbinry:find-state', {
      detail: {
        total,
        activeIndex: total === 0 ? -1 : storage.activeIndex,
        capped: total >= MAX_FIND_MATCHES,
        query: findOptsRef.current.query,
        entityId: activeEntityRef.current,
      },
    }))
  }, [activeEntityRef])

  /**
   * Apply a stashed search-highlight once the editor holds the matching
   * chapter. Called both when the event arrives and after content loads.
   */
  const tryApplySearchHighlight = useCallback(() => {
    const req = getPendingSearchHighlight()
    const ed = editorRef.current
    if (!req || !ed || req.entityId !== activeEntityRef.current) return
    if (isPendingHighlightExpired()) {
      clearPendingHighlight()
      return
    }
    // Don't clear on apply: a follow-up content reconcile would otherwise reset
    // the selection with nothing left to re-apply. The grace window bounds how
    // long we keep re-selecting.
    runSearchHighlight(ed, req)
    // Adopt the click's query as the live find session so Enter keeps cycling
    // from the landing spot and the top-bar counter updates.
    findOptsRef.current = { query: req.query, caseSensitive: req.caseSensitive, wholeWord: req.wholeWord }
    emitFindState(ed)
  }, [editorRef, activeEntityRef, emitFindState])

  /**
   * Run after a chapter's content is placed in the editor: apply any pending
   * search-highlight, and re-anchor a live find session to this chapter's
   * first match (no auto-scroll — the user navigated here deliberately).
   */
  const afterContentApplied = useCallback((ed: Editor) => {
    tryApplySearchHighlight()
    if (findOptsRef.current.query) {
      const ranges = findMatchRanges(ed.state.doc, findOptsRef.current)
      setSearchHighlight(ed, { ...findOptsRef.current, activeIndex: ranges.length > 0 ? 0 : -1 })
      emitFindState(ed)
    }
  }, [tryApplySearchHighlight, emitFindState])

  // Register with the module-scope stash so a request that arrives while this
  // chapter is already showing gets applied immediately.
  useEffect(() => {
    setApplyPendingHighlightHook(() => tryApplySearchHighlight())
    return () => setApplyPendingHighlightHook(null)
  }, [tryApplySearchHighlight])

  // --- Text focus: scroll editor to specific text when requested by any bobbin ---
  // Dispatchers send: { quote: string, paragraphIndex?: number }
  useEffect(() => {
    function handleFocus(e: Event) {
      const { quote, paragraphIndex } = (e as CustomEvent).detail
      const ed = editorRef.current
      if (!quote || !ed) return
      const doc = ed.state.doc
      let found = false

      doc.descendants((node, pos) => {
        if (found || !node.isText || !node.text) return
        const idx = node.text.indexOf(quote)
        if (idx !== -1) {
          const from = pos + idx
          const to = from + quote.length
          ed.commands.setTextSelection({ from, to })
          ed.commands.focus()

          requestAnimationFrame(() => {
            try {
              const domAtPos = ed.view.domAtPos(from)
              const targetNode = domAtPos.node instanceof HTMLElement
                ? domAtPos.node
                : domAtPos.node.parentElement
              if (targetNode) {
                targetNode.scrollIntoView({ behavior: 'smooth', block: 'center' })
              }
            } catch {
              const coords = ed.view.coordsAtPos(from)
              const scrollParent = ed.view.dom.closest('.overflow-y-auto')
              if (scrollParent) {
                const parentRect = scrollParent.getBoundingClientRect()
                scrollParent.scrollTo({
                  top: scrollParent.scrollTop + (coords.top - parentRect.top) - parentRect.height / 3,
                  behavior: 'smooth'
                })
              }
            }
          })

          found = true
        }
      })

      // If not found by exact match, try searching block by paragraph index
      if (!found && paragraphIndex != null) {
        let blockIdx = 0
        doc.descendants((node, pos) => {
          if (found) return
          if (node.isBlock && node.isTextblock) {
            if (blockIdx === paragraphIndex) {
              ed.chain().setTextSelection(pos + 1).scrollIntoView().run()
              found = true
            }
            blockIdx++
          }
        })
      }
    }

    window.addEventListener('bobbinry:editor-focus-text', handleFocus)
    return () => window.removeEventListener('bobbinry:editor-focus-text', handleFocus)
  }, [editorRef])

  // --- Live find session (browser-style Ctrl+F, driven by the shell) ---
  useEffect(() => {
    function handleFindUpdate(e: Event) {
      const detail = (e as CustomEvent<FindOptions>).detail
      const ed = editorRef.current
      if (!ed || !detail) return
      const query = (detail.query ?? '').trim()
      const opts: FindOptions = {
        query,
        caseSensitive: Boolean(detail.caseSensitive),
        wholeWord: Boolean(detail.wholeWord),
      }
      findOptsRef.current = opts
      if (!query) {
        setSearchHighlight(ed, { ...opts, activeIndex: -1 })
        emitFindState(ed)
        return
      }
      const ranges = findMatchRanges(ed.state.doc, opts)
      // Start from the match at/after the caret — where the user last was —
      // matching how browser find picks its first hit.
      const caret = ed.state.selection.from
      let activeIndex = ranges.findIndex(r => r.from >= caret)
      if (activeIndex === -1) activeIndex = ranges.length > 0 ? 0 : -1
      setSearchHighlight(ed, { ...opts, activeIndex })
      if (activeIndex >= 0) scrollEditorToPos(ed, ranges[activeIndex]!.from)
      emitFindState(ed)
    }

    function handleFindStep(e: Event) {
      const { dir } = (e as CustomEvent<{ dir: 1 | -1 }>).detail ?? {}
      const ed = editorRef.current
      if (!ed || (dir !== 1 && dir !== -1)) return
      const opts = findOptsRef.current
      if (!opts.query) return
      const ranges = findMatchRanges(ed.state.doc, opts)
      if (ranges.length === 0) {
        emitFindState(ed)
        return
      }
      const storage = getSearchHighlightStorage(ed)
      const activeIndex = (storage.activeIndex + dir + ranges.length) % ranges.length
      setSearchHighlight(ed, { activeIndex })
      scrollEditorToPos(ed, ranges[activeIndex]!.from)
      emitFindState(ed)
    }

    function handleFindClear() {
      const ed = editorRef.current
      findOptsRef.current = { ...EMPTY_FIND }
      if (!ed) return
      setSearchHighlight(ed, { query: '', activeIndex: -1 })
      emitFindState(ed)
    }

    // Esc from the search bar: end the find session and hand the caret to the
    // editor at the active match (selected, ready to type over) — the "I
    // found it, let me edit" gesture. Without a session, just give the
    // manuscript its focus back.
    function handleFindCommit() {
      const ed = editorRef.current
      if (!ed) return
      const opts = findOptsRef.current
      if (opts.query) {
        const ranges = findMatchRanges(ed.state.doc, opts)
        const storage = getSearchHighlightStorage(ed)
        const target = storage.activeIndex >= 0 ? ranges[Math.min(storage.activeIndex, ranges.length - 1)] : undefined
        if (target) ed.commands.setTextSelection(target)
      }
      findOptsRef.current = { ...EMPTY_FIND }
      setSearchHighlight(ed, { query: '', activeIndex: -1 })
      ed.commands.focus()
      emitFindState(ed)
    }

    window.addEventListener('bobbinry:find-update', handleFindUpdate)
    window.addEventListener('bobbinry:find-step', handleFindStep)
    window.addEventListener('bobbinry:find-clear', handleFindClear)
    window.addEventListener('bobbinry:find-commit', handleFindCommit)
    return () => {
      window.removeEventListener('bobbinry:find-update', handleFindUpdate)
      window.removeEventListener('bobbinry:find-step', handleFindStep)
      window.removeEventListener('bobbinry:find-clear', handleFindClear)
      window.removeEventListener('bobbinry:find-commit', handleFindCommit)
    }
  }, [editorRef, emitFindState])

  // --- Text replace: find and replace text in the live editor document ---
  useEffect(() => {
    function handleReplace(e: Event) {
      const { find, replace } = (e as CustomEvent).detail
      const ed = editorRef.current
      if (!find || !replace || !ed) return

      const doc = ed.state.doc
      let replaced = false
      doc.descendants((node, pos) => {
        if (replaced || !node.isText || !node.text) return
        const idx = node.text.indexOf(find)
        if (idx !== -1) {
          const from = pos + idx
          const to = from + find.length
          ed.chain().setTextSelection({ from, to }).insertContent(replace).run()
          replaced = true
        }
      })
    }

    window.addEventListener('bobbinry:editor-replace-text', handleReplace)
    return () => window.removeEventListener('bobbinry:editor-replace-text', handleReplace)
  }, [editorRef])

  return { findOptsRef, emitFindState, afterContentApplied }
}
