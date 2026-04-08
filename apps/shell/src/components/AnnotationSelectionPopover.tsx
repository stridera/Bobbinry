'use client'

import { useState, useEffect, useCallback, useRef } from 'react'

export interface TextAnchor {
  paragraphIndex: number
  quote: string
  charOffset: number
  charLength: number
}

interface Props {
  contentRef: React.RefObject<HTMLDivElement | null>
  onAnnotate: (anchor: TextAnchor) => void
  isDark: boolean
  isSepia: boolean
}

/** Block-level elements that count as "paragraphs" for anchoring */
const BLOCK_TAGS = new Set(['P', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'BLOCKQUOTE', 'LI', 'PRE', 'DIV'])

function getBlockParent(node: Node, container: HTMLElement): HTMLElement | null {
  let el: Node | null = node
  while (el && el !== container) {
    if (el instanceof HTMLElement && BLOCK_TAGS.has(el.tagName)) return el
    el = el.parentNode
  }
  return null
}

function getBlockIndex(block: HTMLElement, container: HTMLElement): number {
  const blocks = container.querySelectorAll('p, h1, h2, h3, h4, h5, h6, blockquote, li, pre')
  for (let i = 0; i < blocks.length; i++) {
    if (blocks[i] === block || blocks[i]?.contains(block)) return i
  }
  return -1
}

function getCharOffset(block: HTMLElement, range: Range): number {
  const preRange = document.createRange()
  preRange.setStart(block, 0)
  preRange.setEnd(range.startContainer, range.startOffset)
  return preRange.toString().length
}

export function AnnotationSelectionPopover({ contentRef, onAnnotate, isDark, isSepia }: Props) {
  const [position, setPosition] = useState<{ x: number; y: number } | null>(null)
  const [anchor, setAnchor] = useState<TextAnchor | null>(null)
  const popoverRef = useRef<HTMLDivElement>(null)

  const handleMouseUp = useCallback(() => {
    // Small delay to let the selection finalize
    requestAnimationFrame(() => {
      const selection = window.getSelection()
      if (!selection || selection.isCollapsed || !contentRef.current) {
        setPosition(null)
        setAnchor(null)
        return
      }

      const range = selection.getRangeAt(0)
      const quote = selection.toString().trim()
      if (!quote || quote.length < 2) {
        setPosition(null)
        setAnchor(null)
        return
      }

      // Must be within the content div (the prose container is the first child div of contentRef)
      const proseEl = contentRef.current.querySelector('.prose')
      if (!proseEl || !proseEl.contains(range.commonAncestorContainer)) {
        setPosition(null)
        setAnchor(null)
        return
      }

      const block = getBlockParent(range.startContainer, proseEl as HTMLElement)
      if (!block) {
        setPosition(null)
        setAnchor(null)
        return
      }

      const paragraphIndex = getBlockIndex(block, proseEl as HTMLElement)
      const charOffset = getCharOffset(block, range)

      const rect = range.getBoundingClientRect()
      setPosition({
        x: rect.left + rect.width / 2,
        y: rect.top - 8
      })
      setAnchor({
        paragraphIndex,
        quote,
        charOffset,
        charLength: quote.length
      })
    })
  }, [contentRef])

  // Dismiss on click outside
  useEffect(() => {
    const handleMouseDown = (e: MouseEvent) => {
      if (popoverRef.current && !popoverRef.current.contains(e.target as Node)) {
        setPosition(null)
        setAnchor(null)
      }
    }
    document.addEventListener('mousedown', handleMouseDown)
    return () => document.removeEventListener('mousedown', handleMouseDown)
  }, [])

  useEffect(() => {
    const el = contentRef.current
    if (!el) return
    el.addEventListener('mouseup', handleMouseUp)
    return () => el.removeEventListener('mouseup', handleMouseUp)
  }, [contentRef, handleMouseUp])

  if (!position || !anchor) return null

  const bgClass = isDark ? 'bg-gray-800 border-gray-700' : isSepia ? 'bg-amber-100 border-amber-300' : 'bg-white border-gray-300'
  const textClass = isDark ? 'text-gray-100' : isSepia ? 'text-amber-900' : 'text-gray-800'

  return (
    <div
      ref={popoverRef}
      className={`fixed z-50 border rounded-lg shadow-lg px-2 py-1.5 flex items-center gap-1.5 ${bgClass}`}
      style={{
        left: `${position.x}px`,
        top: `${position.y}px`,
        transform: 'translate(-50%, -100%)'
      }}
    >
      <button
        onClick={() => {
          onAnnotate(anchor)
          setPosition(null)
          setAnchor(null)
          window.getSelection()?.removeAllRanges()
        }}
        className={`text-xs font-medium px-2 py-1 rounded transition-colors ${textClass} ${isDark ? 'hover:bg-gray-700' : isSepia ? 'hover:bg-amber-200' : 'hover:bg-gray-100'}`}
      >
        <span className="flex items-center gap-1">
          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 8h10M7 12h4m1 8l-4-4H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-3l-4 4z" />
          </svg>
          Add Feedback
        </span>
      </button>
    </div>
  )
}
