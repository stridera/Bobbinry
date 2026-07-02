/**
 * Search Highlight Extension for TipTap
 *
 * Browser-style find: overlays a decoration on every occurrence of the active
 * find query, with the "current" occurrence styled distinctly so Enter/Shift+
 * Enter cycling has a visible cursor. Decorations are ephemeral — they never
 * touch the stored HTML.
 *
 * Occurrence counting parity: `buildFindRegex` mirrors the API's
 * `buildSearchRegex` (apps/api/src/lib/search-replace.ts) and matching runs
 * per text node in document order, mirroring the server's per-HTML-text-node
 * scan — so occurrence N here is occurrence N in the server's match indices.
 * A side effect on both sides: matches straddling a text-node boundary
 * (e.g. `<em>lan</em>tern` for "lantern") are not counted.
 */

import { Extension } from '@tiptap/core'
import type { Editor } from '@tiptap/core'
import { Plugin, PluginKey } from '@tiptap/pm/state'
import { Decoration, DecorationSet } from '@tiptap/pm/view'
import type { Node as ProseMirrorNode } from '@tiptap/pm/model'

export interface FindOptions {
  query: string
  caseSensitive: boolean
  wholeWord: boolean
}

export interface SearchHighlightStorage extends FindOptions {
  /** 0-based occurrence index of the active match in document order; -1 = none. */
  activeIndex: number
}

export interface MatchRange {
  from: number
  to: number
}

/** Mirrors the server cap (MAX_MATCHES_PER_FIELD) so counts stay comparable. */
export const MAX_FIND_MATCHES = 500

const searchHighlightPluginKey = new PluginKey('searchHighlight')

/** Same escape set as the API's escapeRegExp — keep in sync. */
function escapeRegExp(s: string): string {
  return s.replace(/[\\^$.*+?()[\]{}|]/g, '\\$&')
}

/** Mirrors the API's buildSearchRegex; null when the query is empty. */
export function buildFindRegex(opts: FindOptions): RegExp | null {
  if (!opts.query) return null
  let source = escapeRegExp(opts.query)
  if (opts.wholeWord) source = `\\b${source}\\b`
  return new RegExp(source, opts.caseSensitive ? 'g' : 'gi')
}

/**
 * All occurrences of the query in document order, capped at MAX_FIND_MATCHES.
 * Matching is per text node, so occurrence numbering agrees with the server's
 * per-text-node HTML scan.
 */
export function findMatchRanges(doc: ProseMirrorNode, opts: FindOptions): MatchRange[] {
  const re = buildFindRegex(opts)
  if (!re) return []

  const ranges: MatchRange[] = []
  doc.descendants((node, pos) => {
    if (ranges.length >= MAX_FIND_MATCHES) return false
    if (!node.isText || !node.text) return true
    re.lastIndex = 0
    let m: RegExpExecArray | null
    while ((m = re.exec(node.text)) !== null && ranges.length < MAX_FIND_MATCHES) {
      ranges.push({ from: pos + m.index, to: pos + m.index + m[0].length })
      if (m[0].length === 0) re.lastIndex++
    }
    return true
  })
  return ranges
}

function buildDecorations(doc: ProseMirrorNode, storage: SearchHighlightStorage): DecorationSet {
  const ranges = findMatchRanges(doc, storage)
  if (ranges.length === 0) return DecorationSet.empty

  // Keep activeIndex valid across doc edits (rebuilds on docChanged).
  if (storage.activeIndex >= ranges.length) {
    storage.activeIndex = ranges.length - 1
  }

  const decorations = ranges.map((r, i) =>
    Decoration.inline(r.from, r.to, {
      class: i === storage.activeIndex ? 'search-match search-match-active' : 'search-match',
    })
  )
  return DecorationSet.create(doc, decorations)
}

/** Typed accessor for this extension's storage on an editor instance. */
export function getSearchHighlightStorage(editor: Editor): SearchHighlightStorage {
  return (editor.storage as Record<string, any>).searchHighlight as SearchHighlightStorage
}

/**
 * Merge new find state into storage and refresh decorations. The transaction
 * is a no-op for content (skips history) — it only carries the rebuild meta.
 */
export function setSearchHighlight(editor: Editor, partial: Partial<SearchHighlightStorage>): void {
  const storage = getSearchHighlightStorage(editor)
  Object.assign(storage, partial)
  const tr = editor.state.tr
  tr.setMeta('searchHighlightUpdated', true)
  tr.setMeta('addToHistory', false)
  editor.view.dispatch(tr)
}

export const SearchHighlight = Extension.create({
  name: 'searchHighlight',

  addStorage(): SearchHighlightStorage {
    return {
      query: '',
      caseSensitive: false,
      wholeWord: false,
      activeIndex: -1,
    }
  },

  addProseMirrorPlugins() {
    const extension = this

    return [
      new Plugin({
        key: searchHighlightPluginKey,

        state: {
          init(_, { doc }) {
            return buildDecorations(doc, extension.storage as SearchHighlightStorage)
          },
          apply(tr, oldDecoSet) {
            if (tr.getMeta('searchHighlightUpdated') || tr.docChanged) {
              return buildDecorations(tr.doc, extension.storage as SearchHighlightStorage)
            }
            return oldDecoSet
          },
        },

        props: {
          decorations(state) {
            return searchHighlightPluginKey.getState(state) as DecorationSet
          },
        },
      }),
    ]
  },
})
