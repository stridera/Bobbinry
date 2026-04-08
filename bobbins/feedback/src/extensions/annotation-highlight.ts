/**
 * Annotation Highlight Extension for TipTap
 *
 * Uses ProseMirror Decorations (not Marks) to overlay colored highlights
 * on text passages that have reader annotations. Decorations are ephemeral —
 * they don't modify the stored HTML.
 *
 * Click handling dispatches a `bobbinry:annotation-preview` custom event
 * so the feedback right panel can scroll to that annotation.
 */

import { Extension } from '@tiptap/core'
import { Plugin, PluginKey } from '@tiptap/pm/state'
import { Decoration, DecorationSet } from '@tiptap/pm/view'
import type { Node as ProseMirrorNode } from '@tiptap/pm/model'

export interface AnnotationEntry {
  id: string
  anchorParagraphIndex: number | null
  anchorQuote: string
  anchorCharOffset: number | null
  annotationType: string // error, suggestion, feedback
  status: string
}

const annotationHighlightPluginKey = new PluginKey('annotationHighlight')

const TYPE_CLASSES: Record<string, string> = {
  error: 'annotation-highlight annotation-highlight--error',
  suggestion: 'annotation-highlight annotation-highlight--suggestion',
  feedback: 'annotation-highlight annotation-highlight--feedback'
}

function buildDecorations(doc: ProseMirrorNode, annotations: AnnotationEntry[]): DecorationSet {
  if (annotations.length === 0) return DecorationSet.empty

  // Only show open/acknowledged annotations
  const active = annotations.filter(a => a.status === 'open' || a.status === 'acknowledged')
  if (active.length === 0) return DecorationSet.empty

  const decorations: Decoration[] = []

  // Build a map of block positions (paragraph index → { from, to, node })
  const blocks: { from: number; to: number; node: ProseMirrorNode }[] = []
  doc.descendants((node, pos) => {
    if (node.isBlock && node.isTextblock) {
      blocks.push({ from: pos, to: pos + node.nodeSize, node })
    }
  })

  for (const ann of active) {
    if (ann.anchorParagraphIndex == null) continue
    const block = blocks[ann.anchorParagraphIndex]
    if (!block) continue

    // Search for the quote text within this block
    const blockText = block.node.textContent
    const searchStart = ann.anchorCharOffset ?? 0
    const quoteIndex = blockText.indexOf(ann.anchorQuote, searchStart)

    if (quoteIndex === -1) {
      // Fallback: search from beginning
      const fallbackIndex = blockText.indexOf(ann.anchorQuote)
      if (fallbackIndex === -1) {
        // Quote not found — add a stale indicator at the block level
        decorations.push(
          Decoration.node(block.from, block.to, {
            class: 'annotation-highlight--stale',
            'data-annotation-id': ann.id,
          })
        )
        continue
      }
      // Found with fallback
      const from = block.from + 1 + fallbackIndex // +1 for the block node opening
      const to = from + ann.anchorQuote.length
      decorations.push(
        Decoration.inline(from, to, {
          class: TYPE_CLASSES[ann.annotationType] || 'annotation-highlight',
          'data-annotation-id': ann.id,
          'data-annotation-type': ann.annotationType,
        })
      )
      continue
    }

    const from = block.from + 1 + quoteIndex // +1 for the block node opening
    const to = from + ann.anchorQuote.length
    decorations.push(
      Decoration.inline(from, to, {
        class: TYPE_CLASSES[ann.annotationType] || 'annotation-highlight',
        'data-annotation-id': ann.id,
        'data-annotation-type': ann.annotationType,
      })
    )
  }

  return DecorationSet.create(doc, decorations)
}

export const AnnotationHighlight = Extension.create({
  name: 'annotationHighlight',

  addStorage() {
    return {
      annotationList: [] as AnnotationEntry[],
    }
  },

  addProseMirrorPlugins() {
    const extension = this

    return [
      new Plugin({
        key: annotationHighlightPluginKey,

        state: {
          init(_, { doc }) {
            return buildDecorations(doc, extension.storage.annotationList)
          },
          apply(tr, oldDecoSet) {
            if (tr.getMeta('annotationListUpdated') || tr.docChanged) {
              return buildDecorations(tr.doc, extension.storage.annotationList)
            }
            return oldDecoSet
          },
        },

        props: {
          decorations(state) {
            return annotationHighlightPluginKey.getState(state) as DecorationSet
          },

          handleClick(_view, _pos, event) {
            const target = event.target as HTMLElement
            if (!target.classList.contains('annotation-highlight')) return false

            const annotationId = target.dataset.annotationId
            const annotationType = target.dataset.annotationType
            if (!annotationId) return false

            window.dispatchEvent(
              new CustomEvent('bobbinry:annotation-preview', {
                detail: { annotationId, annotationType },
              })
            )
            return true
          },
        },
      }),
    ]
  },
})
