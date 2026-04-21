'use client'

import { useState, useEffect, useCallback, Suspense } from 'react'
import { useParams, useSearchParams } from 'next/navigation'
import { useSession } from 'next-auth/react'
import Link from 'next/link'
import { SiteNav } from '@/components/SiteNav'
import { apiFetch } from '@/lib/api'

interface Annotation {
  id: string
  chapterId: string
  chapterTitle: string | null
  authorId: string
  authorName: string
  anchorParagraphIndex: number | null
  anchorQuote: string
  annotationType: string
  errorCategory: string | null
  content: string
  suggestedText: string | null
  anchorContext: string | null
  status: string
  authorResponse: string | null
  resolvedAt: string | null
  chapterVersion: number
  createdAt: string
  updatedAt: string
}

interface ChapterOption {
  chapterId: string
  chapterTitle: string | null
  count: number
}

interface Stats {
  byStatus: { status: string; count: number }[]
  byType: { annotationType: string; count: number }[]
  byChapter: { chapterId: string; count: number }[]
}

const STATUS_STYLES: Record<string, { bg: string; dot: string; label: string }> = {
  open: { bg: 'bg-orange-50 text-orange-700 dark:bg-orange-900/20 dark:text-orange-300', dot: 'bg-orange-400', label: 'Open' },
  acknowledged: { bg: 'bg-blue-50 text-blue-700 dark:bg-blue-900/20 dark:text-blue-300', dot: 'bg-blue-400', label: 'Acknowledged' },
  resolved: { bg: 'bg-green-50 text-green-700 dark:bg-green-900/20 dark:text-green-300', dot: 'bg-green-400', label: 'Resolved' },
  dismissed: { bg: 'bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-400', dot: 'bg-gray-400', label: 'Dismissed' }
}

const TYPE_STYLES: Record<string, { bg: string; icon: string }> = {
  error: { bg: 'bg-red-50 text-red-700 border-red-200 dark:bg-red-900/15 dark:text-red-300 dark:border-red-800', icon: '\u26A0' },
  suggestion: { bg: 'bg-blue-50 text-blue-700 border-blue-200 dark:bg-blue-900/15 dark:text-blue-300 dark:border-blue-800', icon: '\uD83D\uDCA1' },
  feedback: { bg: 'bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-900/15 dark:text-amber-300 dark:border-amber-800', icon: '\uD83D\uDCAC' }
}

export default function FeedbackDashboardPage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen bg-gray-50 dark:bg-gray-950">
        <SiteNav />
        <div className="max-w-5xl mx-auto px-4 py-8">
          <div className="animate-pulse h-8 bg-gray-200 dark:bg-gray-700 rounded w-48 mb-6" />
          <div className="grid grid-cols-4 gap-2 mb-6">
            {[1, 2, 3, 4].map(i => <div key={i} className="animate-pulse h-16 bg-gray-200 dark:bg-gray-700 rounded-lg" />)}
          </div>
        </div>
      </div>
    }>
      <FeedbackDashboardContent />
    </Suspense>
  )
}

