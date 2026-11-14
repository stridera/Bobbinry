'use client'

/**
 * Reader Library
 *
 * Reader-facing dashboard showing:
 * - Continue Reading (in-progress chapters)
 * - My Subscriptions (active subscriptions)
 * - Feed (new chapters from followed authors and projects, with locked teasers)
 * - Following (manage followed authors and projects: unfollow, mute)
 * - Manage Billing (Stripe Customer Portal link)
 * - Reader Bobbins (installed reader/delivery bobbins)
 */

import { useState, useEffect, useCallback } from 'react'
import { useSession } from 'next-auth/react'
import { redirect } from 'next/navigation'
import Link from 'next/link'
import { config } from '@/lib/config'
import { apiFetch } from '@/lib/api'
import { SiteNav } from '@/components/SiteNav'
import { SkeletonList } from '@/components/LoadingState'
import { EmptyState } from '@/components/EmptyState'

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
  authorUsername?: string | null
}

interface Subscription {
  id: string
  authorId: string
  tierId: string
  status: string
  currentPeriodEnd: string
  cancelAtPeriodEnd: boolean
}

interface SubscriptionTier {
  id: string
  name: string
}

interface SubscriptionRow {
  subscription: Subscription
  tier: SubscriptionTier | null
  author: { id: string; name: string | null } | null
}

interface FeedItem {
  publicationId: string
  projectId: string
  chapterId: string
  publishedAt: string
  /** Scheduled chapters: when everyone can read it. */
  publicReleaseDate?: string | null
  projectName: string
  projectShortUrl: string | null
  authorId: string
  chapterTitle: string
  authorName: string
  authorUsername?: string | null
  /** Chapter the viewer cannot open yet (subscribers-only, or in an early-access window). */
  locked?: boolean
  /** Cheapest tier that would open it now. */
  upsell?: { tierId: string; tierName: string; priceMonthly: string | null } | null
}

type ProjectAccessStatus = 'ok' | 'subscribers_only' | 'beta_only' | 'unavailable'

interface FollowedAuthor {
  id: string
  username: string | null
  displayName: string | null
  avatarUrl: string | null
}

interface FollowedProject {
  id: string
  /** Null (with slug and cover) when the viewer can no longer open the project. */
  name: string | null
  slug: string | null
  authorUsername: string | null
  coverImage: string | null
  muted: boolean
  accessStatus: ProjectAccessStatus
}

const ACCESS_NOTES: Record<Exclude<ProjectAccessStatus, 'ok'>, string> = {
  beta_only: 'Now beta readers only \u2014 you don\u2019t have access',
  subscribers_only: 'Subscribers only',
  unavailable: 'No longer available',
}

interface BetaReadingItem {
  project: {
    id: string
    name: string
    description: string | null
    coverImage: string | null
    shortUrl: string | null
  }
  author: {
    id: string
    username: string | null
    displayName: string | null
  }
  accessLevel: string
  isLive: boolean
  visibility: string
  publishedChapterCount: number
  authorWide: boolean
}

interface ReaderBobbin {
  id: string
  bobbinId: string
  bobbinType: string
  config: any
  isEnabled: boolean
  installedAt: string
}

type Tab = 'reading' | 'feed' | 'following' | 'beta' | 'subscriptions' | 'bobbins'

