'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { useSession } from 'next-auth/react'
import Link from 'next/link'
import { config } from '@/lib/config'

interface ChapterData {
  id: string
  title: string
  content: string
  publishedAt: string | null
  viewCount: number
}

interface Navigation {
  previous: string | null
  next: string | null
}

interface ReactionCount {
  reactionType: string
  count: number
}

interface Comment {
  id: string
  content: string
  parentId: string | null
  authorId: string
  authorName: string
  likeCount: number
  createdAt: string
}

type FontSize = 'small' | 'medium' | 'large' | 'xlarge'
type ReaderTheme = 'light' | 'dark' | 'sepia'
type ReaderWidth = 'narrow' | 'standard' | 'wide'

const FONT_SIZES: Record<FontSize, string> = {
  small: 'text-sm leading-6',
  medium: 'text-base leading-7',
  large: 'text-lg leading-8',
  xlarge: 'text-xl leading-9'
}

const WIDTHS: Record<ReaderWidth, string> = {
  narrow: 'max-w-lg',
  standard: 'max-w-2xl',
  wide: 'max-w-4xl'
}

const THEME_CLASSES: Record<ReaderTheme, string> = {
  light: 'bg-white text-gray-900',
  dark: 'bg-gray-950 text-gray-100',
  sepia: 'bg-amber-50 text-amber-950'
}

const REACTION_EMOJIS: Record<string, string> = {
  heart: '\u2764\uFE0F',
  laugh: '\uD83D\uDE02',
  wow: '\uD83D\uDE2E',
  sad: '\uD83D\uDE22',
  fire: '\uD83D\uDD25',
  clap: '\uD83D\uDC4F'
}

