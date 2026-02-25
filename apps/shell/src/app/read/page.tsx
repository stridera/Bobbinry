'use client'

import { useState, useEffect, useCallback } from 'react'
import { useSession } from 'next-auth/react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { config } from '@/lib/config'
import { apiFetch } from '@/lib/api'
import { SiteNav } from '@/components/SiteNav'

interface ProgressItem {
  viewId: string
  chapterId: string
  lastPositionPercent: number
  readTimeSeconds: number
  startedAt: string
  chapterTitle: string
  projectId: string | null
  projectName: string
  projectShortUrl: string | null
}

interface FeedItem {
  publicationId: string
  projectId: string
  chapterId: string
  publishedAt: string
  projectName: string
  projectShortUrl: string | null
  authorId: string
  chapterTitle: string
  authorName: string
}

interface AuthorInfo {
  username: string | null
}

export default function ReadIndexPage() {
  const { data: session, status } = useSession()
  const router = useRouter()
  const [progress, setProgress] = useState<ProgressItem[]>([])
  const [feed, setFeed] = useState<FeedItem[]>([])
  const [loading, setLoading] = useState(true)
  const [authorUsernames, setAuthorUsernames] = useState<Record<string, string>>({})
  const [projectAuthors, setProjectAuthors] = useState<Record<string, string>>({})

  const userId = session?.user?.id
  const apiToken = (session as any)?.apiToken

  const loadData = useCallback(async () => {
    if (!userId || !apiToken) return
    setLoading(true)

    try {
      const [progressRes, feedRes] = await Promise.allSettled([
        apiFetch(`/api/users/${userId}/reading-progress?limit=10`, apiToken).then(r => r.json()),
        apiFetch(`/api/users/${userId}/feed?limit=20`, apiToken).then(r => r.json()),
      ])

      const progressItems = progressRes.status === 'fulfilled' ? (progressRes.value.progress || []) : []
      const feedItems = feedRes.status === 'fulfilled' ? (feedRes.value.feed || []) : []

      setProgress(progressItems)
      setFeed(feedItems)

      // Resolve author usernames for feed items
      const authorIds = new Set<string>()
      for (const item of feedItems) {
        if (item.authorId) authorIds.add(item.authorId)
      }

      const usernames: Record<string, string> = {}
      for (const authorId of authorIds) {
        try {
          const res = await fetch(`${config.apiUrl}/api/users/${authorId}/profile`)
          if (res.ok) {
            const data = await res.json()
            if (data.profile?.username) {
              usernames[authorId] = data.profile.username
            }
          }
        } catch {}
      }
      setAuthorUsernames(usernames)

      // Resolve author usernames for progress items (via project lookup)
      const projectIds = new Set<string>()
      for (const item of progressItems) {
        if (item.projectId) projectIds.add(item.projectId)
      }

      const projAuthors: Record<string, string> = {}
      for (const projId of projectIds) {
        try {
          const res = await fetch(`${config.apiUrl}/api/public/projects/by-slug/${encodeURIComponent(
            progressItems.find((p: ProgressItem) => p.projectId === projId)?.projectShortUrl || projId
          )}`)
          if (res.ok) {
            const data = await res.json()
            if (data.author?.username) {
              projAuthors[projId] = data.author.username
            }
          }
        } catch {}
      }
      setProjectAuthors(projAuthors)
    } catch (err) {
      console.error('Failed to load reading data:', err)
    } finally {
      setLoading(false)
    }
  }, [userId, apiToken])

  useEffect(() => {
    if (status === 'unauthenticated') {
      router.replace('/explore')
      return
    }
    if (status === 'authenticated') {
      loadData()
    }
  }, [status, loadData, router])

  function buildReadUrl(authorIdentifier: string | undefined, shortUrl: string | null, chapterId?: string) {
    if (!authorIdentifier || !shortUrl) return '#'
    const base = `/read/${authorIdentifier}/${shortUrl}`
    return chapterId ? `${base}/${chapterId}` : base
  }

  function formatTimeAgo(dateStr: string): string {
    const date = new Date(dateStr)
    const now = new Date()
    const diffMs = now.getTime() - date.getTime()
    const diffMins = Math.floor(diffMs / 60000)
    if (diffMins < 60) return `${diffMins}m ago`
    const diffHours = Math.floor(diffMins / 60)
    if (diffHours < 24) return `${diffHours}h ago`
    const diffDays = Math.floor(diffHours / 24)
    if (diffDays < 30) return `${diffDays}d ago`
    return date.toLocaleDateString()
  }

  if (status === 'loading' || loading) {
    return (
      <div className="min-h-screen bg-gray-50 dark:bg-gray-950">
        <SiteNav />
        <div className="flex items-center justify-center py-32">
          <p className="text-gray-500 dark:text-gray-400">Loading your reading list...</p>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-950">
      <SiteNav />

      <div className="max-w-4xl mx-auto px-4 py-8">
        <div className="flex items-center justify-between mb-8">
          <h1 className="font-display text-2xl font-bold text-gray-900 dark:text-gray-100">
            My Reading
          </h1>
          <Link
            href="/explore"
            className="text-sm text-blue-600 dark:text-blue-400 hover:underline"
          >
            Discover more stories
          </Link>
        </div>

        {/* Continue Reading */}
        {progress.length > 0 && (
          <section className="mb-10">
            <h2 className="font-display text-lg font-semibold text-gray-900 dark:text-gray-100 mb-4">
              Continue Reading
            </h2>
            <div className="space-y-3">
              {progress.map(item => {
                const authorSlug = (item.projectId ? projectAuthors[item.projectId] : undefined) || item.projectId || undefined
                return (
                  <Link
                    key={item.viewId}
                    href={buildReadUrl(authorSlug, item.projectShortUrl, item.chapterId)}
                    className="flex items-center gap-4 p-4 bg-white dark:bg-gray-900 rounded-lg border border-gray-200 dark:border-gray-800 hover:border-blue-300 dark:hover:border-blue-700 transition-colors"
                  >
                    <div className="flex-1 min-w-0">
                      <p className="font-medium text-gray-900 dark:text-gray-100 truncate">
                        {item.chapterTitle}
                      </p>
                      <p className="text-sm text-gray-500 dark:text-gray-400">
                        {item.projectName}
                      </p>
                    </div>
                    <div className="flex items-center gap-3 flex-shrink-0">
                      <div className="w-24">
                        <div className="h-1.5 bg-gray-200 dark:bg-gray-700 rounded-full overflow-hidden">
                          <div
                            className="h-full bg-blue-500 rounded-full"
                            style={{ width: `${item.lastPositionPercent}%` }}
                          />
                        </div>
                        <p className="text-xs text-gray-400 mt-0.5 text-right">{item.lastPositionPercent}%</p>
                      </div>
                      <span className="text-xs text-gray-400">{formatTimeAgo(item.startedAt)}</span>
                    </div>
                  </Link>
                )
              })}
            </div>
          </section>
        )}

        {/* Feed */}
        <section className="mb-10">
          <h2 className="font-display text-lg font-semibold text-gray-900 dark:text-gray-100 mb-4">
            New from Authors You Follow
          </h2>
          {feed.length === 0 ? (
            <div className="text-center py-12 bg-white dark:bg-gray-900 rounded-lg border border-gray-200 dark:border-gray-800">
              <svg className="w-10 h-10 text-gray-300 dark:text-gray-700 mx-auto mb-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" />
              </svg>
              <p className="text-gray-500 dark:text-gray-400 mb-1">Your feed is empty</p>
              <p className="text-sm text-gray-400 dark:text-gray-500 mb-4">
                Follow authors on the Explore page to see new chapters here.
              </p>
              <Link
                href="/explore"
                className="inline-flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 text-sm font-medium transition-colors"
              >
                Explore Stories
              </Link>
            </div>
          ) : (
            <div className="space-y-3">
              {feed.map(item => {
                const authorSlug = authorUsernames[item.authorId] || item.authorId
                return (
                  <Link
                    key={item.publicationId}
                    href={buildReadUrl(authorSlug, item.projectShortUrl, item.chapterId)}
                    className="block p-4 bg-white dark:bg-gray-900 rounded-lg border border-gray-200 dark:border-gray-800 hover:border-blue-300 dark:hover:border-blue-700 transition-colors"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="font-medium text-gray-900 dark:text-gray-100 truncate">
                          {item.chapterTitle}
                        </p>
                        <p className="text-sm text-gray-500 dark:text-gray-400">
                          {item.projectName} &middot; {item.authorName}
                        </p>
                      </div>
                      {item.publishedAt && (
                        <span className="text-xs text-gray-400 flex-shrink-0">
                          {formatTimeAgo(item.publishedAt)}
                        </span>
                      )}
                    </div>
                  </Link>
                )
              })}
            </div>
          )}
        </section>

        {/* Quick links */}
        <div className="flex items-center gap-4 text-sm">
          <Link href="/library" className="text-blue-600 dark:text-blue-400 hover:underline">
            Full Library
          </Link>
          <span className="text-gray-300 dark:text-gray-700">&middot;</span>
          <Link href="/explore" className="text-blue-600 dark:text-blue-400 hover:underline">
            Explore Stories
          </Link>
        </div>
      </div>
    </div>
  )
}
