'use client'

import { useCallback, useEffect, useState } from 'react'
import { SearchReplaceModal } from './SearchReplaceModal'

interface ActiveChapter {
  id: string
  title: string
}

interface SearchReplaceLauncherProps {
  projectId: string
  apiToken: string | undefined
  /** Visual style of the trigger button.
   * - `inline`: a normal in-flow button (used in toolbars/headers).
   * - `floating`: a fixed pill anchored to the bottom-right of the viewport
   *   (used over editor/corkboard views where there's no header slot).
   * - `toolbar`: a compact text button for dense toolbars.
   * - `none`: shortcut-only, no visible button. */
  buttonVariant?: 'toolbar' | 'inline' | 'floating' | 'none'
  /** Default scope when the modal is opened by shortcut. */
  defaultScope?: 'project' | 'chapter'
}

/**
 * Mounts the project-scoped Search & Replace modal and binds a Ctrl/Cmd+Shift+H
 * shortcut. Also exposes an entry-point button (unless `buttonVariant='none'`).
 *
 * Listens for `bobbinry:active-chapter` custom events from the manuscript
 * editor so the modal can offer a "This chapter" scope when one is open.
 */
export function SearchReplaceLauncher({
  projectId,
  apiToken,
  buttonVariant = 'inline',
  defaultScope = 'project',
}: SearchReplaceLauncherProps) {
  const [open, setOpen] = useState(false)
  const [activeChapter, setActiveChapter] = useState<ActiveChapter | null>(null)

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null
      // Skip when typing in an editable surface so we don't steal Ctrl+H undo
      // behavior the user might have wired up elsewhere — Shift narrows it.
      const isShortcut =
        (e.ctrlKey || e.metaKey) && e.shiftKey && (e.key === 'h' || e.key === 'H')
      if (!isShortcut) return
      e.preventDefault()
      setOpen(true)
      // Prevent the keystroke from also flipping focus mode etc.
      void target
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [])

  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent<ActiveChapter | null>).detail
      setActiveChapter(detail ?? null)
    }
    window.addEventListener('bobbinry:active-chapter', handler)
    return () => window.removeEventListener('bobbinry:active-chapter', handler)
  }, [])

  const openModal = useCallback(() => setOpen(true), [])
  const close = useCallback(() => setOpen(false), [])

  if (!apiToken) return null

  return (
    <>
      {buttonVariant === 'toolbar' && (
        <button
          type="button"
          onClick={openModal}
          className="px-3 py-1.5 text-sm font-medium text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700 rounded transition-colors"
          title="Search & Replace (Ctrl+Shift+H)"
        >
          Search &amp; Replace
        </button>
      )}
      {buttonVariant === 'inline' && (
        <button
          type="button"
          onClick={openModal}
          className="inline-flex items-center gap-2 px-3 py-2 text-sm font-medium text-gray-700 dark:text-gray-200 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
          title="Search & Replace (Ctrl+Shift+H)"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
          Search &amp; Replace
        </button>
      )}
      {buttonVariant === 'floating' && (
        <button
          type="button"
          onClick={openModal}
          className="fixed bottom-6 right-6 z-30 inline-flex items-center gap-2 px-3.5 py-2 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 dark:bg-blue-700 dark:hover:bg-blue-600 rounded-full shadow-lg hover:shadow-xl transition-all"
          title="Search & Replace (Ctrl+Shift+H)"
          aria-label="Open Search and Replace"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
          <span className="hidden sm:inline">Search &amp; Replace</span>
        </button>
      )}
      {open && (
        <SearchReplaceModal
          projectId={projectId}
          apiToken={apiToken}
          activeChapter={activeChapter}
          initialScope={defaultScope}
          onClose={close}
        />
      )}
    </>
  )
}
