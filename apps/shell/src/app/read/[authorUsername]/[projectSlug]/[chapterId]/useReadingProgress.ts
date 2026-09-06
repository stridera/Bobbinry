import { useCallback, useEffect, useRef, useState, type RefObject } from 'react'
import { trackEvent } from '@bobbinry/sdk'
import { readerApi } from './reader-api'
import { deviceType } from './types'

interface UseReadingProgressArgs {
  /** The column containing the prose; scroll progress is measured against it. */
  contentRef: RefObject<HTMLDivElement | null>
  chapterId: string | null
  projectId: string | null
  /** Progress is only persisted server-side for signed-in readers. */
  userId: string | undefined
  apiToken: string | undefined
  /** False until the chapter has rendered. */
  active: boolean
}

/**
 * Scroll progress, the once-per-chapter completion event, periodic progress
 * saves (debounced, plus a beacon on leave), and the localStorage bookmark.
 */
export function useReadingProgress({ contentRef, chapterId, projectId, userId, apiToken, active }: UseReadingProgressArgs) {
  const [progress, setProgress] = useState(0)
  const progressRef = useRef(0)
  const [isBookmarked, setIsBookmarked] = useState(false)

  // Bookmarks are keyed by UUID so they survive slug renames and legacy
  // UUID-URL bookmarks keep working.
  const bookmarkKey = chapterId ? `bobbinry-bookmark-${chapterId}` : null

  const saveBookmark = useCallback(() => {
    if (!bookmarkKey) return
    localStorage.setItem(bookmarkKey, JSON.stringify({ progress, savedAt: Date.now() }))
    setIsBookmarked(true)
  }, [bookmarkKey, progress])

  const removeBookmark = useCallback(() => {
    if (!bookmarkKey) return
    localStorage.removeItem(bookmarkKey)
    setIsBookmarked(false)
  }, [bookmarkKey])

  const restoreBookmark = useCallback(() => {
    if (!bookmarkKey) return
    try {
      const saved = localStorage.getItem(bookmarkKey)
      if (saved) {
        const bookmark = JSON.parse(saved)
        if (bookmark.progress && contentRef.current) {
          const el = contentRef.current
          const scrollHeight = el.scrollHeight - window.innerHeight
          const targetScroll = el.offsetTop + (scrollHeight * bookmark.progress / 100)
          window.scrollTo({ top: targetScroll, behavior: 'smooth' })
        }
      }
    } catch {}
  }, [bookmarkKey, contentRef])

  // Check for an existing bookmark once the chapter (and its UUID) is loaded
  useEffect(() => {
    if (!bookmarkKey) return
    const saved = localStorage.getItem(bookmarkKey)
    // eslint-disable-next-line react-hooks/set-state-in-effect -- hydration bridge
    setIsBookmarked(!!saved)
  }, [bookmarkKey])

  // Track scroll progress
  useEffect(() => {
    if (!active) return

    const handleScroll = () => {
      if (!contentRef.current) return
      const el = contentRef.current
      const scrollTop = window.scrollY - el.offsetTop
      const scrollHeight = el.scrollHeight - window.innerHeight
      if (scrollHeight <= 0) {
        // Content fits on screen — reader can see everything
        setProgress(100)
      } else {
        setProgress(Math.min(100, Math.max(0, Math.round((scrollTop / scrollHeight) * 100))))
      }
    }
    window.addEventListener('scroll', handleScroll, { passive: true })
    // Wait a frame for layout to settle, then check for short chapters
    requestAnimationFrame(() => handleScroll())
    return () => window.removeEventListener('scroll', handleScroll)
  }, [active, contentRef])

  // Keep ref in sync for the beacon on unmount
  useEffect(() => { progressRef.current = progress }, [progress])

  // Report a completed read once per chapter. Progress keeps climbing past the
  // threshold, so without the ref this would fire on every scroll tick.
  const completionFiredRef = useRef<string | null>(null)
  useEffect(() => {
    if (!projectId || !chapterId || progress < 95) return
    if (completionFiredRef.current === chapterId) return
    completionFiredRef.current = chapterId
    trackEvent('chapter_completed', { projectId, chapterId })
  }, [progress, projectId, chapterId])

  // Save progress periodically (debounced)
  useEffect(() => {
    if (!projectId || !chapterId || !userId || progress === 0) return
    const timer = setTimeout(() => {
      readerApi.postView(projectId, chapterId, apiToken, { position: progress, deviceType: deviceType() })
    }, 3000)
    return () => clearTimeout(timer)
  }, [progress, projectId, chapterId, userId, apiToken])

  // Save progress when leaving the page (back button, link click, tab close).
  // A keepalive fetch carries the bearer header (sendBeacon could not), so the
  // server matches the signed-in reader's existing view row.
  useEffect(() => {
    if (!projectId || !chapterId || !userId) return

    const saveOnLeave = () => {
      if (progressRef.current === 0) return
      readerApi.postViewOnLeave(projectId, chapterId, apiToken, { position: progressRef.current, deviceType: deviceType() })
    }

    window.addEventListener('beforeunload', saveOnLeave)
    return () => {
      window.removeEventListener('beforeunload', saveOnLeave)
      saveOnLeave()  // Also fire on component unmount (SPA navigation)
    }
  }, [projectId, chapterId, userId, apiToken])

  return { progress, isBookmarked, saveBookmark, removeBookmark, restoreBookmark }
}
