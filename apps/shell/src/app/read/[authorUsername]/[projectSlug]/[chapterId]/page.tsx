'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import { useParams } from 'next/navigation'
import { useSession } from 'next-auth/react'
import Link from 'next/link'
import { getSanitizedHtmlProps } from '@bobbinry/sdk'
import { config } from '@/lib/config'
import { ReaderNav } from '@/components/ReaderNav'
import { ExtensionSlot } from '@/components/ExtensionSlot'
import { AnnotationSelectionPopover, type TextAnchor } from '@/components/AnnotationSelectionPopover'
import { AnnotationForm } from '@/components/AnnotationForm'
import EntityModal from '../EntityModal'
import type { PublishedEntity, PublishedType } from '../entities-data'

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
  replies: Comment[]
}

interface Annotation {
  id: string
  anchorParagraphIndex: number | null
  anchorQuote: string
  anchorCharOffset: number | null
  anchorCharLength: number | null
  annotationType: string
  errorCategory: string | null
  content: string
  suggestedText: string | null
  status: string
  authorResponse: string | null
  chapterVersion: number
  createdAt: string
}

type FontSize = 'small' | 'medium' | 'large' | 'xlarge'
type ReaderTheme = 'light' | 'dark' | 'sepia'
type ReaderWidth = 'narrow' | 'standard' | 'wide'
type EntityHighlightStyle = 'highlight' | 'underline' | 'off'

interface PublishedEntityName {
  id: string
  name: string
  typeId: string
  typeIcon: string
  typeLabel: string
}

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

const MAX_REPLY_DEPTH = 3

function CommentThread({
  comment,
  depth,
  isDark,
  isSepia,
  mutedText,
  borderColor,
  isLoggedIn,
  replyingTo,
  replyContent,
  onSetReplyingTo,
  onSetReplyContent,
  onPostReply
}: {
  comment: Comment
  depth: number
  isDark: boolean
  isSepia: boolean
  mutedText: string
  borderColor: string
  isLoggedIn: boolean
  replyingTo: string | null
  replyContent: string
  onSetReplyingTo: (id: string | null) => void
  onSetReplyContent: (s: string) => void
  onPostReply: (parentId?: string) => void
}) {
  const contentColor = isDark ? 'text-gray-300' : isSepia ? 'text-amber-900' : 'text-gray-700'
  const isReplying = replyingTo === comment.id

  return (
    <div className={depth > 0 ? `ml-6 pl-4 border-l-2 ${borderColor}` : ''}>
      <div className="text-sm">
        <div className="flex items-center gap-2 mb-1">
          <span className="font-medium">{comment.authorName || 'Anonymous'}</span>
          <span className={`${mutedText} text-xs`}>
            {new Date(comment.createdAt).toLocaleDateString()}
          </span>
        </div>
        <p className={`${contentColor} whitespace-pre-line`}>{comment.content}</p>
        {isLoggedIn && depth < MAX_REPLY_DEPTH && (
          <button
            onClick={() => onSetReplyingTo(isReplying ? null : comment.id)}
            className={`${mutedText} text-xs mt-1 hover:underline`}
          >
            {isReplying ? 'Cancel' : 'Reply'}
          </button>
        )}
        {isReplying && (
          <div className="mt-2 mb-2">
            <textarea
              value={replyContent}
              onChange={e => onSetReplyContent(e.target.value)}
              placeholder="Write a reply..."
              rows={2}
              className={`w-full px-3 py-2 border ${borderColor} bg-transparent rounded-lg text-sm resize-none focus:ring-2 focus:ring-blue-500 focus:border-transparent`}
            />
            <div className="flex justify-end mt-1 gap-2">
              <button
                onClick={() => onSetReplyingTo(null)}
                className={`px-3 py-1 text-xs ${mutedText} hover:underline`}
              >
                Cancel
              </button>
              <button
                onClick={() => onPostReply(comment.id)}
                disabled={!replyContent.trim()}
                className="px-3 py-1 bg-blue-600 text-white rounded text-xs hover:bg-blue-700 transition-colors disabled:opacity-50"
              >
                Reply
              </button>
            </div>
          </div>
        )}
      </div>
      {comment.replies && comment.replies.length > 0 && (
        <div className="mt-3 space-y-3">
          {comment.replies.map(reply => (
            <CommentThread
              key={reply.id}
              comment={reply}
              depth={depth + 1}
              isDark={isDark}
              isSepia={isSepia}
              mutedText={mutedText}
              borderColor={borderColor}
              isLoggedIn={isLoggedIn}
              replyingTo={replyingTo}
              replyContent={replyContent}
              onSetReplyingTo={onSetReplyingTo}
              onSetReplyContent={onSetReplyContent}
              onPostReply={onPostReply}
            />
          ))}
        </div>
      )}
    </div>
  )
}

