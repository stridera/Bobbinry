'use client'

/**
 * Reader Library
 *
 * Reader-facing dashboard showing:
 * - Continue Reading (in-progress chapters)
 * - My Subscriptions (active subscriptions)
 * - Following (authors with new content)
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
  projectName: string
  projectShortUrl: string | null
  authorId: string
  chapterTitle: string
  authorName: string
  authorUsername?: string | null
}

interface ReaderBobbin {
  id: string
  bobbinId: string
  bobbinType: string
  config: any
  isEnabled: boolean
  installedAt: string
}

type Tab = 'reading' | 'feed' | 'subscriptions' | 'bobbins'

export default function LibraryPage() {
  const { data: session, status } = useSession()
  const [activeTab, setActiveTab] = useState<Tab>('reading')
  const [progress, setProgress] = useState<ProgressItem[]>([])
  const [feed, setFeed] = useState<FeedItem[]>([])
  const [subscriptions, setSubscriptions] = useState<SubscriptionRow[]>([])
  const [readerBobbins, setReaderBobbins] = useState<ReaderBobbin[]>([])
  const [authorProfiles, setAuthorProfiles] = useState<Record<string, { displayName: string; username: string }>>({})
  const [tierNames, setTierNames] = useState<Record<string, string>>({})
  const [loading, setLoading] = useState(true)

  const userId = session?.user?.id
  const apiToken = (session as any)?.apiToken

  const loadData = useCallback(async () => {
    if (!userId || !apiToken) return
    setLoading(true)

    try {
      const results = await Promise.allSettled([
        apiFetch(`/api/users/${userId}/reading-progress?limit=10`, apiToken).then(r => r.json()),
        apiFetch(`/api/users/${userId}/feed?limit=20`, apiToken).then(r => r.json()),
        apiFetch(`/api/users/${userId}/reader-bobbins`, apiToken).then(r => r.json()),
        apiFetch(`/api/users/${userId}/subscriptions?status=active`, apiToken).then(r => r.json())
      ])

      const progressItems: ProgressItem[] = results[0].status === 'fulfilled' ? (results[0].value.progress || []) : []
      const feedItems: FeedItem[] = results[1].status === 'fulfilled' ? (results[1].value.feed || []) : []
      const subscriptionItems: SubscriptionRow[] = results[3].status === 'fulfilled'
        ? (results[3].value.subscriptions || [])
        : []

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
        if (profile?.username) {
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

  const TABS: { id: Tab; label: string }[] = [
    { id: 'reading', label: 'Continue Reading' },
    { id: 'feed', label: 'Feed' },
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
                    const chapterHref = item.projectShortUrl
                      ? `/read/${item.authorUsername || item.projectId}/${item.projectShortUrl}/${item.chapterId}`
                      : null
                    const cardClasses = 'flex items-center gap-4 p-4 bg-white dark:bg-gray-900 rounded-lg border border-gray-200 dark:border-gray-800 transition-colors'

                    const content = (
                      <>
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
                      </>
                    )

                    if (!chapterHref) {
                      return (
                        <div key={item.viewId} className={`${cardClasses} opacity-70`} aria-disabled="true">
                          {content}
                        </div>
                      )
                    }

                    return (
                      <Link
                        key={item.viewId}
                        href={chapterHref}
                        className={`${cardClasses} hover:border-blue-300 dark:hover:border-blue-700`}
                      >
                        {content}
                      </Link>
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
                    const chapterHref = item.projectShortUrl
                      ? `/read/${item.authorUsername || item.authorId}/${item.projectShortUrl}/${item.chapterId}`
                      : null

                    const content = (
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
                    )

                    if (!chapterHref) {
                      return (
                        <div
                          key={item.publicationId}
                          className="block p-4 bg-white dark:bg-gray-900 rounded-lg border border-gray-200 dark:border-gray-800 opacity-70"
                          aria-disabled="true"
                        >
                          {content}
                        </div>
                      )
                    }

                    return (
                      <Link
                        key={item.publicationId}
                        href={chapterHref}
                        className="block p-4 bg-white dark:bg-gray-900 rounded-lg border border-gray-200 dark:border-gray-800 hover:border-blue-300 dark:hover:border-blue-700 transition-colors"
                      >
                        {content}
                      </Link>
                    )
                  })()
                ))}
              </div>
            )}
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