function FeedbackDashboardContent() {
  const params = useParams()
  const searchParams = useSearchParams()
  const { data: session } = useSession()
  const projectId = params.projectId as string

  const [annotations, setAnnotations] = useState<Annotation[]>([])
  const [chapters, setChapters] = useState<ChapterOption[]>([])
  const [readerBaseUrl, setReaderBaseUrl] = useState<string | null>(null)
  const [stats, setStats] = useState<Stats | null>(null)
  const [loading, setLoading] = useState(true)
  const [total, setTotal] = useState(0)
  const [statusFilter, setStatusFilter] = useState<string>('')
  const [typeFilter, setTypeFilter] = useState<string>('')
  const [chapterFilter, setChapterFilter] = useState<string>(searchParams.get('chapterId') || '')
  const [respondingTo, setRespondingTo] = useState<string | null>(null)
  const [responseText, setResponseText] = useState('')
  const [confirmingAccept, setConfirmingAccept] = useState<string | null>(null)
  const [acceptError, setAcceptError] = useState<string | null>(null)

  const loadData = useCallback(async () => {
    const token = session?.apiToken
    if (!token) return
    setLoading(true)
    try {
      const qp = new URLSearchParams()
      if (statusFilter) qp.set('status', statusFilter)
      if (typeFilter) qp.set('annotationType', typeFilter)
      if (chapterFilter) qp.set('chapterId', chapterFilter)
      qp.set('limit', '100')

      const [annRes, statsRes] = await Promise.all([
        apiFetch(`/api/projects/${projectId}/annotations?${qp}`, token),
        apiFetch(`/api/projects/${projectId}/annotations/stats`, token)
      ])

      if (annRes.ok) {
        const data = await annRes.json()
        setAnnotations(data.annotations || [])
        setChapters(data.chapters || [])
        setReaderBaseUrl(data.readerBaseUrl || null)
        setTotal(data.total ?? 0)
      }
      if (statsRes.ok) {
        const data = await statsRes.json()
        setStats(data)
      }
    } catch (err) {
      console.error('Failed to load feedback:', err)
    } finally {
      setLoading(false)
    }
  }, [projectId, session?.apiToken, statusFilter, typeFilter, chapterFilter])

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- initial fetch
    if (session?.apiToken) loadData()
  }, [session?.apiToken, loadData])

  const updateStatus = async (annotationId: string, newStatus: string, response?: string) => {
    const token = session?.apiToken
    if (!token) return
    const res = await apiFetch(`/api/projects/${projectId}/annotations/${annotationId}/status`, token, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: newStatus, authorResponse: response })
    })
    if (res.ok) {
      const data = await res.json()
      setAnnotations(prev => prev.map(a => a.id === annotationId ? { ...a, ...data.annotation } : a))
      setRespondingTo(null)
      setResponseText('')
    }
  }

  const acceptSuggestion = async (annotationId: string) => {
    const token = session?.apiToken
    if (!token) return
    setAcceptError(null)
    const res = await apiFetch(`/api/projects/${projectId}/annotations/${annotationId}/accept`, token, {
      method: 'POST'
    })
    if (res.ok) {
      const data = await res.json()
      setAnnotations(prev => prev.map(a => a.id === annotationId ? { ...a, ...data.annotation } : a))
    } else {
      const err = await res.json().catch(() => ({ error: 'Failed to accept' }))
      setAcceptError(err.error || 'Failed to apply suggestion')
      setTimeout(() => setAcceptError(null), 5000)
    }
  }

  const getStatCount = (key: string, collection: { status?: string; count: number }[] | undefined) => {
    if (!collection) return 0
    return collection.find(s => s.status === key)?.count ?? 0
  }

  const activeFilterCount = [statusFilter, typeFilter, chapterFilter].filter(Boolean).length

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-950">
      <SiteNav />
      <div className="max-w-5xl mx-auto px-4 py-8">
        {/* Header */}
        <div className="mb-6">
          <Link href={`/projects/${projectId}`} className="text-sm text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 transition-colors mb-2 inline-flex items-center gap-1">
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
            Dashboard
          </Link>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">Reader Feedback</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
            Annotations, suggestions, and error reports from your readers
          </p>
        </div>

        {/* Stats row */}
        {stats && (
          <div className="grid grid-cols-4 gap-2 mb-6">
            {(['open', 'acknowledged', 'resolved', 'dismissed'] as const).map(status => {
              const s = STATUS_STYLES[status]!
              const c = getStatCount(status, stats.byStatus)
              const active = statusFilter === status
              return (
                <button
                  key={status}
                  onClick={() => setStatusFilter(active ? '' : status)}
                  className={`relative p-3 rounded-lg border text-left transition-all ${
                    active
                      ? 'border-blue-400 ring-1 ring-blue-400/30 dark:border-blue-500'
                      : 'border-gray-200 dark:border-gray-800 hover:border-gray-300 dark:hover:border-gray-700'
                  } bg-white dark:bg-gray-900`}
                >
                  <div className="flex items-center gap-1.5 mb-1">
                    <span className={`w-2 h-2 rounded-full ${s.dot}`} />
                    <span className="text-[11px] font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wide">{s.label}</span>
                  </div>
                  <div className="text-xl font-bold text-gray-900 dark:text-gray-100">{c}</div>
                </button>
              )
            })}
          </div>
        )}

        {/* Filter bar */}
        <div className="flex flex-wrap items-center gap-2 mb-5 p-3 rounded-lg bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800">
          {/* Chapter filter */}
          <div className="flex items-center gap-1.5">
            <svg className="w-3.5 h-3.5 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" />
            </svg>
            <select
              value={chapterFilter}
              onChange={e => setChapterFilter(e.target.value)}
              className="text-xs bg-transparent border-none text-gray-700 dark:text-gray-300 cursor-pointer focus:ring-0 pr-6"
            >
              <option value="">All chapters</option>
              {chapters.map(ch => (
                <option key={ch.chapterId} value={ch.chapterId}>
                  {ch.chapterTitle || 'Untitled'} ({ch.count})
                </option>
              ))}
            </select>
          </div>

          <span className="text-gray-300 dark:text-gray-700">|</span>

          {/* Type filter */}
          <div className="flex items-center gap-1">
            {(['', 'error', 'suggestion', 'feedback'] as const).map(type => (
              <button
                key={type}
                onClick={() => setTypeFilter(typeFilter === type ? '' : type)}
                className={`px-2 py-1 text-xs rounded-md transition-colors ${
                  typeFilter === type
                    ? 'bg-gray-900 text-white dark:bg-gray-100 dark:text-gray-900'
                    : 'text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800'
                }`}
              >
                {type ? `${TYPE_STYLES[type]?.icon || ''} ${type}` : 'All types'}
              </button>
            ))}
          </div>

          {/* Clear + count */}
          <div className="flex items-center gap-2 ml-auto">
            {activeFilterCount > 0 && (
              <button
                onClick={() => { setStatusFilter(''); setTypeFilter(''); setChapterFilter('') }}
                className="text-xs text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 flex items-center gap-1"
              >
                Clear filters
                <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            )}
            <span className="text-xs text-gray-400 tabular-nums">{total} result{total !== 1 ? 's' : ''}</span>
          </div>
        </div>

        {/* Error banner */}
        {acceptError && (
          <div className="mb-4 px-4 py-2.5 rounded-lg border border-red-200 bg-red-50 dark:border-red-800 dark:bg-red-900/20 flex items-center justify-between">
            <span className="text-sm text-red-700 dark:text-red-300">{acceptError}</span>
            <button onClick={() => setAcceptError(null)} className="text-red-400 hover:text-red-600 dark:hover:text-red-200">
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        )}

        {/* Annotation list */}
        {loading ? (
          <div className="space-y-3">
            {[1, 2, 3].map(i => (
              <div key={i} className="animate-pulse p-4 rounded-lg border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900">
                <div className="h-3 bg-gray-200 dark:bg-gray-700 rounded w-1/3 mb-3" />
                <div className="h-4 bg-gray-100 dark:bg-gray-800 rounded w-full mb-2" />
                <div className="h-3 bg-gray-100 dark:bg-gray-800 rounded w-2/3" />
              </div>
            ))}
          </div>
        ) : annotations.length === 0 ? (
          <div className="text-center py-16 px-4">
            <div className="text-3xl mb-3">
              {activeFilterCount > 0 ? '\uD83D\uDD0D' : '\uD83D\uDCAC'}
            </div>
            <p className="text-gray-600 dark:text-gray-400 font-medium">
              {activeFilterCount > 0 ? 'No feedback matches your filters' : 'No feedback yet'}
            </p>
            <p className="text-sm text-gray-400 dark:text-gray-500 mt-1 max-w-sm mx-auto">
              {activeFilterCount > 0
                ? 'Try adjusting or clearing your filters.'
                : 'When readers leave annotations on your chapters, they\'ll appear here.'}
            </p>
            {activeFilterCount > 0 && (
              <button
                onClick={() => { setStatusFilter(''); setTypeFilter(''); setChapterFilter('') }}
                className="mt-3 text-sm text-blue-600 dark:text-blue-400 hover:underline"
              >
                Clear all filters
              </button>
            )}
          </div>
        ) : (
          <div className="space-y-3">
            {annotations.map(ann => {
              const typeStyle = TYPE_STYLES[ann.annotationType]
              const statusStyle = STATUS_STYLES[ann.status]
              const readerUrl = readerBaseUrl ? `${readerBaseUrl}/${ann.chapterId}` : null

              return (
                <div
                  key={ann.id}
                  className={`rounded-lg border bg-white dark:bg-gray-900 overflow-hidden transition-colors ${
                    ann.status === 'resolved' || ann.status === 'dismissed'
                      ? 'border-gray-100 dark:border-gray-800/50 opacity-75'
                      : 'border-gray-200 dark:border-gray-800'
                  }`}
                >
                  {/* Card header: chapter + meta */}
                  <div className="flex items-center justify-between px-4 pt-3 pb-2">
                    <div className="flex items-center gap-2 min-w-0">
                      {/* Chapter name as link */}
                      {readerUrl ? (
                        <a
                          href={readerUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-xs font-medium text-gray-600 dark:text-gray-300 hover:text-blue-600 dark:hover:text-blue-400 transition-colors truncate flex items-center gap-1"
                          title={`View "${ann.chapterTitle}" on reader page`}
                        >
                          <svg className="w-3 h-3 flex-shrink-0 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" />
                          </svg>
                          {ann.chapterTitle || 'Untitled'}
                          <svg className="w-2.5 h-2.5 flex-shrink-0 opacity-50" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                          </svg>
                        </a>
                      ) : (
                        <span className="text-xs font-medium text-gray-500 dark:text-gray-400 truncate">
                          {ann.chapterTitle || 'Untitled'}
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-2 flex-shrink-0">
                      <span className={`inline-flex items-center gap-1 text-[11px] font-medium px-1.5 py-0.5 rounded ${statusStyle?.bg || ''}`}>
                        <span className={`w-1.5 h-1.5 rounded-full ${statusStyle?.dot || ''}`} />
                        {statusStyle?.label || ann.status}
                      </span>
                      <span className="text-[11px] text-gray-400 dark:text-gray-500">
                        {ann.authorName} &middot; {new Date(ann.createdAt).toLocaleDateString()}
                      </span>
                    </div>
                  </div>

                  {/* Card body */}
                  <div className="px-4 pb-3">
                    {/* Type badge + context with highlighted quote */}
                    <div className={`flex items-start gap-2 p-2.5 rounded-md border mb-2.5 ${typeStyle?.bg || 'bg-gray-50 border-gray-200 dark:bg-gray-800 dark:border-gray-700'}`}>
                      <span className="text-sm flex-shrink-0 mt-0.5">{typeStyle?.icon || ''}</span>
                      <div className="min-w-0">
                        <div className="text-[11px] font-medium uppercase tracking-wide mb-0.5 opacity-70">
                          {ann.annotationType}{ann.errorCategory ? ` / ${ann.errorCategory}` : ''}
                        </div>
                        <div className="text-sm leading-snug">
                          {ann.anchorContext ? (() => {
                            const idx = ann.anchorContext.indexOf(ann.anchorQuote)
                            if (idx === -1) {
                              // Quote not found in context — show both
                              return (
                                <>
                                  <span className="opacity-60">{ann.anchorContext}</span>
                                  <div className="mt-1 italic">&ldquo;{ann.anchorQuote}&rdquo;</div>
                                </>
                              )
                            }
                            const before = ann.anchorContext.slice(Math.max(0, idx - 80), idx)
                            const after = ann.anchorContext.slice(idx + ann.anchorQuote.length, idx + ann.anchorQuote.length + 80)
                            return (
                              <span className="opacity-70">
                                {idx > 80 && '...'}
                                {before}
                                <mark className="font-medium opacity-100 rounded-sm px-0.5" style={{ backgroundColor: 'rgba(250, 204, 21, 0.25)', color: 'inherit', textDecoration: 'underline', textDecorationStyle: 'wavy', textDecorationColor: 'rgba(250, 204, 21, 0.6)', textUnderlineOffset: '3px' }}>
                                  {ann.anchorQuote}
                                </mark>
                                {after}
                                {idx + ann.anchorQuote.length + 80 < ann.anchorContext.length && '...'}
                              </span>
                            )
                          })() : (
                            <span className="italic">&ldquo;{ann.anchorQuote}&rdquo;</span>
                          )}
                        </div>
                      </div>
                    </div>

                    {/* Reader's note */}
                    <p className="text-sm text-gray-800 dark:text-gray-200 leading-relaxed">{ann.content}</p>

                    {/* Suggested replacement */}
                    {ann.suggestedText && (
                      <div className="mt-2 flex items-start gap-2 text-sm">
                        <span className="text-blue-500 flex-shrink-0 mt-0.5">
                          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 8h10M7 12h4m1 8l-4-4H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-3l-4 4z" />
                          </svg>
                        </span>
                        <span className="text-blue-700 dark:text-blue-300">
                          Suggested: &ldquo;{ann.suggestedText}&rdquo;
                        </span>
                      </div>
                    )}

                    {/* Author response */}
                    {ann.authorResponse && (
                      <div className="mt-2 pl-3 border-l-2 border-green-300 dark:border-green-700">
                        <div className="text-[11px] font-medium text-gray-400 dark:text-gray-500 mb-0.5">Your response</div>
                        <p className="text-sm text-gray-600 dark:text-gray-300">{ann.authorResponse}</p>
                      </div>
                    )}

                    {/* Actions */}
                    <div className="flex items-center gap-1.5 mt-3 pt-2.5 border-t border-gray-100 dark:border-gray-800">
                      {ann.status === 'open' && (
                        <button
                          onClick={() => updateStatus(ann.id, 'acknowledged')}
                          className="text-xs px-2.5 py-1 rounded-md font-medium bg-blue-50 text-blue-600 hover:bg-blue-100 dark:bg-blue-900/30 dark:text-blue-400 dark:hover:bg-blue-900/50 transition-colors"
                        >
                          Acknowledge
                        </button>
                      )}
                      {(ann.status === 'open' || ann.status === 'acknowledged') && (
                        <>
                          <button
                            onClick={() => updateStatus(ann.id, 'resolved')}
                            className="text-xs px-2.5 py-1 rounded-md font-medium bg-green-50 text-green-600 hover:bg-green-100 dark:bg-green-900/30 dark:text-green-400 dark:hover:bg-green-900/50 transition-colors"
                          >
                            Resolve
                          </button>
                          <button
                            onClick={() => updateStatus(ann.id, 'dismissed')}
                            className="text-xs px-2.5 py-1 rounded-md text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
                          >
                            Dismiss
                          </button>
                          <button
                            onClick={() => {
                              setRespondingTo(respondingTo === ann.id ? null : ann.id)
                              setResponseText(ann.authorResponse || '')
                            }}
                            className="text-xs px-2.5 py-1 rounded-md text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
                          >
                            Reply
                          </button>
                        </>
                      )}
                      {/* Accept suggestion — applies the text replacement directly */}
                      {ann.suggestedText && (ann.status === 'open' || ann.status === 'acknowledged') && (
                        <button
                          onClick={() => setConfirmingAccept(confirmingAccept === ann.id ? null : ann.id)}
                          className="text-xs px-2.5 py-1 rounded-md font-medium bg-emerald-50 text-emerald-700 hover:bg-emerald-100 dark:bg-emerald-900/30 dark:text-emerald-400 dark:hover:bg-emerald-900/50 transition-colors flex items-center gap-1"
                        >
                          <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                          </svg>
                          Accept
                        </button>
                      )}

                      {(ann.status === 'resolved' || ann.status === 'dismissed') && (
                        <button
                          onClick={() => updateStatus(ann.id, 'open')}
                          className="text-xs px-2.5 py-1 rounded-md text-gray-400 hover:text-gray-600 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
                        >
                          Re-open
                        </button>
                      )}

                      {/* Links — pushed to the right */}
                      <div className="flex items-center gap-1 ml-auto">
                        <Link
                          href={`/projects/${projectId}/write`}
                          className="text-xs px-2 py-1 rounded-md text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors flex items-center gap-1"
                          title="Open in manuscript editor"
                        >
                          <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                          </svg>
                          Edit
                        </Link>
                        {readerUrl && (
                          <a
                            href={readerUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-xs px-2 py-1 rounded-md text-gray-400 hover:text-blue-600 dark:hover:text-blue-400 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors flex items-center gap-1"
                          >
                            Reader
                            <svg className="w-2.5 h-2.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                            </svg>
                          </a>
                        )}
                      </div>
                    </div>

                    {/* Accept confirmation */}
                    {confirmingAccept === ann.id && ann.suggestedText && (
                      <div className="mt-3 p-3 rounded-md border border-emerald-200 bg-emerald-50/50 dark:border-emerald-800 dark:bg-emerald-900/20">
                        <div className="text-xs font-medium text-gray-700 dark:text-gray-300 mb-2">Apply this change?</div>
                        <div className="text-sm space-y-1.5 mb-3">
                          <div className="flex items-start gap-2">
                            <span className="text-red-500 text-xs mt-0.5 flex-shrink-0">-</span>
                            <span className="line-through text-gray-500 dark:text-gray-400">{ann.anchorQuote}</span>
                          </div>
                          <div className="flex items-start gap-2">
                            <span className="text-emerald-600 text-xs mt-0.5 flex-shrink-0">+</span>
                            <span className="text-emerald-700 dark:text-emerald-300 font-medium">{ann.suggestedText}</span>
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          <button
                            onClick={() => { acceptSuggestion(ann.id); setConfirmingAccept(null) }}
                            className="text-xs px-3 py-1.5 rounded-md font-medium bg-emerald-600 text-white hover:bg-emerald-700 transition-colors"
                          >
                            Apply change
                          </button>
                          <button
                            onClick={() => setConfirmingAccept(null)}
                            className="text-xs px-3 py-1.5 text-gray-500 hover:text-gray-700 dark:hover:text-gray-300"
                          >
                            Cancel
                          </button>
                        </div>
                      </div>
                    )}

                    {/* Reply input */}
                    {respondingTo === ann.id && (
                      <div className="mt-3 p-3 rounded-md bg-gray-50 dark:bg-gray-800/50">
                        <textarea
                          value={responseText}
                          onChange={e => setResponseText(e.target.value)}
                          placeholder="Write a response to this feedback..."
                          rows={2}
                          autoFocus
                          className="w-full text-sm px-3 py-2 border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 rounded-md resize-none focus:ring-1 focus:ring-blue-500 focus:border-blue-500"
                        />
                        <div className="flex justify-end gap-2 mt-2">
                          <button
                            onClick={() => { setRespondingTo(null); setResponseText('') }}
                            className="text-xs px-3 py-1.5 text-gray-500 hover:text-gray-700 dark:hover:text-gray-300"
                          >
                            Cancel
                          </button>
                          <button
                            onClick={() => updateStatus(ann.id, ann.status === 'open' ? 'acknowledged' : ann.status, responseText)}
                            disabled={!responseText.trim()}
                            className="text-xs px-3 py-1.5 rounded-md bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed font-medium"
                          >
                            Send Response
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