export default function LibraryPage() {
  const { data: session, status } = useSession()
  const [activeTab, setActiveTab] = useState<Tab>('reading')
  const [progress, setProgress] = useState<ProgressItem[]>([])
  const [feed, setFeed] = useState<FeedItem[]>([])
  const [subscriptions, setSubscriptions] = useState<SubscriptionRow[]>([])
  const [readerBobbins, setReaderBobbins] = useState<ReaderBobbin[]>([])
  const [betaReading, setBetaReading] = useState<BetaReadingItem[]>([])
  const [authorProfiles, setAuthorProfiles] = useState<Record<string, { displayName: string; username: string }>>({})
  const [tierNames, setTierNames] = useState<Record<string, string>>({})
  const [followedAuthors, setFollowedAuthors] = useState<FollowedAuthor[]>([])
  const [followedProjects, setFollowedProjects] = useState<FollowedProject[]>([])
  const [followingError, setFollowingError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  const userId = session?.user?.id
  const apiToken = session?.apiToken

  const loadData = useCallback(async () => {
    if (!userId || !apiToken) return
    setLoading(true)

    try {
      const results = await Promise.allSettled([
        apiFetch(`/api/users/${userId}/reading-progress?limit=10`, apiToken).then(r => r.json()),
        apiFetch(`/api/users/${userId}/feed?limit=20`, apiToken).then(r => r.json()),
        apiFetch(`/api/users/${userId}/reader-bobbins`, apiToken).then(r => r.json()),
        apiFetch(`/api/users/${userId}/subscriptions?status=active`, apiToken).then(r => r.json()),
        apiFetch(`/api/users/${userId}/beta-reading`, apiToken).then(r => r.json()),
        apiFetch(`/api/users/${userId}/following`, apiToken).then(r => r.json())
      ])

      const progressItems: ProgressItem[] = results[0].status === 'fulfilled' ? (results[0].value.progress || []) : []
      const feedItems: FeedItem[] = results[1].status === 'fulfilled' ? (results[1].value.feed || []) : []
      const subscriptionItems: SubscriptionRow[] = results[3].status === 'fulfilled'
        ? (results[3].value.subscriptions || [])
        : []
      const betaItems: BetaReadingItem[] = results[4].status === 'fulfilled'
        ? (results[4].value.betaReading || [])
        : []

      if (results[5].status === 'fulfilled') {
        setFollowedAuthors(results[5].value.authors || [])
        setFollowedProjects(results[5].value.projects || [])
      }

      const authorIds = new Set<string>()
      for (const item of feedItems) {
        if (item.authorId) authorIds.add(item.authorId)
      }
      for (const row of subscriptionItems) {
        if (row.subscription?.authorId) authorIds.add(row.subscription.authorId)
      }

      const authorProfilesMap: Record<string, { displayName: string; username: string }> = {}
      if (authorIds.size > 0) {
        try {
          const res = await fetch(
            `${config.apiUrl}/api/users/profiles/batch?userIds=${encodeURIComponent([...authorIds].join(','))}`
          )
          if (res.ok) {
            const data = await res.json()
            for (const profile of data.profiles || []) {
              authorProfilesMap[profile.userId] = {
                displayName: profile.displayName || profile.username || profile.userName || 'Unknown',
                username: profile.username || ''
              }
            }
          }
        } catch {}
      }
      for (const authorId of authorIds) {
        if (!authorProfilesMap[authorId]) {
          authorProfilesMap[authorId] = { displayName: 'Unknown', username: '' }
        }
      }

      feedItems.forEach((item) => {
        const profile = authorProfilesMap[item.authorId]
        if (!item.authorUsername && profile?.username) {
          item.authorUsername = profile.username
        }
      })

      const slugsToResolve = [...new Set(progressItems
        .map((item) => item.projectShortUrl)
        .filter((slug): slug is string => Boolean(slug)))]

      const authorBySlug = new Map<string, string>()
      if (slugsToResolve.length > 0) {
        try {
          const res = await fetch(`${config.apiUrl}/api/public/projects/by-slugs`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ slugs: slugsToResolve })
          })
          if (res.ok) {
            const data = await res.json()
            for (const entry of data.projects || []) {
              if (entry.slug && entry.author?.username) {
                authorBySlug.set(entry.slug, entry.author.username)
              }
            }
          }
        } catch {}
      }

      progressItems.forEach((item) => {
        if (item.projectShortUrl) {
          const authorUsername = authorBySlug.get(item.projectShortUrl)
          if (authorUsername) {
            item.authorUsername = authorUsername
          }
        }
      })

      setProgress(progressItems)
      setFeed(feedItems)
      setBetaReading(betaItems)
      setAuthorProfiles(authorProfilesMap)

      if (results[2].status === 'fulfilled') {
        setReaderBobbins(results[2].value.bobbins || [])
      }

      setSubscriptions(subscriptionItems)
      const tiers: Record<string, string> = {}
      for (const row of subscriptionItems) {
        if (row.subscription?.tierId && row.tier?.name) {
          tiers[row.subscription.tierId] = row.tier.name
        }
      }
      setTierNames(tiers)
    } catch (err) {
      console.error('Failed to load library data:', err)
    } finally {
      setLoading(false)
    }
  }, [userId, apiToken])

  useEffect(() => {
    if (status === 'unauthenticated') {
      redirect('/login')
    }
    if (status === 'authenticated') {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- initial fetch
      loadData()
    }
  }, [status, loadData])

  const [billingMessage, setBillingMessage] = useState<string | null>(null)

  const openBillingPortal = async () => {
    if (!apiToken || !userId) return
    setBillingMessage(null)
    try {
      const res = await apiFetch('/api/subscribe/portal-session', apiToken, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId })
      })
      const data = await res.json()
      if (res.ok && data.url) {
        window.location.href = data.url
      } else if (res.status === 503) {
        setBillingMessage('Billing is not configured yet. Stripe integration is pending.')
      } else if (res.status === 400) {
        setBillingMessage('No active subscriptions to manage.')
      } else {
        setBillingMessage(data.error || 'Unable to open billing portal.')
      }
    } catch (err) {
      console.error('Failed to open billing portal:', err)
      setBillingMessage('Unable to connect to billing service.')
    }
  }

  const toggleBobbin = async (bobbin: ReaderBobbin) => {
    if (!apiToken || !userId) return
    try {
      await apiFetch(`/api/users/${userId}/reader-bobbins/${bobbin.id}`, apiToken, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ isEnabled: !bobbin.isEnabled })
      })
      setReaderBobbins(prev => prev.map(b =>
        b.id === bobbin.id ? { ...b, isEnabled: !b.isEnabled } : b
      ))
    } catch (err) {
      console.error('Failed to toggle bobbin:', err)
    }
  }

  const removeBobbin = async (bobbin: ReaderBobbin) => {
    if (!apiToken || !userId) return
    try {
      await apiFetch(`/api/users/${userId}/reader-bobbins/${bobbin.id}`, apiToken, {
        method: 'DELETE'
      })
      setReaderBobbins(prev => prev.filter(b => b.id !== bobbin.id))
    } catch (err) {
      console.error('Failed to remove bobbin:', err)
    }
  }

  // Following tab actions. Optimistic: update the list first, restore the
  // previous one and show an inline message if the API refuses.
  const unfollowAuthor = async (author: FollowedAuthor) => {
    if (!apiToken || !userId) return
    const index = followedAuthors.findIndex(a => a.id === author.id)
    setFollowingError(null)
    setFollowedAuthors(prev => prev.filter(a => a.id !== author.id))
    try {
      const res = await apiFetch(`/api/users/${userId}/follow/${author.id}`, apiToken, { method: 'DELETE' })
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || 'Unable to unfollow')
    } catch (err) {
      // Put back only this author, leaving any other concurrent change intact.
      setFollowedAuthors(prev => prev.some(a => a.id === author.id)
        ? prev
        : [...prev.slice(0, Math.max(0, index)), author, ...prev.slice(Math.max(0, index))])
      setFollowingError(err instanceof Error ? err.message : 'Unable to unfollow')
    }
  }

  const unfollowProject = async (project: FollowedProject) => {
    if (!apiToken) return
    const index = followedProjects.findIndex(p => p.id === project.id)
    setFollowingError(null)
    setFollowedProjects(prev => prev.filter(p => p.id !== project.id))
    try {
      const res = await apiFetch(`/api/projects/${project.id}/follow`, apiToken, { method: 'DELETE' })
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || 'Unable to unfollow')
    } catch (err) {
      setFollowedProjects(prev => prev.some(p => p.id === project.id)
        ? prev
        : [...prev.slice(0, Math.max(0, index)), project, ...prev.slice(Math.max(0, index))])
      setFollowingError(err instanceof Error ? err.message : 'Unable to unfollow')
    }
  }

  const toggleMuteProject = async (project: FollowedProject) => {
    if (!apiToken) return
    const muted = !project.muted
    setFollowingError(null)
    setFollowedProjects(prev => prev.map(p => p.id === project.id ? { ...p, muted } : p))
    try {
      const res = await apiFetch(`/api/projects/${project.id}/follow`, apiToken, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ muted })
      })
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || 'Unable to update mute')
    } catch (err) {
      setFollowedProjects(prev => prev.map(p => p.id === project.id ? { ...p, muted: !muted } : p))
      setFollowingError(err instanceof Error ? err.message : 'Unable to update mute')
    }
  }

  function formatTimeAgo(dateStr: string): string {
    const date = new Date(dateStr)
    const diffMs = new Date().getTime() - date.getTime()
    // A future date (a scheduled chapter) is not "ago": clamp rather than print a negative.
    if (diffMs < 0) return 'just now'
    const diffMins = Math.floor(diffMs / 60000)
    if (diffMins < 1) return 'just now'
    if (diffMins < 60) return `${diffMins}m ago`
    const diffHours = Math.floor(diffMins / 60)
    if (diffHours < 24) return `${diffHours}h ago`
    const diffDays = Math.floor(diffHours / 24)
    if (diffDays < 30) return `${diffDays}d ago`
    return date.toLocaleDateString()
  }

  // "Public in 3 days" for a locked teaser whose chapter is not public yet.
  function formatPublicIn(dateStr: string): string {
    const diffMs = new Date(dateStr).getTime() - new Date().getTime()
    if (diffMs <= 0) return ''
    const hours = Math.ceil(diffMs / 3_600_000)
    if (hours < 24) return `Public in ${hours}h`
    const days = Math.ceil(hours / 24)
    if (days < 30) return `Public in ${days} day${days === 1 ? '' : 's'}`
    return `Public ${new Date(dateStr).toLocaleDateString()}`
  }

  const TABS: { id: Tab; label: string }[] = [
    { id: 'reading', label: 'Continue Reading' },
    { id: 'feed', label: 'Feed' },
    { id: 'following', label: 'Following' },
    // Only readers with at least one active beta grant see the Beta Reading tab
    ...(betaReading.length > 0 ? [{ id: 'beta' as Tab, label: 'Beta Reading' }] : []),
    { id: 'subscriptions', label: 'Subscriptions' },
    { id: 'bobbins', label: 'Reader Bobbins' }
  ]

  if (status === 'loading' || loading) {
    return (
      <div className="min-h-screen bg-gray-50 dark:bg-gray-950">
        <SiteNav />
        <div className="max-w-4xl mx-auto px-4 py-8">
          <div className="h-7 bg-gray-100 dark:bg-gray-700 rounded w-32 mb-6 animate-pulse" />
          <SkeletonList count={4} />
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-950">
      <SiteNav />

      <div className="max-w-4xl mx-auto px-4 py-8">
        {/* Sub-header with billing */}
        <div className="flex items-center justify-between mb-6">
          <h1 className="font-display text-2xl font-bold text-gray-900 dark:text-gray-100">My Library</h1>
          <button
            onClick={openBillingPortal}
            className="text-sm text-gray-500 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-100 transition-colors"
          >
            Manage Billing
          </button>
        </div>

        {billingMessage && (
          <div className="mb-4 p-3 rounded text-sm bg-amber-50 dark:bg-amber-900/20 text-amber-700 dark:text-amber-300 flex items-center justify-between">
            <span>{billingMessage}</span>
            <button onClick={() => setBillingMessage(null)} className="text-amber-500 hover:text-amber-700 dark:hover:text-amber-200 ml-3">
              &times;
            </button>
          </div>
        )}

        {/* Tabs */}
        <div className="flex gap-1 mb-6 border-b border-gray-200 dark:border-gray-800">
          {TABS.map(tab => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${
                activeTab === tab.id
                  ? 'border-blue-500 text-blue-600 dark:text-blue-400'
                  : 'border-transparent text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300'
              }`}
            >
              {tab.label}
              {tab.id === 'reading' && progress.length > 0 && (
                <span className="ml-1.5 text-xs bg-blue-100 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400 px-1.5 py-0.5 rounded-full">
                  {progress.length}
                </span>
              )}
            </button>
          ))}
        </div>

        {/* Continue Reading */}
        {activeTab === 'reading' && (
          <div>
            {progress.length === 0 ? (
              <EmptyState
                title="No chapters in progress"
                description="Start reading something and your progress will appear here."
                action={{ label: 'Explore Stories', href: '/explore' }}
              />
            ) : (
              <div className="space-y-3">
                {progress.map(item => (
                  (() => {
                    const projectHref = item.projectShortUrl
                      ? `/read/${item.authorUsername || item.projectId}/${item.projectShortUrl}`
                      : null
                    const chapterHref = projectHref ? `${projectHref}/${item.chapterId}` : null
                    const cardClasses = 'flex items-center gap-4 p-4 bg-white dark:bg-gray-900 rounded-lg border border-gray-200 dark:border-gray-800 transition-colors'

                    const meta = (
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
                    )

                    if (!chapterHref || !projectHref) {
                      return (
                        <div key={item.viewId} className={`${cardClasses} opacity-70`} aria-disabled="true">
                          <div className="flex-1 min-w-0">
                            <p className="font-medium text-gray-900 dark:text-gray-100 truncate">
                              {item.chapterTitle}
                            </p>
                            <p className="text-sm text-gray-500 dark:text-gray-400">
                              {item.projectName}
                            </p>
                          </div>
                          {meta}
                        </div>
                      )
                    }

                    // Card stays fully clickable via the chapter title's stretched
                    // link; the project name is its own link layered above it.
                    return (
                      <div
                        key={item.viewId}
                        className={`relative ${cardClasses} hover:border-blue-300 dark:hover:border-blue-700`}
                      >
                        <div className="flex-1 min-w-0">
                          <Link
                            href={chapterHref}
                            className="block font-medium text-gray-900 dark:text-gray-100 truncate after:absolute after:inset-0"
                          >
                            {item.chapterTitle}
                          </Link>
                          <Link
                            href={projectHref}
                            className="relative z-10 inline-block text-sm text-gray-500 dark:text-gray-400 hover:text-blue-600 dark:hover:text-blue-400 hover:underline"
                          >
                            {item.projectName}
                          </Link>
                        </div>
                        {meta}
                      </div>
                    )
                  })()
                ))}
              </div>
            )}
          </div>
        )}

        {/* Feed */}
        {activeTab === 'feed' && (
          <div>
            {feed.length === 0 ? (
              <EmptyState
                title="Your feed is empty"
                description="Follow authors to see their new chapters here."
                action={{ label: 'Discover Authors', href: '/explore' }}
              />
            ) : (
              <div className="space-y-3">
                {feed.map(item => (
                  (() => {
                    const projectHref = item.projectShortUrl
                      ? `/read/${item.authorUsername || item.authorId}/${item.projectShortUrl}`
                      : null
                    const chapterHref = projectHref ? `${projectHref}/${item.chapterId}` : null
                    const authorHref = item.authorUsername ? `/read/${item.authorUsername}` : null

                    // Not public yet (early access / scheduled): say when, not "-3840m ago".
                    const nowMs = new Date().getTime()
                    const publicAt = [item.publicReleaseDate, item.publishedAt]
                      .find(d => d && new Date(d).getTime() > nowMs)
                    const timestamp = item.publishedAt && (
                      <span className="text-xs text-gray-400 flex-shrink-0">
                        {publicAt ? formatPublicIn(publicAt) : formatTimeAgo(item.publishedAt)}
                      </span>
                    )

                    if (item.locked) {
                      const lockedCard = (
                        <>
                          <div className="flex items-start justify-between gap-3">
                            <div className="min-w-0">
                              <p className="font-medium text-gray-900 dark:text-gray-100 truncate flex items-center gap-1.5">
                                <svg className="w-4 h-4 flex-shrink-0 text-amber-600 dark:text-amber-400" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4" />
                                </svg>
                                <span className="truncate">{item.chapterTitle}</span>
                              </p>
                              <p className="text-sm text-gray-500 dark:text-gray-400">
                                {item.projectName} &middot; {item.authorName}
                              </p>
                              <p className="text-xs text-amber-700 dark:text-amber-400 mt-1">
                                {item.upsell ? `Subscribe at ${item.upsell.tierName} to read now` : 'Subscribers only'}
                              </p>
                            </div>
                            {timestamp}
                          </div>
                        </>
                      )
                      const cardClass = 'block p-4 bg-white dark:bg-gray-900 rounded-lg border border-gray-200 dark:border-gray-800'
                      return projectHref ? (
                        <Link
                          key={item.publicationId}
                          href={projectHref}
                          className={`${cardClass} hover:border-amber-300 dark:hover:border-amber-700 transition-colors`}
                        >
                          {lockedCard}
                        </Link>
                      ) : (
                        <div key={item.publicationId} className={`${cardClass} opacity-70`} aria-disabled="true">
                          {lockedCard}
                        </div>
                      )
                    }

                    if (!chapterHref || !projectHref) {
                      return (
                        <div
                          key={item.publicationId}
                          className="block p-4 bg-white dark:bg-gray-900 rounded-lg border border-gray-200 dark:border-gray-800 opacity-70"
                          aria-disabled="true"
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
                            {timestamp}
                          </div>
                        </div>
                      )
                    }

                    // Card stays fully clickable via the chapter title's stretched
                    // link; project and author names are their own links above it.
                    return (
                      <div
                        key={item.publicationId}
                        className="relative block p-4 bg-white dark:bg-gray-900 rounded-lg border border-gray-200 dark:border-gray-800 hover:border-blue-300 dark:hover:border-blue-700 transition-colors"
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <Link
                              href={chapterHref}
                              className="block font-medium text-gray-900 dark:text-gray-100 truncate after:absolute after:inset-0"
                            >
                              {item.chapterTitle}
                            </Link>
                            <p className="text-sm text-gray-500 dark:text-gray-400">
                              <Link
                                href={projectHref}
                                className="relative z-10 hover:text-blue-600 dark:hover:text-blue-400 hover:underline"
                              >
                                {item.projectName}
                              </Link>
                              {' '}&middot;{' '}
                              {authorHref ? (
                                <Link
                                  href={authorHref}
                                  className="relative z-10 hover:text-blue-600 dark:hover:text-blue-400 hover:underline"
                                >
                                  {item.authorName}
                                </Link>
                              ) : (
                                item.authorName
                              )}
                            </p>
                          </div>
                          {timestamp}
                        </div>
                      </div>
                    )
                  })()
                ))}
              </div>
            )}
          </div>
        )}

        {/* Following */}
        {activeTab === 'following' && (
          <div className="space-y-8">
            {followingError && (
              <div role="alert" className="p-3 rounded text-sm bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-300 flex items-center justify-between">
                <span>{followingError}</span>
                <button onClick={() => setFollowingError(null)} className="ml-3 text-red-500 hover:text-red-700 dark:hover:text-red-200" aria-label="Dismiss">
                  &times;
                </button>
              </div>
            )}

            <section>
              <h2 className="font-display text-lg font-semibold text-gray-900 dark:text-gray-100 mb-3">Authors</h2>
              {followedAuthors.length === 0 ? (
                <p className="text-sm text-gray-500 dark:text-gray-400">
                  You&apos;re not following any authors yet.
                </p>
              ) : (
                <div className="space-y-2">
                  {followedAuthors.map(author => {
                    const name = author.displayName || author.username || 'Unknown author'
                    return (
                      <div key={author.id} className="flex items-center gap-3 p-3 bg-white dark:bg-gray-900 rounded-lg border border-gray-200 dark:border-gray-800">
                        {author.avatarUrl ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={author.avatarUrl} alt="" className="w-9 h-9 rounded-full object-cover flex-shrink-0" />
                        ) : (
                          <div className="w-9 h-9 rounded-full bg-gray-200 dark:bg-gray-700 flex items-center justify-center text-sm font-medium text-gray-600 dark:text-gray-300 flex-shrink-0" aria-hidden="true">
                            {name.charAt(0).toUpperCase()}
                          </div>
                        )}
                        <div className="flex-1 min-w-0">
                          {author.username ? (
                            <Link href={`/read/${author.username}`} className="font-medium text-gray-900 dark:text-gray-100 hover:text-blue-600 dark:hover:text-blue-400 truncate block">
                              {name}
                            </Link>
                          ) : (
                            <p className="font-medium text-gray-900 dark:text-gray-100 truncate">{name}</p>
                          )}
                          {author.username && <p className="text-xs text-gray-500 dark:text-gray-400">@{author.username}</p>}
                        </div>
                        <button
                          onClick={() => unfollowAuthor(author)}
                          className="text-sm px-3 py-1.5 rounded-md border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
                        >
                          Unfollow
                        </button>
                      </div>
                    )
                  })}
                </div>
              )}
              <Link href="/explore?tab=authors" className="mt-3 inline-block text-sm text-blue-600 dark:text-blue-400 hover:underline">
                Find more authors on Explore
              </Link>
            </section>

            <section>
              <h2 className="font-display text-lg font-semibold text-gray-900 dark:text-gray-100 mb-3">Projects</h2>
              {followedProjects.length === 0 ? (
                <p className="text-sm text-gray-500 dark:text-gray-400">
                  You&apos;re not following any projects yet.
                </p>
              ) : (
                <div className="space-y-2">
                  {followedProjects.map(project => {
                    const href = project.authorUsername && project.slug && project.name
                      ? `/read/${project.authorUsername}/${project.slug}`
                      : null
                    const displayName = project.name ?? 'A project you followed'
                    const note = project.accessStatus === 'ok' ? null : ACCESS_NOTES[project.accessStatus]
                    return (
                      <div key={project.id} className="flex items-center gap-3 p-3 bg-white dark:bg-gray-900 rounded-lg border border-gray-200 dark:border-gray-800">
                        <div className="flex-1 min-w-0">
                          {href && project.accessStatus !== 'unavailable' ? (
                            <Link href={href} className="font-medium text-gray-900 dark:text-gray-100 hover:text-blue-600 dark:hover:text-blue-400 truncate block">
                              {displayName}
                            </Link>
                          ) : (
                            <p className="font-medium text-gray-900 dark:text-gray-100 truncate">{displayName}</p>
                          )}
                          {project.authorUsername && <p className="text-xs text-gray-500 dark:text-gray-400">by @{project.authorUsername}</p>}
                          {note && <p className="text-xs text-gray-500 dark:text-gray-400 italic mt-0.5">{note}</p>}
                        </div>
                        <button
                          onClick={() => toggleMuteProject(project)}
                          aria-pressed={project.muted}
                          title={project.muted ? 'Muted: hidden from your feed' : 'Hide this project from your feed'}
                          className={`text-sm px-3 py-1.5 rounded-md border transition-colors ${
                            project.muted
                              ? 'border-amber-300 dark:border-amber-700 bg-amber-50 dark:bg-amber-900/20 text-amber-700 dark:text-amber-300'
                              : 'border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800'
                          }`}
                        >
                          {project.muted ? 'Muted' : 'Mute'}
                        </button>
                        <button
                          onClick={() => unfollowProject(project)}
                          className="text-sm px-3 py-1.5 rounded-md border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
                        >
                          Unfollow
                        </button>
                      </div>
                    )
                  })}
                </div>
              )}
              <Link href="/explore" className="mt-3 inline-block text-sm text-blue-600 dark:text-blue-400 hover:underline">
                Find more projects on Explore
              </Link>
            </section>
          </div>
        )}

        {/* Beta Reading */}
        {activeTab === 'beta' && (
          <div className="space-y-3">
            {betaReading.map(item => {
              const accessLabels: Record<string, string> = {
                beta: 'Beta Reader',
                arc: 'ARC Reader',
                early_access: 'Early Access'
              }
              const readerHref = item.project.shortUrl
                ? `/read/${item.author.username || item.author.id}/${item.project.shortUrl}`
                : null

              const content = (
                <div className="flex items-center gap-4">
                  {item.project.coverImage ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={item.project.coverImage}
                      alt=""
                      className="w-12 h-16 object-cover rounded flex-shrink-0"
                    />
                  ) : (
                    <div className="w-12 h-16 bg-gray-100 dark:bg-gray-800 rounded flex-shrink-0" />
                  )}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="font-medium text-gray-900 dark:text-gray-100 truncate">
                        {item.project.name}
                      </p>
                      <span className={`px-1.5 py-0.5 text-xs rounded flex-shrink-0 ${
                        item.accessLevel === 'arc' ? 'bg-purple-100 dark:bg-purple-900/30 text-purple-700 dark:text-purple-300' :
                        item.accessLevel === 'early_access' ? 'bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300' :
                        'bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300'
                      }`}>
                        {accessLabels[item.accessLevel] || item.accessLevel}
                      </span>
                      {item.visibility === 'private' ? (
                        <span className="px-1.5 py-0.5 bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 text-xs rounded flex-shrink-0">
                          Private
                        </span>
                      ) : item.visibility === 'unlisted' ? (
                        <span className="px-1.5 py-0.5 bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300 text-xs rounded flex-shrink-0">
                          Unlisted
                        </span>
                      ) : !item.isLive ? (
                        <span className="px-1.5 py-0.5 bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300 text-xs rounded flex-shrink-0">
                          Not publicly published
                        </span>
                      ) : null}
                    </div>
                    <p className="text-sm text-gray-500 dark:text-gray-400 truncate">
                      {item.author.displayName || (item.author.username ? `@${item.author.username}` : 'Unknown author')}
                      {' '}&middot;{' '}
                      {item.publishedChapterCount > 0
                        ? `${item.publishedChapterCount} chapter${item.publishedChapterCount === 1 ? '' : 's'}`
                        : 'No chapters available yet'}
                    </p>
                    {!readerHref && (
                      <p className="text-xs text-gray-400 dark:text-gray-500 mt-0.5">
                        The author hasn&rsquo;t set up a reader link for this project yet.
                      </p>
                    )}
                  </div>
                </div>
              )

              const cardClasses = 'block p-4 bg-white dark:bg-gray-900 rounded-lg border border-gray-200 dark:border-gray-800 transition-colors'

              if (!readerHref) {
                return (
                  <div key={item.project.id} className={`${cardClasses} opacity-70`} aria-disabled="true">
                    {content}
                  </div>
                )
              }

              return (
                <Link
                  key={item.project.id}
                  href={readerHref}
                  className={`${cardClasses} hover:border-blue-300 dark:hover:border-blue-700`}
                >
                  {content}
                </Link>
              )
            })}
          </div>
        )}

        {/* Subscriptions */}
        {activeTab === 'subscriptions' && (
          <div>
            {subscriptions.length === 0 ? (
              <EmptyState
                title="No active subscriptions"
                description="Discover authors and subscribe to support their work."
                action={{ label: 'Explore Authors', href: '/explore' }}
              />
            ) : (
              <div className="space-y-3">
                {subscriptions.map((row) => {
                  const authorId = row.subscription.authorId
                  const profile = authorProfiles[authorId]
                  const authorName = profile?.displayName || row.author?.name || 'Unknown'
                  const username = profile?.username || ''
                  const tierName = row.tier?.name || tierNames[row.subscription.tierId] || 'Subscription'
                  const renewText = row.subscription.currentPeriodEnd
                    ? new Date(row.subscription.currentPeriodEnd).toLocaleDateString()
                    : null
                  const status = row.subscription.status.toLowerCase()
                  const statusClass = status === 'active'
                    ? 'bg-green-50 dark:bg-green-900/20 text-green-600 dark:text-green-400'
                    : status === 'past_due'
                      ? 'bg-amber-50 dark:bg-amber-900/20 text-amber-600 dark:text-amber-400'
                      : 'bg-gray-100 dark:bg-gray-800 text-gray-500 dark:text-gray-400'

                  return (
                    <div
                      key={row.subscription.id}
                      className="flex items-center justify-between p-4 bg-white dark:bg-gray-900 rounded-lg border border-gray-200 dark:border-gray-800"
                    >
                      <div className="min-w-0">
                        <Link
                          href={`/u/${username || authorId}`}
                          className="font-medium text-gray-900 dark:text-gray-100 hover:text-blue-600 dark:hover:text-blue-400"
                        >
                          {authorName}
                        </Link>
                        {username && (
                          <p className="text-sm text-gray-500 dark:text-gray-400">@{username}</p>
                        )}
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="text-xs px-2 py-1 bg-blue-50 dark:bg-blue-900/20 text-blue-600 dark:text-blue-400 rounded">
                          {tierName}
                        </span>
                        <span className={`text-xs px-2 py-1 rounded ${statusClass}`}>
                          {row.subscription.status}
                        </span>
                        {renewText && (
                          <span className="text-xs text-gray-500 dark:text-gray-400">
                            {row.subscription.cancelAtPeriodEnd ? `Ends ${renewText}` : `Renews ${renewText}`}
                          </span>
                        )}
                        <Link
                          href={`/u/${username || authorId}`}
                          className="text-xs text-blue-600 dark:text-blue-400 hover:underline"
                        >
                          View Profile
                        </Link>
                      </div>
                    </div>
                  )
                })}

                <div className="pt-4 border-t border-gray-200 dark:border-gray-800 mt-4">
                  <button
                    onClick={openBillingPortal}
                    className="text-sm text-blue-600 dark:text-blue-400 hover:underline"
                  >
                    Manage all subscriptions & billing
                  </button>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Reader Bobbins */}
        {activeTab === 'bobbins' && (
          <div>
            {readerBobbins.length === 0 ? (
              <EmptyState
                title="No reader bobbins installed"
                description="Reader bobbins can enhance your reading experience with features like Kindle delivery, translation, custom themes, and more."
              />
            ) : (
              <div className="space-y-3">
                {readerBobbins.map(bobbin => (
                  <div
                    key={bobbin.id}
                    className="flex items-center justify-between p-4 bg-white dark:bg-gray-900 rounded-lg border border-gray-200 dark:border-gray-800"
                  >
                    <div className="min-w-0">
                      <p className="font-medium text-gray-900 dark:text-gray-100">
                        {bobbin.bobbinId}
                      </p>
                      <p className="text-xs text-gray-500 dark:text-gray-400">
                        {bobbin.bobbinType === 'delivery_channel' ? 'Delivery Channel' : 'Reader Enhancement'}
                        {' '}&middot;{' '}
                        Installed {new Date(bobbin.installedAt).toLocaleDateString()}
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => toggleBobbin(bobbin)}
                        className={`text-xs px-3 py-1 rounded transition-colors ${
                          bobbin.isEnabled
                            ? 'bg-green-50 dark:bg-green-900/20 text-green-600 dark:text-green-400'
                            : 'bg-gray-100 dark:bg-gray-800 text-gray-500 dark:text-gray-400'
                        }`}
                      >
                        {bobbin.isEnabled ? 'Enabled' : 'Disabled'}
                      </button>
                      <button
                        onClick={() => removeBobbin(bobbin)}
                        className="text-xs text-red-500 hover:underline"
                      >
                        Remove
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
