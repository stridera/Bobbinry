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
  /** Default scope when the modal is opened by shortcut. */
  defaultScope?: 'project' | 'chapter'
}

/**
 * Inline entry-point button for the project-scoped Search & Replace modal,
 * with a Ctrl/Cmd+Shift+H shortcut. Used on the project dashboard; inside the
 * workspace the top-bar UnifiedSearch handles search & replace instead.
 *
 * Listens for `bobbinry:active-chapter` custom events from the manuscript
 * editor so the modal can offer a "This chapter" scope when one is open.
 */
export function SearchReplaceLauncher({
  projectId,
  apiToken,
  defaultScope = 'project',
}: SearchReplaceLauncherProps) {
  const [open, setOpen] = useState(false)
  const [activeChapter, setActiveChapter] = useState<ActiveChapter | null>(null)

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const isShortcut =
        (e.ctrlKey || e.metaKey) && e.shiftKey && (e.key === 'h' || e.key === 'H')
      if (!isShortcut) return
      e.preventDefault()
      setOpen(true)
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
