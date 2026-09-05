import { useCallback, useEffect, useRef, useState } from 'react'
import { trackEvent } from '@bobbinry/sdk'
import {
  MANUSCRIPT_DISPLAY_DEFAULTS,
  resolveDisplaySettings,
  sanitizeDisplaySettings,
  type ManuscriptDisplaySettings,
} from '@bobbinry/types'
import { readerApi } from './reader-api'
import { deviceType, type ChapterData, type Navigation } from './types'

interface UseChapterLoaderArgs {
  authorUsername: string
  projectSlug: string
  /** Slug, old-slug alias, or legacy UUID — the API resolves all three. */
  chapterParam: string
  /** Owner-only "view as" preview; the API ignores it for non-owners. */
  viewAsQuery: string
  basePath: string
  apiToken: string | undefined
  sessionStatus: 'loading' | 'authenticated' | 'unauthenticated'
  sessionUserId: string | undefined
}

/**
 * Resolves the project, loads the chapter, canonicalises the URL to the
 * current slug, and records one view per loaded chapter.
 */
export function useChapterLoader({
  authorUsername,
  projectSlug,
  chapterParam,
  viewAsQuery,
  basePath,
  apiToken,
  sessionStatus,
  sessionUserId,
}: UseChapterLoaderArgs) {
  const [chapter, setChapter] = useState<ChapterData | null>(null)
  const [displaySettings, setDisplaySettings] = useState<ManuscriptDisplaySettings>(MANUSCRIPT_DISPLAY_DEFAULTS)
  const [nav, setNav] = useState<Navigation>({ previous: null, next: null })
  const [projectId, setProjectId] = useState<string | null>(null)
  const [projectName, setProjectName] = useState('')
  const [authorDisplayName, setAuthorDisplayName] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [embargoUntil, setEmbargoUntil] = useState<string | null>(null)

  // Generation counter so a superseded load (fast navigation, token refresh)
  // cannot apply its stale response over the current one.
  const loadGenRef = useRef(0)

  const loadChapter = useCallback(async () => {
    // Wait for the session to settle: private projects and beta/subscriber
    // perks need the bearer token on the very first fetch.
    if (sessionStatus === 'loading') return
    const gen = ++loadGenRef.current
    const stale = () => gen !== loadGenRef.current
    setLoading(true)
    setError(null)
    try {
      const slugRes = await readerApi.resolveProject(authorUsername, projectSlug, viewAsQuery, apiToken)
      if (stale()) return
      if (!slugRes.ok) {
        setError('Project not found')
        return
      }
      const slugData = await slugRes.json()
      const projId: string = slugData.project.id
      setProjectId(projId)
      setProjectName(slugData.project.name || projectSlug)
      setAuthorDisplayName(slugData.author?.displayName || slugData.author?.userName || authorUsername)

      const res = await readerApi.fetchChapter(projId, chapterParam, viewAsQuery, apiToken)
      if (stale()) return
      if (res.status === 403) {
        const data = await res.json()
        setEmbargoUntil(data.embargoUntil)
        setError(data.error || 'Access denied')
        return
      }
      if (!res.ok) {
        setError('Chapter not found')
        return
      }

      const data = await res.json()
      if (stale()) return
      setChapter(data.chapter)
      setNav(data.navigation)
      // Author-driven manuscript layout cascade resolved server-side.
      // Reader's own font/theme/width prefs apply on top of this.
      setDisplaySettings(resolveDisplaySettings(null, null, sanitizeDisplaySettings(data.resolvedDisplay)))

      // Canonicalize the URL: UUID and old-slug-alias hits get replaced with
      // the current slug so the address bar always shows the shareable form.
      // Shallow replaceState (not router.replace) — a route-param change
      // would re-run this effect and double-count the view.
      if (data.chapter.slug && chapterParam !== data.chapter.slug) {
        window.history.replaceState(null, '', `${basePath}/${data.chapter.slug}`)
      }
    } catch {
      if (!stale()) setError('Failed to load chapter')
    } finally {
      if (!stale()) setLoading(false)
    }
  }, [authorUsername, projectSlug, chapterParam, sessionStatus, apiToken, basePath, viewAsQuery])

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- initial fetch
    loadChapter()
  }, [loadChapter])

  // Record the view once per loaded chapter, keyed on its canonical id — not
  // inside loadChapter, where any reload (token refresh, retry) would count
  // again. The bearer header lets the server attribute the view to the reader.
  const chapterId = chapter?.id ?? null
  useEffect(() => {
    if (!chapterId || !projectId) return
    trackEvent('chapter_view_started', { projectId, chapterId, signedIn: !!sessionUserId })
    readerApi.postView(projectId, chapterId, apiToken, {
      deviceType: deviceType(),
      referrer: document.referrer || undefined,
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps -- fire once per chapter id
  }, [chapterId, projectId])

  return { chapter, chapterId, nav, displaySettings, projectId, projectName, authorDisplayName, loading, error, embargoUntil }
}