export default function ChapterReaderPage() {
  const params = useParams()
  const { data: session } = useSession()
  const sessionUserId = session?.user?.id
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

  // Annotations
  const [annotations, setAnnotations] = useState<Annotation[]>([])
  const [canAnnotate, setCanAnnotate] = useState(false)
  const [pendingAnchor, setPendingAnchor] = useState<TextAnchor | null>(null)
  const [showAnnotationSidebar, setShowAnnotationSidebar] = useState(false)
  const chapterContentRef = useRef<HTMLDivElement>(null)

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
  const [entityHighlightStyle, setEntityHighlightStyle] = useState<EntityHighlightStyle>('highlight')
  const [showSettings, setShowSettings] = useState(false)

  // Published-entity names + click-to-open modal state
  const [publishedEntityNames, setPublishedEntityNames] = useState<PublishedEntityName[]>([])
  const [openEntity, setOpenEntity] = useState<{ type: PublishedType; entity: PublishedEntity } | null>(null)
  const [openEntityLoading, setOpenEntityLoading] = useState(false)

  // Progress tracking
  const contentRef = useRef<HTMLDivElement>(null)
  const [progress, setProgress] = useState(0)
  const progressRef = useRef(0)
  const [isBookmarked, setIsBookmarked] = useState(false)

  // Bookmark management
  const bookmarkKey = `bobbinry-bookmark-${chapterId}`

  const saveBookmark = useCallback(() => {
    const scrollPercent = progress
    localStorage.setItem(bookmarkKey, JSON.stringify({ progress: scrollPercent, savedAt: Date.now() }))
    setIsBookmarked(true)
  }, [bookmarkKey, progress])

  const removeBookmark = useCallback(() => {
    localStorage.removeItem(bookmarkKey)
    setIsBookmarked(false)
  }, [bookmarkKey])

  const restoreBookmark = useCallback(() => {
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
  }, [bookmarkKey])

  // Check for existing bookmark on mount
  useEffect(() => {
    const saved = localStorage.getItem(bookmarkKey)
    // eslint-disable-next-line react-hooks/set-state-in-effect -- hydration bridge
    setIsBookmarked(!!saved)
  }, [bookmarkKey])

  const loadChapter = useCallback(async () => {
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

      const userId = sessionUserId
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
    } catch {
      setError('Failed to load chapter')
    } finally {
      setLoading(false)
    }
  }, [authorUsername, projectSlug, chapterId, sessionUserId])

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- initial fetch
    loadChapter()
  }, [loadChapter])

  // Load annotation access separately — session loads async after chapter
  useEffect(() => {
    if (!session?.apiToken || !projectId) return
    const headers = { Authorization: `Bearer ${session.apiToken}` }

    fetch(`${config.apiUrl}/api/public/projects/${projectId}/can-annotate`, { headers })
      .then(res => res.ok ? res.json() : null)
      .then(data => {
        if (!data) return
        setCanAnnotate(data.canAnnotate)
        if (data.canAnnotate) {
          fetch(`${config.apiUrl}/api/public/chapters/${chapterId}/annotations`, { headers })
            .then(res => res.ok ? res.json() : null)
            .then(annData => {
              if (annData) setAnnotations(annData.annotations || [])
            })
        }
      })
      .catch(() => {})
  }, [session?.apiToken, projectId, chapterId])

  useEffect(() => {
    // Load remaining preferences from localStorage
    const saved = localStorage.getItem('bobbinry-reader-prefs')
    if (saved) {
      try {
        const prefs = JSON.parse(saved)
        /* eslint-disable react-hooks/set-state-in-effect -- hydration bridge */
        if (prefs.fontSize) setFontSize(prefs.fontSize)
        if (prefs.readerWidth) setReaderWidth(prefs.readerWidth)
        if (prefs.entityHighlightStyle === 'highlight' || prefs.entityHighlightStyle === 'underline' || prefs.entityHighlightStyle === 'off') {
          setEntityHighlightStyle(prefs.entityHighlightStyle)
        }
        /* eslint-enable react-hooks/set-state-in-effect */
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
    if (loading || !chapter) return

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
  }, [loading, chapter])

  // Keep ref in sync for sendBeacon on unmount
  useEffect(() => { progressRef.current = progress }, [progress])

  // Save progress periodically (debounced) and on page leave
  useEffect(() => {
    if (!projectId || !session?.user?.id || progress === 0) return

    const saveProgress = () => {
      fetch(`${config.apiUrl}/api/public/projects/${projectId}/chapters/${chapterId}/view`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId: session.user.id,
          position: progress,
          deviceType: window.innerWidth < 768 ? 'mobile' : window.innerWidth < 1024 ? 'tablet' : 'desktop'
        })
      }).catch(() => {})
    }

    const timer = setTimeout(saveProgress, 3000)
    return () => clearTimeout(timer)
  }, [progress, projectId, chapterId, session?.user?.id])

  // Save progress when leaving the page (back button, link click, tab close)
  useEffect(() => {
    if (!projectId || !session?.user?.id) return

    const saveOnLeave = () => {
      if (progressRef.current === 0) return
      const data = JSON.stringify({
        userId: session.user.id,
        position: progressRef.current,
        deviceType: window.innerWidth < 768 ? 'mobile' : window.innerWidth < 1024 ? 'tablet' : 'desktop'
      })
      navigator.sendBeacon(
        `${config.apiUrl}/api/public/projects/${projectId}/chapters/${chapterId}/view`,
        new Blob([data], { type: 'application/json' })
      )
    }

    window.addEventListener('beforeunload', saveOnLeave)
    return () => {
      window.removeEventListener('beforeunload', saveOnLeave)
      saveOnLeave()  // Also fire on component unmount (SPA navigation)
    }
  }, [projectId, chapterId, session?.user?.id])

  // Apply annotation highlights to rendered chapter content
  const applyHighlights = useCallback(() => {
    const proseEl = chapterContentRef.current
    if (!proseEl || annotations.length === 0) return

    // Skip if already applied (check for existing marks)
    if (proseEl.querySelectorAll('mark[data-annotation-id]').length > 0) return

    // Clean up previous highlights (safety)
    proseEl.querySelectorAll('mark[data-annotation-id]').forEach(el => {
      const parent = el.parentNode
      if (parent) {
        parent.replaceChild(document.createTextNode(el.textContent || ''), el)
        parent.normalize()
      }
    })

    // Theme-aware highlight colors (inline styles, not Tailwind dark: which doesn't match reader theme)
    const dark = readerTheme === 'dark'
    const highlightColors = {
      error: dark ? 'rgba(239,68,68,0.2)' : 'rgba(239,68,68,0.15)',
      suggestion: dark ? 'rgba(59,130,246,0.2)' : 'rgba(59,130,246,0.15)',
      feedback: dark ? 'rgba(234,179,8,0.2)' : 'rgba(234,179,8,0.15)'
    }

    // Apply new highlights
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

  }, [annotations, readerTheme])

  // Apply highlights when annotations or chapter change
  useEffect(() => {
    applyHighlights()
  }, [applyHighlights, chapter])

  // Re-apply highlights when React re-renders the content (e.g., tab focus/blur)
  useEffect(() => {
    const proseEl = chapterContentRef.current
    if (!proseEl || annotations.length === 0) return

    const observer = new MutationObserver(() => {
      // React re-rendered the innerHTML, wiping our marks — reapply
      if (proseEl.querySelectorAll('mark[data-annotation-id]').length === 0) {
        applyHighlights()
      }
    })
    observer.observe(proseEl, { childList: true })
    return () => observer.disconnect()
  }, [annotations, applyHighlights])

  // --- Entity highlights ---
  // Fetch the list of published entity names once per chapter — used to wrap
  // matches in the prose with clickable highlight spans.
  useEffect(() => {
    if (!projectId) return
    let cancelled = false
    const headers: Record<string, string> = {}
    if (session?.apiToken) headers['Authorization'] = `Bearer ${session.apiToken}`
    fetch(`${config.apiUrl}/api/public/projects/${projectId}/entities/published-names`, { headers })
      .then(r => (r.ok ? r.json() : null))
      .then(d => {
        if (!cancelled && d?.installed && Array.isArray(d.entities)) {
          setPublishedEntityNames(d.entities)
        }
      })
      .catch(() => {})
    return () => { cancelled = true }
  }, [projectId, session?.apiToken])

  // Build + apply entity highlight spans after the chapter renders. Runs
  // AFTER the annotation pass so we don't wrap annotation-marked text.
  const applyEntityHighlights = useCallback(() => {
    const proseEl = chapterContentRef.current
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

    if (entityHighlightStyle === 'off' || publishedEntityNames.length === 0) return

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
        span.className = `entity-highlight entity-highlight--${entityHighlightStyle}`
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
  }, [publishedEntityNames, entityHighlightStyle])

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
    const proseEl = chapterContentRef.current
    if (!proseEl) return
    const observer = new MutationObserver(() => {
      if (publishedEntityNames.length === 0 || entityHighlightStyle === 'off') return
      if (proseEl.querySelector('span[data-entity-id]')) return // already applied
      applyEntityHighlights()
    })
    observer.observe(proseEl, { childList: true, subtree: false })
    return () => observer.disconnect()
  }, [applyEntityHighlights, publishedEntityNames.length, entityHighlightStyle, loading])

  // Delegated click handler: open the entity modal when any highlight span
  // is activated. Uses the first id when multiple entities share the name.
  useEffect(() => {
    const proseEl = chapterContentRef.current
    if (!proseEl || !projectId) return

    async function openEntityById(entityId: string) {
      setOpenEntityLoading(true)
      try {
        const headers: Record<string, string> = {}
        if (session?.apiToken) headers['Authorization'] = `Bearer ${session.apiToken}`
        const res = await fetch(
          `${config.apiUrl}/api/public/projects/${projectId}/entities/${entityId}`,
          { headers }
        )
        if (!res.ok) return
        const data = await res.json()
        setOpenEntity({ type: data.type, entity: data.entity })
      } catch {
        // swallow — noisy toast isn't worth it for a tap-to-preview
      } finally {
        setOpenEntityLoading(false)
      }
    }

    function handle(e: Event) {
      const target = (e.target as HTMLElement | null)?.closest('[data-entity-id]') as HTMLElement | null
      if (!target) return
      const idAttr = target.getAttribute('data-entity-id')
      if (!idAttr) return
      e.preventDefault()
      const firstId = idAttr.split(',')[0]
      if (firstId) openEntityById(firstId)
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
  }, [projectId, session?.apiToken, loading])

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

  const [replyingTo, setReplyingTo] = useState<string | null>(null)
  const [replyContent, setReplyContent] = useState('')

  const postComment = async (parentId?: string) => {
    const content = parentId ? replyContent : newComment
    if (!session?.apiToken || !content.trim()) return
    try {
      const res = await fetch(`${config.apiUrl}/api/public/chapters/${chapterId}/comments`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${session.apiToken}`
        },
        body: JSON.stringify({ content: content.trim(), parentId: parentId || undefined })
      })
      if (res.ok) {
        if (parentId) {
          setReplyContent('')
          setReplyingTo(null)
        } else {
          setNewComment('')
        }
        // Reload comments
        const cRes = await fetch(`${config.apiUrl}/api/public/chapters/${chapterId}/comments`)
        if (cRes.ok) {
          const data = await cRes.json()
          setCommentsList(data.comments || [])
        }
      }
    } catch {}
  }

  const submitAnnotation = async (data: {
    anchor: TextAnchor
    annotationType: string
    errorCategory?: string
    content: string
    suggestedText?: string
  }) => {
    if (!session?.apiToken || !projectId) return
    const res = await fetch(`${config.apiUrl}/api/public/chapters/${chapterId}/annotations`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${session.apiToken}`
      },
      body: JSON.stringify({
        projectId,
        anchorParagraphIndex: data.anchor.paragraphIndex,
        anchorQuote: data.anchor.quote,
        anchorCharOffset: data.anchor.charOffset,
        anchorCharLength: data.anchor.charLength,
        annotationType: data.annotationType,
        errorCategory: data.errorCategory,
        content: data.content,
        suggestedText: data.suggestedText,
        chapterVersion: 1 // TODO: track actual entity version
      })
    })
    if (res.ok) {
      setPendingAnchor(null)
      // Reload annotations
      const annRes = await fetch(`${config.apiUrl}/api/public/chapters/${chapterId}/annotations`, {
        headers: { Authorization: `Bearer ${session.apiToken}` }
      })
      if (annRes.ok) {
        const annData = await annRes.json()
        setAnnotations(annData.annotations || [])
      }
    }
  }

  const deleteAnnotation = async (annotationId: string) => {
    if (!session?.apiToken) return
    await fetch(`${config.apiUrl}/api/public/chapters/${chapterId}/annotations/${annotationId}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${session.apiToken}` }
    })
    setAnnotations(prev => prev.filter(a => a.id !== annotationId))
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
    const isTierLocked = error === 'Chapter not yet available for your tier'
    return (
      <div className="min-h-screen bg-gray-50 dark:bg-gray-950">
        <ReaderNav crumbs={[
          { label: authorDisplayName || authorUsername, href: `/read/${authorUsername}` },
          { label: projectName || projectSlug, href: basePath }
        ]} />
        <div className="flex items-center justify-center py-32">
          <div className="text-center max-w-md">
            <h1 className="text-xl font-bold text-gray-900 dark:text-gray-100 mb-2">
              {isTierLocked ? 'Chapter not available at your tier' : error}
            </h1>
            {isTierLocked ? (
              <p className="text-gray-500 dark:text-gray-400 mb-4">
                Subscribe or upgrade now to read instantly.
              </p>
            ) : null}
            {embargoUntil && (
              <p className="text-gray-500 dark:text-gray-400 mb-4">
                Available on {new Date(embargoUntil).toLocaleDateString()}
              </p>
            )}
            <div className="flex items-center justify-center gap-4">
              {isTierLocked ? (
                <Link href={`${basePath}#support`} className="text-blue-600 dark:text-blue-400 hover:underline">
                  Subscribe or Upgrade
                </Link>
              ) : null}
              <Link href={basePath} className="text-blue-600 dark:text-blue-400 hover:underline">
                Back to Table of Contents
              </Link>
            </div>
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

      {/* Reader settings bar + reader toolbar extensions */}
      <div className={`border-b ${borderColor} bg-inherit`}>
        <div className={`${WIDTHS[readerWidth]} mx-auto px-4 py-1.5 flex items-center justify-between`}>
          {/* Reader bobbin toolbar actions */}
          <ExtensionSlot
            slotId="reader.toolbar"
            context={{ chapterId, projectId, readerTheme }}
            className="flex items-center gap-2"
            fallback={<span />}
          />
          <div className="flex items-center gap-1">
            {/* Bookmark button */}
            <button
              onClick={isBookmarked ? removeBookmark : saveBookmark}
              className={`p-1.5 rounded ${hoverBg} transition-colors`}
              title={isBookmarked ? 'Remove bookmark' : 'Bookmark this position'}
            >
              <svg className={`w-4 h-4 ${isBookmarked ? 'text-blue-500 fill-current' : mutedText}`} fill={isBookmarked ? 'currentColor' : 'none'} stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 5a2 2 0 012-2h10a2 2 0 012 2v16l-7-3.5L5 21V5z" />
              </svg>
            </button>
            {/* Restore bookmark */}
            {isBookmarked && (
              <button
                onClick={restoreBookmark}
                className={`p-1.5 rounded ${hoverBg} transition-colors`}
                title="Jump to bookmark"
              >
                <svg className={`w-4 h-4 ${mutedText}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7l5 5m0 0l-5 5m5-5H6" />
                </svg>
              </button>
            )}
            {/* Annotation sidebar toggle */}
            {canAnnotate && (
              <button
                onClick={() => setShowAnnotationSidebar(!showAnnotationSidebar)}
                className={`p-1.5 rounded ${hoverBg} transition-colors relative`}
                title={showAnnotationSidebar ? 'Hide feedback panel' : 'Show feedback panel'}
              >
                <svg className={`w-4 h-4 ${showAnnotationSidebar ? 'text-blue-500' : mutedText}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 8h10M7 12h4m1 8l-4-4H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-3l-4 4z" />
                </svg>
                {annotations.length > 0 && (
                  <span className="absolute -top-0.5 -right-0.5 w-3.5 h-3.5 text-[9px] font-bold rounded-full bg-blue-600 text-white flex items-center justify-center">
                    {annotations.length}
                  </span>
                )}
              </button>
            )}
            {/* Settings toggle */}
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
              {publishedEntityNames.length > 0 && (
                <div>
                  <span className={`text-xs ${mutedText} block mb-1`}>Entities</span>
                  <div className="flex gap-1">
                    {([
                      { id: 'highlight' as const, label: 'Highlight' },
                      { id: 'underline' as const, label: 'Underline' },
                      { id: 'off' as const, label: 'Off' },
                    ]).map(opt => (
                      <button
                        key={opt.id}
                        onClick={() => { setEntityHighlightStyle(opt.id); savePrefs('entityHighlightStyle', opt.id) }}
                        className={`px-2 py-1 rounded text-xs ${entityHighlightStyle === opt.id ? activeBg : hoverBg}`}
                      >
                        {opt.label}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Styles for entity highlights applied post-render. Scoped to the
          reader page so editor + other prose areas are untouched. Kept in
          sync with the reader themes (light/dark/sepia) by reading from CSS
          variables on the containing theme wrapper. */}
      <style>{`
        .entity-highlight {
          cursor: pointer;
          transition: background-color 120ms ease, border-color 120ms ease;
        }
        .entity-highlight--highlight {
          background-color: rgba(147, 51, 234, 0.14);
          border-radius: 2px;
          padding: 0 2px;
        }
        .entity-highlight--highlight:hover,
        .entity-highlight--highlight:focus {
          background-color: rgba(147, 51, 234, 0.28);
          outline: none;
        }
        .entity-highlight--underline {
          border-bottom: 1px dotted rgba(147, 51, 234, 0.6);
        }
        .entity-highlight--underline:hover,
        .entity-highlight--underline:focus {
          border-bottom-color: rgba(147, 51, 234, 1);
          background-color: rgba(147, 51, 234, 0.1);
          outline: none;
        }
      `}</style>

      {/* Chapter content + annotation sidebar layout */}
      <div className="flex justify-center">
        <div ref={contentRef} className={`${WIDTHS[readerWidth]} flex-1 min-w-0 px-4 py-8`}>
          <h1 className="font-display text-3xl font-bold mb-6">{chapter.title}</h1>

          <div
            ref={chapterContentRef}
            className={`${FONT_SIZES[fontSize]} prose ${proseClass} max-w-none`}
            dangerouslySetInnerHTML={getSanitizedHtmlProps(chapter.content)}
          />

          {/* Annotation selection popover */}
          {canAnnotate && (
            <AnnotationSelectionPopover
              contentRef={contentRef}
              onAnnotate={setPendingAnchor}
              isDark={isDark}
              isSepia={isSepia}
            />
          )}

          {/* Annotation form modal */}
          {pendingAnchor && (
            <AnnotationForm
              anchor={pendingAnchor}
              onSubmit={submitAnnotation}
              onClose={() => setPendingAnchor(null)}
              isDark={isDark}
              isSepia={isSepia}
            />
          )}

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

          {/* Reader bobbin after-chapter panels */}
          <ExtensionSlot
            slotId="reader.afterChapter"
            context={{ chapterId, projectId, readerTheme }}
            className={`mt-8 pt-6 border-t ${borderColor} space-y-4`}
            fallback={null}
          />

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
                    onClick={() => postComment()}
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

            {/* Threaded comment list */}
            <div className="space-y-4">
              {commentsList.map(comment => (
                <CommentThread
                  key={comment.id}
                  comment={comment}
                  depth={0}
                  isDark={isDark}
                  isSepia={isSepia}
                  mutedText={mutedText}
                  borderColor={borderColor}
                  isLoggedIn={!!session?.user}
                  replyingTo={replyingTo}
                  replyContent={replyContent}
                  onSetReplyingTo={setReplyingTo}
                  onSetReplyContent={setReplyContent}
                  onPostReply={postComment}
                />
              ))}
            </div>
          </div>
        </div>

        {/* Annotation sidebar */}
        {canAnnotate && showAnnotationSidebar && (
          <div className={`w-72 flex-shrink-0 border-l ${borderColor} overflow-y-auto max-h-screen sticky top-8 hidden lg:block`}>
            <div className="p-3">
              <h3 className="text-sm font-semibold mb-3">Your Feedback ({annotations.length})</h3>
              {annotations.length === 0 ? (
                <p className={`text-xs ${mutedText}`}>Select text in the chapter to add feedback.</p>
              ) : (
                <div className="space-y-2">
                  {annotations.map(ann => (
                    <div
                      key={ann.id}
                      className={`p-2 rounded border text-xs ${isDark ? 'border-gray-700 bg-gray-800/50' : isSepia ? 'border-amber-200 bg-amber-100/50' : 'border-gray-200 bg-gray-50'}`}
                    >
                      <div className="flex items-center justify-between mb-1">
                        <span className={`font-medium px-1.5 py-0.5 rounded text-[10px] ${
                          ann.annotationType === 'error' ? 'bg-red-100 text-red-700 dark:bg-red-900/50 dark:text-red-300'
                            : ann.annotationType === 'suggestion' ? 'bg-blue-100 text-blue-700 dark:bg-blue-900/50 dark:text-blue-300'
                              : 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/50 dark:text-yellow-300'
                        }`}>
                          {ann.annotationType}{ann.errorCategory ? `: ${ann.errorCategory}` : ''}
                        </span>
                        <span className={`text-[10px] ${mutedText}`}>
                          {ann.status}
                        </span>
                      </div>
                      <div className={`italic ${mutedText} line-clamp-2 mb-1`}>
                        &ldquo;{ann.anchorQuote}&rdquo;
                      </div>
                      <div className="mb-1.5">{ann.content}</div>
                      {ann.authorResponse && (
                        <div className={`pl-2 border-l-2 ${isDark ? 'border-blue-700' : 'border-blue-300'} ${mutedText} mt-1`}>
                          <span className="font-medium">Author:</span> {ann.authorResponse}
                        </div>
                      )}
                      {ann.status === 'open' && (
                        <button
                          onClick={() => deleteAnnotation(ann.id)}
                          className={`text-[10px] ${mutedText} hover:text-red-500 mt-1`}
                        >
                          Delete
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {openEntity && (
        <EntityModal
          type={openEntity.type}
          entity={openEntity.entity}
          subpageHref={`/read/${authorUsername}/${projectSlug}/entity/${openEntity.entity.id}`}
          onClose={() => setOpenEntity(null)}
        />
      )}
      {openEntityLoading && !openEntity && (
        <div className="fixed inset-0 z-40 pointer-events-none flex items-start justify-center p-8">
          <div className="rounded-full bg-black/60 px-3 py-1.5 text-xs font-medium text-white shadow-lg">
            Loading entity…
          </div>
        </div>
      )}
    </div>
  )
}
