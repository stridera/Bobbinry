'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { useSession } from 'next-auth/react'
import Link from 'next/link'
import { config } from '@/lib/config'
import { ReaderNav } from '@/components/ReaderNav'

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
  const authorUsername = params.authorUsername as string
  const projectSlug = params.projectSlug as string
  const chapterId = params.chapterId as string

  const basePath = `/read/${authorUsername}/${projectSlug}`

  const [chapter, setChapter] = useState<ChapterData | null>(null)
  const [nav, setNav] = useState<Navigation>({ previous: null, next: null })
  const [reactions, setReactions] = useState<ReactionCount[]>([])
  const [commentsList, setCommentsList] = useState<Comment[]>([])
  const [newComment, setNewComment] = useState('')
  const [projectId, setProjectId] = useState<string | null>(null)
  const [projectName, setProjectName] = useState<string>('')
  const [authorDisplayName, setAuthorDisplayName] = useState<string>('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [embargoUntil, setEmbargoUntil] = useState<string | null>(null)

  // Reading preferences — detect system theme as default
  const [fontSize, setFontSize] = useState<FontSize>('medium')
  const [readerTheme, setReaderTheme] = useState<ReaderTheme>(() => {
    if (typeof window === 'undefined') return 'light'
    try {
      const saved = localStorage.getItem('bobbinry-reader-prefs')
      if (saved) {
        const prefs = JSON.parse(saved)
        if (prefs.readerTheme) return prefs.readerTheme
      }
    } catch {}
    // Fall back to system/document dark mode
    if (document.documentElement.classList.contains('dark')) return 'dark'
    if (window.matchMedia('(prefers-color-scheme: dark)').matches) return 'dark'
    return 'light'
  })
  const [readerWidth, setReaderWidth] = useState<ReaderWidth>('standard')
  const [showSettings, setShowSettings] = useState(false)

  // Progress tracking
  const contentRef = useRef<HTMLDivElement>(null)
  const [progress, setProgress] = useState(0)

  useEffect(() => {
    loadChapter()
  }, [authorUsername, projectSlug, chapterId])

  useEffect(() => {
    // Load remaining preferences from localStorage
    const saved = localStorage.getItem('bobbinry-reader-prefs')
    if (saved) {
      try {
        const prefs = JSON.parse(saved)
        if (prefs.fontSize) setFontSize(prefs.fontSize)
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
      // Resolve by author + slug
      const slugRes = await fetch(
        `${config.apiUrl}/api/public/projects/by-author-and-slug/${encodeURIComponent(authorUsername)}/${encodeURIComponent(projectSlug)}`
      )
      if (!slugRes.ok) {
        setError('Project not found')
        return
      }
      const slugData = await slugRes.json()
      const projId = slugData.project.id
      setProjectId(projId)
      setProjectName(slugData.project.name || projectSlug)
      setAuthorDisplayName(slugData.author?.displayName || slugData.author?.userName || authorUsername)

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
      <div className="min-h-screen bg-gray-50 dark:bg-gray-950">
        <ReaderNav crumbs={[
          { label: authorUsername, href: `/read/${authorUsername}` },
          { label: projectSlug, href: basePath }
        ]} />
        <div className="flex items-center justify-center py-32">
          <div className="text-gray-500 dark:text-gray-400">Loading...</div>
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="min-h-screen bg-gray-50 dark:bg-gray-950">
        <ReaderNav crumbs={[
          { label: authorDisplayName || authorUsername, href: `/read/${authorUsername}` },
          { label: projectName || projectSlug, href: basePath }
        ]} />
        <div className="flex items-center justify-center py-32">
          <div className="text-center max-w-md">
            <h1 className="text-xl font-bold text-gray-900 dark:text-gray-100 mb-2">{error}</h1>
            {embargoUntil && (
              <p className="text-gray-500 dark:text-gray-400 mb-4">
                Available on {new Date(embargoUntil).toLocaleDateString()}
              </p>
            )}
            <Link href={basePath} className="text-blue-600 dark:text-blue-400 hover:underline">
              Back to Table of Contents
            </Link>
          </div>
        </div>
      </div>
    )
  }

  if (!chapter) return null

  const isDark = readerTheme === 'dark'
  const isSepia = readerTheme === 'sepia'

  // Theme-aware color helpers (independent of document dark mode)
  const borderColor = isDark ? 'border-gray-800' : isSepia ? 'border-amber-200' : 'border-gray-200'
  const mutedText = isDark ? 'text-gray-400' : isSepia ? 'text-amber-700' : 'text-gray-500'
  const linkColor = isDark ? 'text-blue-400' : 'text-blue-600'
  const hoverBg = isDark ? 'hover:bg-gray-800' : isSepia ? 'hover:bg-amber-100' : 'hover:bg-gray-100'
  const activeBg = isDark ? 'bg-blue-900 text-blue-300' : 'bg-blue-100 text-blue-700'
  const proseClass = isDark ? 'prose-invert' : isSepia ? 'prose-amber' : 'prose-gray'

  const navTheme = {
    bg: isDark ? 'bg-gray-950' : isSepia ? 'bg-amber-50' : 'bg-white/80 backdrop-blur-sm',
    border: borderColor,
    text: isDark ? 'text-gray-100' : isSepia ? 'text-amber-950' : 'text-gray-900',
    muted: mutedText,
    hover: isDark ? 'hover:text-gray-100' : isSepia ? 'hover:text-amber-950' : 'hover:text-gray-900'
  }

  return (
    <div className={`min-h-screen ${THEME_CLASSES[readerTheme]}`}>
      {/* Progress bar */}
      <div className={`fixed top-0 left-0 right-0 h-0.5 ${isDark ? 'bg-gray-800' : 'bg-gray-200'} z-50`}>
        <div
          className="h-full bg-blue-600 transition-all duration-300"
          style={{ width: `${progress}%` }}
        />
      </div>

      {/* Breadcrumb nav */}
      <ReaderNav
        crumbs={[
          { label: authorDisplayName || authorUsername, href: `/read/${authorUsername}` },
          { label: projectName || projectSlug, href: basePath },
          { label: chapter?.title || 'Chapter' }
        ]}
        themed={navTheme}
      />

      {/* Reader settings bar */}
      <div className={`border-b ${borderColor} bg-inherit`}>
        <div className={`${WIDTHS[readerWidth]} mx-auto px-4 py-1.5 flex items-center justify-end`}>
          <button
            onClick={() => setShowSettings(!showSettings)}
            className={`p-1.5 rounded ${hoverBg} transition-colors`}
            title="Reading settings"
          >
            <svg className={`w-4 h-4 ${mutedText}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6V4m0 2a2 2 0 100 4m0-4a2 2 0 110 4m-6 8a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4m6 6v10m6-2a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4" />
            </svg>
          </button>
        </div>

        {/* Settings panel */}
        {showSettings && (
          <div className={`${WIDTHS[readerWidth]} mx-auto px-4 pb-3 border-t ${borderColor} pt-3`}>
            <div className="flex flex-wrap gap-4 text-sm">
              <div>
                <span className={`text-xs ${mutedText} block mb-1`}>Size</span>
                <div className="flex gap-1">
                  {(['small', 'medium', 'large', 'xlarge'] as FontSize[]).map(s => (
                    <button
                      key={s}
                      onClick={() => { setFontSize(s); savePrefs('fontSize', s) }}
                      className={`px-2 py-1 rounded text-xs ${fontSize === s ? activeBg : hoverBg}`}
                    >
                      {s === 'small' ? 'S' : s === 'medium' ? 'M' : s === 'large' ? 'L' : 'XL'}
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <span className={`text-xs ${mutedText} block mb-1`}>Theme</span>
                <div className="flex gap-1">
                  {(['light', 'dark', 'sepia'] as ReaderTheme[]).map(t => (
                    <button
                      key={t}
                      onClick={() => { setReaderTheme(t); savePrefs('readerTheme', t) }}
                      className={`px-2 py-1 rounded text-xs capitalize ${readerTheme === t ? activeBg : hoverBg}`}
                    >
                      {t}
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <span className={`text-xs ${mutedText} block mb-1`}>Width</span>
                <div className="flex gap-1">
                  {(['narrow', 'standard', 'wide'] as ReaderWidth[]).map(w => (
                    <button
                      key={w}
                      onClick={() => { setReaderWidth(w); savePrefs('readerWidth', w) }}
                      className={`px-2 py-1 rounded text-xs capitalize ${readerWidth === w ? activeBg : hoverBg}`}
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
          className={`${FONT_SIZES[fontSize]} prose ${proseClass} max-w-none`}
          dangerouslySetInnerHTML={{ __html: chapter.content || '' }}
        />

        {/* Reactions — only show if user is signed in or there are existing reactions */}
        {(session?.user || reactions.some(r => r.count > 0)) && (
          <div className={`mt-12 pt-6 border-t ${borderColor}`}>
            <div className="flex flex-wrap gap-2">
              {session?.user ? (
                Object.entries(REACTION_EMOJIS).map(([type, emoji]) => {
                  const count = reactions.find(r => r.reactionType === type)?.count ?? 0
                  return (
                    <button
                      key={type}
                      onClick={() => toggleReaction(type)}
                      className={`px-3 py-1.5 rounded-full border text-sm transition-colors ${
                        count > 0
                          ? isDark ? 'border-blue-800 bg-blue-950/30' : 'border-blue-200 bg-blue-50'
                          : `${borderColor} ${hoverBg}`
                      }`}
                    >
                      {emoji} {count > 0 && count}
                    </button>
                  )
                })
              ) : (
                reactions.filter(r => r.count > 0).map(r => (
                  <span
                    key={r.reactionType}
                    className={`px-3 py-1.5 rounded-full border text-sm ${
                      isDark ? 'border-blue-800 bg-blue-950/30' : 'border-blue-200 bg-blue-50'
                    }`}
                  >
                    {REACTION_EMOJIS[r.reactionType] || r.reactionType} {r.count}
                  </span>
                ))
              )}
            </div>
          </div>
        )}

        {/* Navigation */}
        <div className="mt-8 flex justify-between">
          {nav.previous ? (
            <Link
              href={`${basePath}/${nav.previous}`}
              className={`text-sm ${linkColor} hover:underline`}
            >
              &larr; Previous Chapter
            </Link>
          ) : <div />}
          {nav.next ? (
            <Link
              href={`${basePath}/${nav.next}`}
              className={`text-sm ${linkColor} hover:underline`}
            >
              Next Chapter &rarr;
            </Link>
          ) : <div />}
        </div>

        {/* Comments */}
        <div className={`mt-12 pt-6 border-t ${borderColor}`}>
          <h2 className="font-display text-lg font-semibold mb-4">Comments ({commentsList.length})</h2>

          {/* New comment */}
          {session?.user ? (
            <div className="mb-6">
              <textarea
                value={newComment}
                onChange={e => setNewComment(e.target.value)}
                placeholder="Share your thoughts..."
                rows={3}
                className={`w-full px-3 py-2 border ${borderColor} bg-transparent rounded-lg text-sm resize-none focus:ring-2 focus:ring-blue-500 focus:border-transparent`}
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
            <p className={`text-sm ${mutedText} mb-6`}>
              <Link href="/login" className={`${linkColor} hover:underline`}>Sign in</Link> to comment.
            </p>
          )}

          {/* Comment list */}
          <div className="space-y-4">
            {commentsList.map(comment => (
              <div key={comment.id} className="text-sm">
                <div className="flex items-center gap-2 mb-1">
                  <span className="font-medium">{comment.authorName || 'Anonymous'}</span>
                  <span className={`${mutedText} text-xs`}>
                    {new Date(comment.createdAt).toLocaleDateString()}
                  </span>
                </div>
                <p className={`${isDark ? 'text-gray-300' : isSepia ? 'text-amber-900' : 'text-gray-700'} whitespace-pre-line`}>{comment.content}</p>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