export default function ChapterReaderPage() {
  const params = useParams()
  const router = useRouter()
  const { data: session } = useSession()
  const slug = params.projectSlug as string
  const chapterId = params.chapterId as string

  const [chapter, setChapter] = useState<ChapterData | null>(null)
  const [nav, setNav] = useState<Navigation>({ previous: null, next: null })
  const [reactions, setReactions] = useState<ReactionCount[]>([])
  const [commentsList, setCommentsList] = useState<Comment[]>([])
  const [newComment, setNewComment] = useState('')
  const [projectId, setProjectId] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [embargoUntil, setEmbargoUntil] = useState<string | null>(null)

  // Reading preferences
  const [fontSize, setFontSize] = useState<FontSize>('medium')
  const [readerTheme, setReaderTheme] = useState<ReaderTheme>('light')
  const [readerWidth, setReaderWidth] = useState<ReaderWidth>('standard')
  const [showSettings, setShowSettings] = useState(false)

  // Progress tracking
  const contentRef = useRef<HTMLDivElement>(null)
  const [progress, setProgress] = useState(0)

  useEffect(() => {
    loadChapter()
  }, [slug, chapterId])

  useEffect(() => {
    // Load preferences from localStorage
    const saved = localStorage.getItem('bobbinry-reader-prefs')
    if (saved) {
      try {
        const prefs = JSON.parse(saved)
        if (prefs.fontSize) setFontSize(prefs.fontSize)
        if (prefs.readerTheme) setReaderTheme(prefs.readerTheme)
        if (prefs.readerWidth) setReaderWidth(prefs.readerWidth)
      } catch {}
    }
  }, [])

  const savePrefs = useCallback((key: string, value: string) => {
    const saved = localStorage.getItem('bobbinry-reader-prefs')
    const prefs = saved ? JSON.parse(saved) : {}
    prefs[key] = value
    localStorage.setItem('bobbinry-reader-prefs', JSON.stringify(prefs))
  }, [])

  // Track scroll progress
  useEffect(() => {
    const handleScroll = () => {
      if (!contentRef.current) return
      const el = contentRef.current
      const scrollTop = window.scrollY - el.offsetTop
      const scrollHeight = el.scrollHeight - window.innerHeight
      if (scrollHeight > 0) {
        setProgress(Math.min(100, Math.max(0, Math.round((scrollTop / scrollHeight) * 100))))
      }
    }
    window.addEventListener('scroll', handleScroll, { passive: true })
    return () => window.removeEventListener('scroll', handleScroll)
  }, [])

  // Save progress periodically
  useEffect(() => {
    if (!projectId || !session?.user?.id || progress === 0) return
    const timer = setTimeout(() => {
      fetch(`${config.apiUrl}/api/public/projects/${projectId}/chapters/${chapterId}/view`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId: session.user.id,
          position: progress,
          deviceType: window.innerWidth < 768 ? 'mobile' : window.innerWidth < 1024 ? 'tablet' : 'desktop'
        })
      }).catch(() => {})
    }, 5000)
    return () => clearTimeout(timer)
  }, [progress, projectId, chapterId, session?.user?.id])

  const loadChapter = async () => {
    setLoading(true)
    setError(null)
    try {
      // First resolve slug to get project ID
      const slugRes = await fetch(`${config.apiUrl}/api/public/projects/by-slug/${encodeURIComponent(slug)}`)
      if (!slugRes.ok) {
        setError('Project not found')
        return
      }
      const slugData = await slugRes.json()
      const projId = slugData.project.id
      setProjectId(projId)

      const userId = session?.user?.id
      const chapterUrl = `${config.apiUrl}/api/public/projects/${projId}/chapters/${chapterId}${userId ? `?userId=${userId}` : ''}`

      const res = await fetch(chapterUrl)
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
      setChapter(data.chapter)
      setNav(data.navigation)

      // Load reactions and comments in parallel
      const [reactionsRes, commentsRes] = await Promise.all([
        fetch(`${config.apiUrl}/api/public/chapters/${chapterId}/reactions`),
        fetch(`${config.apiUrl}/api/public/chapters/${chapterId}/comments`)
      ])

      if (reactionsRes.ok) {
        const rData = await reactionsRes.json()
        setReactions(rData.reactions || [])
      }
      if (commentsRes.ok) {
        const cData = await commentsRes.json()
        setCommentsList(cData.comments || [])
      }

      // Track view
      fetch(`${config.apiUrl}/api/public/projects/${projId}/chapters/${chapterId}/view`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId: userId || undefined,
          deviceType: window.innerWidth < 768 ? 'mobile' : window.innerWidth < 1024 ? 'tablet' : 'desktop',
          referrer: document.referrer || undefined
        })
      }).catch(() => {})
    } catch (err) {
      setError('Failed to load chapter')
    } finally {
      setLoading(false)
    }
  }

  const toggleReaction = async (type: string) => {
    if (!session?.user) return
    try {
      await fetch(`${config.apiUrl}/api/public/chapters/${chapterId}/reactions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${session.apiToken}`
        },
        body: JSON.stringify({ reactionType: type })
      })
      // Reload reactions
      const res = await fetch(`${config.apiUrl}/api/public/chapters/${chapterId}/reactions`)
      if (res.ok) {
        const data = await res.json()
        setReactions(data.reactions || [])
      }
    } catch {}
  }

  const postComment = async () => {
    if (!session?.apiToken || !newComment.trim()) return
    try {
      const res = await fetch(`${config.apiUrl}/api/public/chapters/${chapterId}/comments`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${session.apiToken}`
        },
        body: JSON.stringify({ content: newComment.trim() })
      })
      if (res.ok) {
        setNewComment('')
        // Reload comments
        const cRes = await fetch(`${config.apiUrl}/api/public/chapters/${chapterId}/comments`)
        if (cRes.ok) {
          const data = await cRes.json()
          setCommentsList(data.comments || [])
        }
      }
    } catch {}
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-gray-500 dark:text-gray-400">Loading...</div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-center max-w-md">
          <h1 className="text-xl font-bold text-gray-900 dark:text-gray-100 mb-2">{error}</h1>
          {embargoUntil && (
            <p className="text-gray-500 dark:text-gray-400 mb-4">
              Available on {new Date(embargoUntil).toLocaleDateString()}
            </p>
          )}
          <Link href={`/read/${slug}`} className="text-blue-600 dark:text-blue-400 hover:underline">
            Back to Table of Contents
          </Link>
        </div>
      </div>
    )
  }

  if (!chapter) return null

  return (
    <div className={THEME_CLASSES[readerTheme]}>
      {/* Progress bar */}
      <div className="fixed top-0 left-0 right-0 h-1 bg-gray-200 dark:bg-gray-800 z-50">
        <div
          className="h-full bg-blue-600 transition-all duration-300"
          style={{ width: `${progress}%` }}
        />
      </div>

      {/* Reader toolbar */}
      <div className="sticky top-0 z-40 border-b border-gray-200 dark:border-gray-800 bg-inherit">
        <div className={`${WIDTHS[readerWidth]} mx-auto px-4 py-2 flex items-center justify-between`}>
          <Link
            href={`/read/${slug}`}
            className="text-sm text-gray-500 hover:text-gray-900 dark:hover:text-gray-100 transition-colors"
          >
            &larr; Contents
          </Link>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setShowSettings(!showSettings)}
              className="p-1.5 rounded hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
              title="Reading settings"
            >
              <svg className="w-4 h-4 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6V4m0 2a2 2 0 100 4m0-4a2 2 0 110 4m-6 8a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4m6 6v10m6-2a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4" />
              </svg>
            </button>
          </div>
        </div>

        {/* Settings panel */}
        {showSettings && (
          <div className={`${WIDTHS[readerWidth]} mx-auto px-4 pb-3 border-t border-gray-100 dark:border-gray-800 pt-3`}>
            <div className="flex flex-wrap gap-4 text-sm">
              <div>
                <span className="text-xs text-gray-500 block mb-1">Size</span>
                <div className="flex gap-1">
                  {(['small', 'medium', 'large', 'xlarge'] as FontSize[]).map(s => (
                    <button
                      key={s}
                      onClick={() => { setFontSize(s); savePrefs('fontSize', s) }}
                      className={`px-2 py-1 rounded text-xs ${fontSize === s ? 'bg-blue-100 dark:bg-blue-900 text-blue-700 dark:text-blue-300' : 'hover:bg-gray-100 dark:hover:bg-gray-800'}`}
                    >
                      {s === 'small' ? 'S' : s === 'medium' ? 'M' : s === 'large' ? 'L' : 'XL'}
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <span className="text-xs text-gray-500 block mb-1">Theme</span>
                <div className="flex gap-1">
                  {(['light', 'dark', 'sepia'] as ReaderTheme[]).map(t => (
                    <button
                      key={t}
                      onClick={() => { setReaderTheme(t); savePrefs('readerTheme', t) }}
                      className={`px-2 py-1 rounded text-xs capitalize ${readerTheme === t ? 'bg-blue-100 dark:bg-blue-900 text-blue-700 dark:text-blue-300' : 'hover:bg-gray-100 dark:hover:bg-gray-800'}`}
                    >
                      {t}
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <span className="text-xs text-gray-500 block mb-1">Width</span>
                <div className="flex gap-1">
                  {(['narrow', 'standard', 'wide'] as ReaderWidth[]).map(w => (
                    <button
                      key={w}
                      onClick={() => { setReaderWidth(w); savePrefs('readerWidth', w) }}
                      className={`px-2 py-1 rounded text-xs capitalize ${readerWidth === w ? 'bg-blue-100 dark:bg-blue-900 text-blue-700 dark:text-blue-300' : 'hover:bg-gray-100 dark:hover:bg-gray-800'}`}
                    >
                      {w}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Chapter content */}
      <div ref={contentRef} className={`${WIDTHS[readerWidth]} mx-auto px-4 py-8`}>
        <h1 className="font-display text-3xl font-bold mb-6">{chapter.title}</h1>

        <div
          className={`${FONT_SIZES[fontSize]} prose dark:prose-invert prose-gray max-w-none`}
          dangerouslySetInnerHTML={{ __html: chapter.content || '' }}
        />

        {/* Reactions */}
        <div className="mt-12 pt-6 border-t border-gray-200 dark:border-gray-800">
          <div className="flex flex-wrap gap-2">
            {Object.entries(REACTION_EMOJIS).map(([type, emoji]) => {
              const count = reactions.find(r => r.reactionType === type)?.count ?? 0
              return (
                <button
                  key={type}
                  onClick={() => toggleReaction(type)}
                  className={`px-3 py-1.5 rounded-full border text-sm transition-colors ${
                    count > 0
                      ? 'border-blue-200 dark:border-blue-800 bg-blue-50 dark:bg-blue-950/30'
                      : 'border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-900/30'
                  }`}
                >
                  {emoji} {count > 0 && count}
                </button>
              )
            })}
          </div>
        </div>

        {/* Navigation */}
        <div className="mt-8 flex justify-between">
          {nav.previous ? (
            <Link
              href={`/read/${slug}/${nav.previous}`}
              className="text-sm text-blue-600 dark:text-blue-400 hover:underline"
            >
              &larr; Previous Chapter
            </Link>
          ) : <div />}
          {nav.next ? (
            <Link
              href={`/read/${slug}/${nav.next}`}
              className="text-sm text-blue-600 dark:text-blue-400 hover:underline"
            >
              Next Chapter &rarr;
            </Link>
          ) : <div />}
        </div>

        {/* Comments */}
        <div className="mt-12 pt-6 border-t border-gray-200 dark:border-gray-800">
          <h2 className="font-display text-lg font-semibold mb-4">Comments ({commentsList.length})</h2>

          {/* New comment */}
          {session?.user ? (
            <div className="mb-6">
              <textarea
                value={newComment}
                onChange={e => setNewComment(e.target.value)}
                placeholder="Share your thoughts..."
                rows={3}
                className="w-full px-3 py-2 border border-gray-200 dark:border-gray-700 bg-transparent rounded-lg text-sm resize-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              />
              <div className="flex justify-end mt-2">
                <button
                  onClick={postComment}
                  disabled={!newComment.trim()}
                  className="px-4 py-1.5 bg-blue-600 text-white rounded text-sm hover:bg-blue-700 transition-colors disabled:opacity-50"
                >
                  Comment
                </button>
              </div>
            </div>
          ) : (
            <p className="text-sm text-gray-500 mb-6">
              <Link href="/login" className="text-blue-600 dark:text-blue-400 hover:underline">Sign in</Link> to comment.
            </p>
          )}

          {/* Comment list */}
          <div className="space-y-4">
            {commentsList.map(comment => (
              <div key={comment.id} className="text-sm">
                <div className="flex items-center gap-2 mb-1">
                  <span className="font-medium">{comment.authorName || 'Anonymous'}</span>
                  <span className="text-gray-400 text-xs">
                    {new Date(comment.createdAt).toLocaleDateString()}
                  </span>
                </div>
                <p className="text-gray-700 dark:text-gray-300 whitespace-pre-line">{comment.content}</p>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
