import { useCallback, useEffect, useState, type RefObject } from 'react'
import type { EntityHoverDetail } from '@bobbinry/ui-components'
import { resolveCardDescription, resolveCardThumbnail } from '../entities-data'
import type { useEntityStack } from '../useEntityStack'
import { readerApi } from './reader-api'
import type { Annotation, ChapterData, EntityHighlightStyle, PublishedEntityName } from './types'

type EntityStack = ReturnType<typeof useEntityStack>

interface UseEntityHighlightsArgs {
  proseRef: RefObject<HTMLDivElement | null>
  projectId: string | null
  apiToken: string | undefined
  style: EntityHighlightStyle
  /** Hover peeks: desktop only, and only while highlights are on. */
  enablePeek: boolean
  /** Annotation marks are applied first; a change re-wraps so we must re-run. */
  annotations: Annotation[]
  chapter: ChapterData | null
  /** The prose div does not mount until loading flips to false. */
  loading: boolean
  entityStack: EntityStack
}

/**
 * Wraps published entity names in the prose with clickable spans, opens the
 * entity stack on click, and emits `bobbinry:entity-hover` events for the
 * hover card. The spans carry `data-entity-id` (comma-joined when several
 * entities share a name), `data-entity-type` and `data-entity-name`.
 */
export function useEntityHighlights({
  proseRef,
  projectId,
  apiToken,
  style,
  enablePeek,
  annotations,
  chapter,
  loading,
  entityStack,
}: UseEntityHighlightsArgs) {
  const [publishedEntityNames, setPublishedEntityNames] = useState<PublishedEntityName[]>([])
  const { navigate: navigateEntity } = entityStack

  // Fetch the list of published entity names once per project.
  useEffect(() => {
    if (!projectId) return
    let cancelled = false
    readerApi.fetchPublishedEntityNames(projectId, apiToken)
      .then(names => { if (!cancelled && names) setPublishedEntityNames(names) })
      .catch(() => {})
    return () => { cancelled = true }
  }, [projectId, apiToken])

  // Build + apply entity highlight spans after the chapter renders. Runs
  // AFTER the annotation pass so we don't wrap annotation-marked text.
  const applyEntityHighlights = useCallback(() => {
    const proseEl = proseRef.current
    if (!proseEl) return

    // Unwrap any existing entity spans first — the style might have changed,
    // the entity list might have changed, or React just re-rendered.
    proseEl.querySelectorAll('span[data-entity-id]').forEach(el => {
      const parent = el.parentNode
      if (parent) {
        parent.replaceChild(document.createTextNode(el.textContent || ''), el)
        parent.normalize()
      }
    })

    if (style === 'off' || publishedEntityNames.length === 0) return

    // Sort by name length desc so longer names ("Lira's Grandmother") match
    // before shorter substrings ("Lira"). Dedupe by lowercase name.
    const sorted = [...publishedEntityNames].sort((a, b) => b.name.length - a.name.length)
    const seen = new Set<string>()
    const patterns: string[] = []
    const nameMap = new Map<string, PublishedEntityName[]>()
    for (const e of sorted) {
      const key = e.name.toLowerCase()
      const list = nameMap.get(key) ?? []
      list.push(e)
      nameMap.set(key, list)
      if (!seen.has(key)) {
        seen.add(key)
        patterns.push(e.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
      }
    }
    if (patterns.length === 0) return
    const regex = new RegExp(`\\b(${patterns.join('|')})\\b`, 'gi')

    // Walk text nodes, skipping anything inside existing marks/links/code so
    // we don't double-wrap or interrupt other interactive content.
    const SKIP_TAGS = new Set(['A', 'MARK', 'CODE', 'PRE', 'BUTTON', 'SCRIPT', 'STYLE'])
    const walker = document.createTreeWalker(proseEl, NodeFilter.SHOW_TEXT, {
      acceptNode(n) {
        let p: Node | null = n.parentNode
        while (p && p !== proseEl) {
          if (p.nodeType === 1) {
            const tag = (p as Element).tagName
            if (SKIP_TAGS.has(tag)) return NodeFilter.FILTER_REJECT
            if ((p as Element).getAttribute('data-entity-id')) return NodeFilter.FILTER_REJECT
          }
          p = p.parentNode
        }
        return NodeFilter.FILTER_ACCEPT
      },
    })
    const textNodes: Text[] = []
    let cur: Text | null
    while ((cur = walker.nextNode() as Text | null)) textNodes.push(cur)

    for (const textNode of textNodes) {
      const text = textNode.textContent || ''
      regex.lastIndex = 0
      if (!regex.test(text)) continue
      regex.lastIndex = 0
      const frag = document.createDocumentFragment()
      let lastIndex = 0
      let m: RegExpExecArray | null
      while ((m = regex.exec(text)) !== null) {
        const start = m.index
        const end = start + m[0].length
        if (start > lastIndex) {
          frag.appendChild(document.createTextNode(text.slice(lastIndex, start)))
        }
        const entries = nameMap.get(m[0].toLowerCase())
        if (!entries || entries.length === 0) {
          frag.appendChild(document.createTextNode(m[0]))
          lastIndex = end
          continue
        }
        const span = document.createElement('span')
        span.className = `entity-highlight entity-highlight--${style}`
        span.setAttribute('data-entity-id', entries.map(e => e.id).join(','))
        span.setAttribute('data-entity-type', entries[0]!.typeId)
        span.setAttribute('data-entity-name', m[0])
        span.setAttribute('role', 'button')
        span.setAttribute('tabindex', '0')
        span.setAttribute('title', `${entries[0]!.typeLabel} · click to open`)
        span.textContent = m[0]
        frag.appendChild(span)
        lastIndex = end
      }
      if (lastIndex < text.length) {
        frag.appendChild(document.createTextNode(text.slice(lastIndex)))
      }
      textNode.parentNode?.replaceChild(frag, textNode)
    }
  }, [publishedEntityNames, style, proseRef])

  // Re-apply whenever the entity list, style, annotations (which rewrap), or
  // chapter change. Annotation highlights run first; we follow them.
  // `loading` is a dep because the prose div doesn't mount until loading
  // flips to false — the ref would otherwise be null when we try to apply.
  useEffect(() => {
    applyEntityHighlights()
  }, [applyEntityHighlights, chapter, annotations, loading])

  // React's dangerouslySetInnerHTML can rewrite innerHTML on later renders,
  // wiping the spans we added. Watch for content replacement and re-apply.
  useEffect(() => {
    const proseEl = proseRef.current
    if (!proseEl) return
    const observer = new MutationObserver(() => {
      if (publishedEntityNames.length === 0 || style === 'off') return
      if (proseEl.querySelector('span[data-entity-id]')) return // already applied
      applyEntityHighlights()
    })
    observer.observe(proseEl, { childList: true, subtree: false })
    return () => observer.disconnect()
  }, [applyEntityHighlights, publishedEntityNames.length, style, loading, proseRef])

  // Delegated click handler: open the entity modal when any highlight span
  // is activated. Uses the first id when multiple entities share the name.
  useEffect(() => {
    const proseEl = proseRef.current
    if (!proseEl || !projectId) return

    function handle(e: Event) {
      const target = (e.target as HTMLElement | null)?.closest('[data-entity-id]') as HTMLElement | null
      if (!target) return
      const idAttr = target.getAttribute('data-entity-id')
      if (!idAttr) return
      e.preventDefault()
      const firstId = idAttr.split(',')[0]
      // Reset: a fresh tap on the chapter text starts a new browse, it
      // doesn't stack on whatever the reader was previously looking at.
      if (firstId) void navigateEntity(firstId, { reset: true })
    }
    function handleKey(e: KeyboardEvent) {
      if (e.key !== 'Enter' && e.key !== ' ') return
      handle(e)
    }
    proseEl.addEventListener('click', handle)
    proseEl.addEventListener('keydown', handleKey)
    return () => {
      proseEl.removeEventListener('click', handle)
      proseEl.removeEventListener('keydown', handleKey)
    }
  }, [projectId, navigateEntity, loading, proseRef])

  // Delegated hover: peek at the entity under the pointer. The card opens with
  // the name and type we already hold, then fills in once the gated fetch lands
  // — the bulk name list carries no descriptions on purpose, so unlike the
  // editor there is nothing to show instantly.
  useEffect(() => {
    const proseEl = proseRef.current
    if (!proseEl || !projectId || !enablePeek) return

    const nameIndex = new Map(publishedEntityNames.map(entry => [entry.id, entry]))
    let hoveredKey: string | null = null

    function handleOver(e: Event) {
      const target = (e.target as HTMLElement | null)?.closest('[data-entity-id]') as HTMLElement | null
      if (!target) return
      const idAttr = target.getAttribute('data-entity-id')
      const name = target.getAttribute('data-entity-name')
      if (!idAttr || !name) return

      const ids = idAttr.split(',').map(id => id.trim()).filter(Boolean)
      const entries = ids
        .map(id => nameIndex.get(id))
        .filter((entry): entry is PublishedEntityName => entry != null)
        .map(entry => ({
          id: entry.id,
          name: entry.name,
          typeId: entry.typeId,
          typeIcon: entry.typeIcon,
          typeLabel: entry.typeLabel,
        }))
      if (entries.length === 0) return

      const { top, bottom, left, right } = target.getBoundingClientRect()
      const rect = { top, bottom, left, right }
      hoveredKey = idAttr

      const emit = (detail: EntityHoverDetail) =>
        window.dispatchEvent(new CustomEvent('bobbinry:entity-hover', { detail }))

      emit({ key: idAttr, name, entries, rect, pending: true })

      const firstId = ids[0]
      if (!firstId) return
      void entityStack.peek(firstId).then(entry => {
        // The pointer may have moved on while we were fetching.
        if (hoveredKey !== idAttr || !entry) return
        if (entry.kind === 'locked') {
          emit({ key: idAttr, name, entries, rect, locked: { tierLevel: entry.tierLevel } })
          return
        }
        if (entry.kind !== 'entity') {
          emit({ key: idAttr, name, entries, rect })
          return
        }
        // resolveCard* apply the same variant gating the codex cards use, so a
        // peek can never show a description the drawer would have withheld.
        const description = resolveCardDescription(entry.entity, entry.type)
        const thumbnail = resolveCardThumbnail(entry.entity, entry.type)
        const [first, ...rest] = entries
        if (!first) return
        emit({
          key: idAttr,
          name,
          rect,
          entries: [
            {
              ...first,
              ...(description ? { description } : {}),
              ...(thumbnail?.url ? { imageUrl: thumbnail.url } : {}),
            },
            ...rest,
          ],
        })
      })
    }

    function handleOut(e: Event) {
      const target = (e.target as HTMLElement | null)?.closest('[data-entity-id]') as HTMLElement | null
      if (!target) return
      hoveredKey = null
      window.dispatchEvent(new CustomEvent('bobbinry:entity-hover-end'))
    }

    proseEl.addEventListener('mouseover', handleOver)
    proseEl.addEventListener('mouseout', handleOut)
    return () => {
      proseEl.removeEventListener('mouseover', handleOver)
      proseEl.removeEventListener('mouseout', handleOut)
    }
  }, [projectId, enablePeek, publishedEntityNames, entityStack, loading, proseRef])

  return { publishedEntityNames }
}
