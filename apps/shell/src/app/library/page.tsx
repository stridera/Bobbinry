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

interface Subscription {
  id: string
  authorId: string
  tierId: string
  status: string
  currentPeriodEnd: string
  cancelAtPeriodEnd: boolean
}

interface FollowedAuthor {
  followingId: string
  createdAt: string
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
  const [subscriptions, setSubscriptions] = useState<Subscription[]>([])
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
        fetch(`${config.apiUrl}/api/users/${userId}/followers?type=following`).then(r => r.json()),
        apiFetch(`/api/users/${userId}/reader-bobbins`, apiToken).then(r => r.json())
      ])

      if (results[0].status === 'fulfilled') {
        setProgress(results[0].value.progress || [])
      }
      if (results[1].status === 'fulfilled') {
        setFeed(results[1].value.feed || [])
      }
      if (results[3].status === 'fulfilled') {
        setReaderBobbins(results[3].value.bobbins || [])
      }

      // Load subscriptions
      try {
        const followRes = results[2].status === 'fulfilled' ? results[2].value : { followers: [] }
        const authors: FollowedAuthor[] = followRes.followers || []

        // For each followed author, check if there's an active subscription
        const subs: Subscription[] = []
        const profiles: Record<string, { displayName: string; username: string }> = {}
        const tiers: Record<string, string> = {}

        for (const author of authors) {
          try {
            const profileRes = await fetch(`${config.apiUrl}/api/users/${author.followingId}/profile`)
            if (profileRes.ok) {
              const { profile } = await profileRes.json()
              profiles[author.followingId] = {
                displayName: profile.displayName || profile.username || 'Unknown',
                username: profile.username || ''
              }
            }
          } catch {}
        }
        setAuthorProfiles(profiles)
        setSubscriptions(subs)
        setTierNames(tiers)
      } catch {}
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
      <div className="min-h-screen bg-gray-50 dark:bg-gray-950 flex items-center justify-center">
        <p className="text-gray-500 dark:text-gray-400">Loading your library...</p>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-950">
      {/* Top bar */}
      <div className="border-b border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900">
        <div className="max-w-4xl mx-auto px-4 h-14 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Link
              href="/dashboard"
              className="flex items-center gap-1.5 text-sm text-gray-500 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-100 transition-colors"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
              </svg>
              Dashboard
            </Link>
            <span className="text-gray-300 dark:text-gray-700">/</span>
            <span className="text-sm font-medium text-gray-900 dark:text-gray-100">My Library</span>
          </div>
          <div className="flex items-center gap-4">
            <Link
              href="/explore"
              className="text-sm text-gray-500 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-100 transition-colors"
            >
              Explore
            </Link>
            <button
              onClick={openBillingPortal}
              className="text-sm text-gray-500 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-100 transition-colors"
            >
              Manage Billing
            </button>
          </div>
        </div>
      </div>

      <div className="max-w-4xl mx-auto px-4 py-8">

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
              <div className="text-center py-12">
                <p className="text-gray-500 dark:text-gray-400 mb-2">No chapters in progress.</p>
                <p className="text-sm text-gray-400 dark:text-gray-500">
                  Start reading something and your progress will appear here.
                </p>
              </div>
            ) : (
              <div className="space-y-3">
                {progress.map(item => (
                  <Link
                    key={item.viewId}
                    href={item.projectShortUrl ? `/read/${item.projectShortUrl}/${item.chapterId}` : '#'}
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
                ))}
              </div>
            )}
          </div>
        )}

        {/* Feed */}
        {activeTab === 'feed' && (
          <div>
            {feed.length === 0 ? (
              <div className="text-center py-12">
                <p className="text-gray-500 dark:text-gray-400 mb-2">Your feed is empty.</p>
                <p className="text-sm text-gray-400 dark:text-gray-500">
                  Follow authors to see their new chapters here.
                </p>
              </div>
            ) : (
              <div className="space-y-3">
                {feed.map(item => (
                  <Link
                    key={item.publicationId}
                    href={item.projectShortUrl ? `/read/${item.projectShortUrl}/${item.chapterId}` : '#'}
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
                ))}
              </div>
            )}
          </div>
        )}

        {/* Subscriptions */}
        {activeTab === 'subscriptions' && (
          <div>
            {Object.keys(authorProfiles).length === 0 ? (
              <div className="text-center py-12">
                <p className="text-gray-500 dark:text-gray-400 mb-2">You're not following any authors yet.</p>
                <p className="text-sm text-gray-400 dark:text-gray-500">
                  Discover authors and follow them to keep up with their work.
                </p>
              </div>
            ) : (
              <div className="space-y-3">
                {Object.entries(authorProfiles).map(([authorId, profile]) => (
                  <div
                    key={authorId}
                    className="flex items-center justify-between p-4 bg-white dark:bg-gray-900 rounded-lg border border-gray-200 dark:border-gray-800"
                  >
                    <div className="min-w-0">
                      <Link
                        href={`/u/${profile.username || authorId}`}
                        className="font-medium text-gray-900 dark:text-gray-100 hover:text-blue-600 dark:hover:text-blue-400"
                      >
                        {profile.displayName}
                      </Link>
                      {profile.username && (
                        <p className="text-sm text-gray-500 dark:text-gray-400">@{profile.username}</p>
                      )}
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-xs px-2 py-1 bg-green-50 dark:bg-green-900/20 text-green-600 dark:text-green-400 rounded">
                        Following
                      </span>
                      <Link
                        href={`/u/${profile.username || authorId}`}
                        className="text-xs text-blue-600 dark:text-blue-400 hover:underline"
                      >
                        View Profile
                      </Link>
                    </div>
                  </div>
                ))}

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
              <div className="text-center py-12">
                <p className="text-gray-500 dark:text-gray-400 mb-2">No reader bobbins installed.</p>
                <p className="text-sm text-gray-400 dark:text-gray-500">
                  Reader bobbins can enhance your reading experience with features like
                  Kindle delivery, translation, custom themes, and more.
                </p>
              </div>
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
