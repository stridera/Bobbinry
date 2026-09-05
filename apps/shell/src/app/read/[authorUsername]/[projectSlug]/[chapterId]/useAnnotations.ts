import { useCallback, useEffect, useState, type RefObject } from 'react'
import type { TextAnchor } from '@/components/AnnotationSelectionPopover'
import { readerApi } from './reader-api'
import type { Annotation, ReaderTheme } from './types'

interface UseAnnotationsArgs {
  chapterId: string | null
  projectId: string | null
  apiToken: string | undefined
  /** The prose element; annotation marks are applied inside it. */
  proseRef: RefObject<HTMLDivElement | null>
  readerTheme: ReaderTheme
}

export interface AnnotationSubmission {
  anchor: TextAnchor
  annotationType: string
  errorCategory?: string
  content: string
  suggestedText?: string
}

/**
 * The reader's own annotations on this chapter: access check, list, create,
 * delete, and the DOM pass that wraps anchored quotes in <mark> elements.
 */
export function useAnnotations({ chapterId, projectId, apiToken, proseRef, readerTheme }: UseAnnotationsArgs) {
  const [annotations, setAnnotations] = useState<Annotation[]>([])
  const [canAnnotate, setCanAnnotate] = useState(false)
  const [pendingAnchor, setPendingAnchor] = useState<TextAnchor | null>(null)

  // Load annotation access separately — session loads async after chapter
  useEffect(() => {
    if (!apiToken || !projectId || !chapterId) return
    let cancelled = false
    readerApi.fetchCanAnnotate(projectId, apiToken)
      .then(async allowed => {
        if (cancelled || allowed === null) return
        setCanAnnotate(allowed)
        if (!allowed) return
        const list = await readerApi.fetchAnnotations(chapterId, apiToken)
        if (!cancelled && list) setAnnotations(list)
      })
      .catch(() => {})
    return () => { cancelled = true }
  }, [apiToken, projectId, chapterId])

  const submitAnnotation = useCallback(async (data: AnnotationSubmission) => {
    if (!apiToken || !projectId || !chapterId) return
    const ok = await readerApi.postAnnotation(chapterId, apiToken, { projectId, ...data })
    if (!ok) return
    setPendingAnchor(null)
    const list = await readerApi.fetchAnnotations(chapterId, apiToken)
    if (list) setAnnotations(list)
  }, [apiToken, projectId, chapterId])

  const deleteAnnotation = useCallback(async (annotationId: string) => {
    if (!apiToken || !chapterId) return
    await readerApi.deleteAnnotation(chapterId, apiToken, annotationId)
    setAnnotations(prev => prev.filter(a => a.id !== annotationId))
  }, [apiToken, chapterId])

  // Apply annotation highlights to rendered chapter content
  const applyHighlights = useCallback(() => {
    const proseEl = proseRef.current
    if (!proseEl || annotations.length === 0) return

    // Skip if already applied (check for existing marks)
    if (proseEl.querySelectorAll('mark[data-annotation-id]').length > 0) return

    // Theme-aware highlight colors (inline styles, not Tailwind dark: which doesn't match reader theme)
    const dark = readerTheme === 'dark'
    const highlightColors = {
      error: dark ? 'rgba(239,68,68,0.2)' : 'rgba(239,68,68,0.15)',
      suggestion: dark ? 'rgba(59,130,246,0.2)' : 'rgba(59,130,246,0.15)',
      feedback: dark ? 'rgba(234,179,8,0.2)' : 'rgba(234,179,8,0.15)'
    }

    const blocks = proseEl.querySelectorAll('p, h1, h2, h3, h4, h5, h6, blockquote, li, pre')
    for (const ann of annotations) {
      if (ann.anchorParagraphIndex == null) continue
      const block = blocks[ann.anchorParagraphIndex]
      if (!block) continue

      const walker = document.createTreeWalker(block, NodeFilter.SHOW_TEXT)
      let charCount = 0
      let node: Text | null
      while ((node = walker.nextNode() as Text | null)) {
        const nodeText = node.textContent || ''
        const quoteStart = nodeText.indexOf(ann.anchorQuote, Math.max(0, (ann.anchorCharOffset ?? 0) - charCount))

        if (quoteStart !== -1) {
          const range = document.createRange()
          range.setStart(node, quoteStart)
          range.setEnd(node, quoteStart + ann.anchorQuote.length)

          const mark = document.createElement('mark')
          mark.setAttribute('data-annotation-id', ann.id)
          mark.style.backgroundColor = highlightColors[ann.annotationType as keyof typeof highlightColors] || highlightColors.feedback
          mark.style.borderRadius = '2px'
          mark.style.cursor = 'pointer'
          // Inherit text color from parent so it stays readable
          mark.style.color = 'inherit'
          mark.title = `${ann.annotationType}: ${ann.content}`

          range.surroundContents(mark)
          break
        }
        charCount += nodeText.length
      }
    }
  }, [annotations, readerTheme, proseRef])

  // Apply highlights when annotations or chapter change
  useEffect(() => {
    applyHighlights()
  }, [applyHighlights, chapterId])

  // Re-apply highlights when React re-renders the content (e.g., tab focus/blur)
  useEffect(() => {
    const proseEl = proseRef.current
    if (!proseEl || annotations.length === 0) return

    const observer = new MutationObserver(() => {
      // React re-rendered the innerHTML, wiping our marks — reapply
      if (proseEl.querySelectorAll('mark[data-annotation-id]').length === 0) {
        applyHighlights()
      }
    })
    observer.observe(proseEl, { childList: true })
    return () => observer.disconnect()
  }, [annotations, applyHighlights, proseRef])

  return { annotations, canAnnotate, pendingAnchor, setPendingAnchor, submitAnnotation, deleteAnnotation }
}
