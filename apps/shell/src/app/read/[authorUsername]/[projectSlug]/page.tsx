'use client'

import { useState, useEffect } from 'react'
import { useParams, useSearchParams } from 'next/navigation'
import { useSession } from 'next-auth/react'
import Link from 'next/link'
import { config } from '@/lib/config'
import { apiFetch } from '@/lib/api'
import { ReaderNav } from '@/components/ReaderNav'
import { OptimizedImage } from '@/components/OptimizedImage'

interface ProjectInfo {
  id: string
  name: string
  description: string | null
  coverImage: string | null
  shortUrl: string | null
  ownerId?: string
}

interface AuthorInfo {
  userId: string
  username: string | null
  displayName: string | null
  avatarUrl: string | null
  userName: string | null
}

interface TocChapter {
  id: string
  title: string
  publishedAt?: string
  viewCount?: number
  order: number
  locked?: boolean
  embargoUntil?: string
}

interface SubscriptionTier {
  id: string
  name: string
  description: string | null
  priceMonthly: string | null
  priceYearly: string | null
  benefits: string[] | null
  chapterDelayDays: number
  tierLevel: number
}

export default function ProjectReadingPage() {
  const params = useParams()
  const searchParams = useSearchParams()
  const authorUsername = params.authorUsername as string
  const projectSlug = params.projectSlug as string
  const { data: session } = useSession()

  const [project, setProject] = useState<ProjectInfo | null>(null)
  const [author, setAuthor] = useState<AuthorInfo | null>(null)
  const [toc, setToc] = useState<TocChapter[]>([])
  const [tiers, setTiers] = useState<SubscriptionTier[]>([])
  const [acceptsPayments, setAcceptsPayments] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [subscribing, setSubscribing] = useState<string | null>(null)
  const [subscribeError, setSubscribeError] = useState<string | null>(null)
  const [subscribedTierId, setSubscribedTierId] = useState<string | null>(null)
  const [isFollowingProject, setIsFollowingProject] = useState(false)
  const [followLoading, setFollowLoading] = useState(false)
  const [followerCount, setFollowerCount] = useState(0)
  const [billingPeriod, setBillingPeriod] = useState<'monthly' | 'yearly'>('monthly')
  const [justSubscribed, setJustSubscribed] = useState(false)

  const apiToken = (session as any)?.apiToken as string | undefined
  const userId = session?.user?.id
  const isOwnProject = !!(userId && author?.userId === userId)

  // Handle ?subscribed=true return from Stripe
  useEffect(() => {
    if (searchParams.get('subscribed') === 'true') {
      setJustSubscribed(true)
    }
  }, [searchParams])

  useEffect(() => {
    loadProject()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authorUsername, projectSlug])

  // Load follow status when project and session are ready
  useEffect(() => {
    if (!project?.id) return
    loadFollowStatus(project.id)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project?.id, session])

  // Load subscription state when author and session are ready
  useEffect(() => {
    if (!author?.userId || !userId || !apiToken) return
    loadSubscriptionState()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [author?.userId, userId, apiToken])

  const loadSubscriptionState = async () => {
    if (!userId || !apiToken || !author?.userId) return
    try {
      const res = await apiFetch(`/api/users/${userId}/subscriptions?status=active`, apiToken)
      if (res.ok) {
        const data = await res.json()
        const match = data.subscriptions?.find(
          (s: any) => s.subscription?.authorId === author.userId
        )
        if (match) {
          setSubscribedTierId(match.subscription.tierId)
        }
      }
    } catch {}
  }

  const loadFollowStatus = async (projectId: string) => {
    try {
      const headers: Record<string, string> = {}
      if (apiToken) headers['Authorization'] = `Bearer ${apiToken}`
      const res = await fetch(
        `${config.apiUrl}/api/projects/${projectId}/follow-status`,
        { headers }
      )
      if (res.ok) {
        const data = await res.json()
        setIsFollowingProject(data.isFollowing)
        setFollowerCount(data.followerCount)
      }
    } catch {}
  }

  const loadProject = async () => {
    setLoading(true)
    try {
      // Resolve by author + slug
      const res = await fetch(
        `${config.apiUrl}/api/public/projects/by-author-and-slug/${encodeURIComponent(authorUsername)}/${encodeURIComponent(projectSlug)}`
      )
      if (!res.ok) {
        setError(res.status === 404 ? 'Project not found' : 'Failed to load project')
        return
      }
      const data = await res.json()
      setProject(data.project)
      setAuthor(data.author)

      // Load TOC and tiers in parallel
      const uid = session?.user?.id
      const tocUrl = `${config.apiUrl}/api/public/projects/${data.project.id}/toc${uid ? `?userId=${uid}` : ''}`
      const ownerId = data.project.ownerId || data.author?.userId
      const [tocRes, tiersRes] = await Promise.all([
        fetch(tocUrl),
        ownerId
          ? fetch(`${config.apiUrl}/api/users/${ownerId}/subscription-tiers`)
          : Promise.resolve(null)
      ])

      if (tocRes.ok) {
        const tocData = await tocRes.json()
        setToc(tocData.toc || [])
      }

      if (tiersRes?.ok) {
        const tiersData = await tiersRes.json()
        setTiers((tiersData.tiers || []).filter((t: SubscriptionTier) => t.tierLevel > 0))
        setAcceptsPayments(tiersData.acceptsPayments ?? false)
      }
    } catch {
      setError('Failed to load project')
    } finally {
      setLoading(false)
    }
  }

  const handleFollowProject = async () => {
    if (!project?.id || !apiToken) return
    setFollowLoading(true)
    try {
      if (isFollowingProject) {
        const res = await apiFetch(`/api/projects/${project.id}/follow`, apiToken, { method: 'DELETE' })
        if (res.ok) {
          setIsFollowingProject(false)
          setFollowerCount(c => Math.max(0, c - 1))
        } else {
          const data = await res.json()
          setSubscribeError(data.error || 'Failed to unfollow')
        }
      } else {
        const res = await apiFetch(`/api/projects/${project.id}/follow`, apiToken, { method: 'POST' })
        if (res.ok) {
          setIsFollowingProject(true)
          setFollowerCount(c => c + 1)
        }
      }
    } catch {}
    setFollowLoading(false)
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 dark:bg-gray-950">
        <ReaderNav crumbs={[{ label: authorUsername, href: `/read/${authorUsername}` }]} />
        <div className="flex items-center justify-center py-32">
          <div className="text-gray-500 dark:text-gray-400">Loading...</div>
        </div>
      </div>
    )
  }

  if (error || !project) {
    return (
      <div className="min-h-screen bg-gray-50 dark:bg-gray-950">
        <ReaderNav crumbs={[{ label: authorUsername, href: `/read/${authorUsername}` }]} />
        <div className="flex items-center justify-center py-32">
          <div className="text-center">
            <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100 mb-2">
              {error || 'Project not found'}
            </h1>
            <Link href="/explore" className="text-blue-600 dark:text-blue-400 hover:underline">
              Browse Stories
            </Link>
          </div>
        </div>
      </div>
    )
  }

  const handleSubscribe = async (tierId: string) => {
    if (!userId || !author?.userId || !apiToken) return
    setSubscribing(tierId)
    setSubscribeError(null)
    try {
      // Use Stripe Checkout for paid tiers
      const tier = tiers.find(t => t.id === tierId)
      const price = parseFloat(tier?.priceMonthly || '0')

      if (price > 0) {
        const returnUrl = `${window.location.origin}/read/${authorUsername}/${projectSlug}`
        const res = await apiFetch('/api/subscribe/checkout', apiToken, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            subscriberId: userId,
            authorId: author.userId,
            tierId,
            billingPeriod,
            returnUrl
          })
        })
        if (res.ok) {
          const data = await res.json()
          if (data.checkoutUrl) {
            window.location.href = data.checkoutUrl
            return
          }
        } else {
          const data = await res.json()
          setSubscribeError(data.error || 'Failed to start checkout')
        }
      } else {
        // Free tier - use placeholder endpoint
        const res = await apiFetch(
          `/api/users/${userId}/subscribe`,
          apiToken,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ authorId: author.userId, tierId })
          }
        )
        if (res.ok) {
          setSubscribedTierId(tierId)
          // Auto-follow the project on subscribe
          if (!isFollowingProject && project?.id) {
            try {
              await apiFetch(`/api/projects/${project.id}/follow`, apiToken, { method: 'POST' })
              setIsFollowingProject(true)
              setFollowerCount(c => c + 1)
            } catch {}
          }
        } else {
          const data = await res.json()
          setSubscribeError(data.error || 'Failed to subscribe')
        }
      }
    } catch {
      setSubscribeError('Failed to subscribe. Please try again.')
    } finally {
      setSubscribing(null)
    }
  }

  const authorName = author?.displayName || author?.userName || 'Unknown Author'

  const getDisplayPrice = (tier: SubscriptionTier) => {
    if (billingPeriod === 'yearly' && tier.priceYearly) {
      return { price: tier.priceYearly, label: '/yr' }
    }
    return { price: tier.priceMonthly || '0', label: '/mo' }
  }

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-950">
      <ReaderNav crumbs={[
        { label: authorName, href: `/read/${authorUsername}` },
        { label: project.name }
      ]} />

      <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 py-8">

      {/* Success banner */}
      {(justSubscribed || searchParams.get('subscribed') === 'true') && (
        <div className="mb-6 bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-lg p-4">
          <p className="text-sm text-green-700 dark:text-green-300 font-medium">
            Subscription activated! You now have access to subscriber content.
          </p>
        </div>
      )}

      {/* Project header */}
      <div className="flex gap-6 mb-8">
        {project.coverImage && (
          <OptimizedImage
            src={project.coverImage}
            variant="thumb"
            alt={project.name}
            className="w-32 h-44 rounded-lg object-cover shadow-md flex-shrink-0"
          />
        )}
        <div className="min-w-0">
          <h1 className="font-display text-3xl font-bold text-gray-900 dark:text-gray-100 mb-2">
            {project.name}
          </h1>
          {author && (
            <Link
              href={author.username ? `/read/${author.username}` : '#'}
              className="text-sm text-blue-600 dark:text-blue-400 hover:underline"
            >
              by {authorName}
            </Link>
          )}

          {/* Follow + Subscribe buttons */}
          <div className="flex items-center gap-2 mt-3">
            {subscribedTierId ? (
              <span className="inline-flex items-center px-3 py-1 rounded-full text-xs font-medium bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400">
                Subscribed
              </span>
            ) : !isOwnProject && (
              <>
                {userId ? (
                  <button
                    onClick={handleFollowProject}
                    disabled={followLoading}
                    className={`text-xs px-3 py-1.5 rounded-full transition-colors disabled:opacity-50 ${
                      isFollowingProject
                        ? 'bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400 hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-900/20 dark:hover:text-red-400'
                        : 'bg-blue-600 text-white hover:bg-blue-700'
                    }`}
                  >
                    {isFollowingProject ? 'Following' : 'Follow'}
                  </button>
                ) : (
                  <Link
                    href="/login"
                    className="text-xs px-3 py-1.5 rounded-full bg-blue-600 text-white hover:bg-blue-700 transition-colors"
                  >
                    Follow
                  </Link>
                )}
                {tiers.length > 0 && (
                  <a
                    href="#support"
                    className="text-xs px-3 py-1.5 rounded-full bg-purple-600 text-white hover:bg-purple-700 transition-colors"
                  >
                    Subscribe
                  </a>
                )}
              </>
            )}
            {followerCount > 0 && (
              <span className="text-xs text-gray-400 dark:text-gray-500">
                {followerCount} follower{followerCount !== 1 ? 's' : ''}
              </span>
            )}
          </div>

          {project.description && (
            <p className="text-gray-600 dark:text-gray-300 mt-3 whitespace-pre-line">
              {project.description}
            </p>
          )}
        </div>
      </div>

      {/* Table of Contents */}
      <div className="mb-8">
        <h2 className="font-display text-xl font-semibold text-gray-900 dark:text-gray-100 mb-4">
          Table of Contents
        </h2>
        {toc.length === 0 ? (
          <p className="text-gray-500 dark:text-gray-400 italic">No published chapters yet.</p>
        ) : (
          <div className="space-y-1">
            {toc.map((chapter, index) => (
              <div key={chapter.id}>
                {chapter.locked ? (
                  <div className="flex items-center justify-between px-4 py-3 rounded-lg bg-gray-50 dark:bg-gray-900/30 opacity-60">
                    <div className="flex items-center gap-3">
                      <span className="text-sm text-gray-400 dark:text-gray-500 w-8 text-right">{index + 1}</span>
                      <span className="text-gray-500 dark:text-gray-400">{chapter.title || 'Untitled'}</span>
                    </div>
                    <svg className="w-4 h-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
                    </svg>
                  </div>
                ) : (
                  <Link
                    href={`/read/${authorUsername}/${projectSlug}/${chapter.id}`}
                    className="flex items-center justify-between px-4 py-3 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-900/30 transition-colors group"
                  >
                    <div className="flex items-center gap-3">
                      <span className="text-sm text-gray-400 dark:text-gray-500 w-8 text-right">{index + 1}</span>
                      <span className="text-gray-900 dark:text-gray-100 group-hover:text-blue-600 dark:group-hover:text-blue-400">
                        {chapter.title || 'Untitled'}
                      </span>
                    </div>
                    {chapter.publishedAt && (
                      <span className="text-xs text-gray-400 dark:text-gray-500">
                        {new Date(chapter.publishedAt).toLocaleDateString()}
                      </span>
                    )}
                  </Link>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Subscribe / Follow section */}
      {tiers.length > 0 && (
        <div id="support" className="border-t border-gray-200 dark:border-gray-800 pt-8">
          <h2 className="font-display text-xl font-semibold text-gray-900 dark:text-gray-100 mb-4">
            Support this Author
          </h2>

          {/* Billing period toggle */}
          {tiers.some(t => t.priceYearly) && (
            <div className="flex items-center gap-2 mb-4">
              <button
                onClick={() => setBillingPeriod('monthly')}
                className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                  billingPeriod === 'monthly'
                    ? 'bg-blue-600 text-white'
                    : 'bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-700'
                }`}
              >
                Monthly
              </button>
              <button
                onClick={() => setBillingPeriod('yearly')}
                className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                  billingPeriod === 'yearly'
                    ? 'bg-blue-600 text-white'
                    : 'bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-700'
                }`}
              >
                Yearly
              </button>
            </div>
          )}

          {subscribeError && (
            <p className="text-sm text-red-600 dark:text-red-400 mb-3">{subscribeError}</p>
          )}
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {tiers.map(tier => {
              const { price, label } = getDisplayPrice(tier)
              const isPaid = parseFloat(tier.priceMonthly || '0') > 0
              const canSubscribe = !isPaid || acceptsPayments

              return (
                <div
                  key={tier.id}
                  className={`p-4 rounded-lg border bg-gray-50 dark:bg-gray-900/30 ${
                    subscribedTierId === tier.id
                      ? 'border-green-500 dark:border-green-400'
                      : 'border-gray-200 dark:border-gray-700'
                  }`}
                >
                  <h3 className="font-medium text-gray-900 dark:text-gray-100">{tier.name}</h3>
                  <p className="text-lg font-bold text-gray-900 dark:text-gray-100 mt-1">
                    ${price}<span className="text-sm font-normal text-gray-500">{label}</span>
                  </p>
                  {tier.description && (
                    <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">{tier.description}</p>
                  )}
                  {tier.benefits && (tier.benefits as string[]).length > 0 && (
                    <ul className="space-y-1 mt-2 mb-2">
                      {(tier.benefits as string[]).map((benefit, i) => (
                        <li key={i} className="flex items-start gap-1.5 text-xs text-gray-600 dark:text-gray-400">
                          <svg className="w-3.5 h-3.5 text-green-500 mt-0.5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                          </svg>
                          {benefit}
                        </li>
                      ))}
                    </ul>
                  )}
                  <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                    {tier.chapterDelayDays === 0 ? 'Immediate access' : `${tier.chapterDelayDays}d early access`}
                  </p>
                  {subscribedTierId === tier.id ? (
                    <div className="w-full mt-3 px-3 py-1.5 bg-green-600 text-white rounded text-sm text-center">
                      Subscribed
                    </div>
                  ) : !canSubscribe ? (
                    <div className="w-full mt-3 px-3 py-1.5 bg-gray-200 dark:bg-gray-700 text-gray-500 dark:text-gray-400 rounded text-sm text-center">
                      Author hasn&apos;t enabled payments yet
                    </div>
                  ) : session?.user ? (
                    <button
                      onClick={() => handleSubscribe(tier.id)}
                      disabled={subscribing !== null}
                      className="w-full mt-3 px-3 py-1.5 bg-blue-600 text-white rounded text-sm hover:bg-blue-700 transition-colors disabled:opacity-50"
                    >
                      {subscribing === tier.id ? 'Subscribing...' : 'Subscribe'}
                    </button>
                  ) : (
                    <a
                      href="/login"
                      className="block w-full mt-3 px-3 py-1.5 bg-blue-600 text-white rounded text-sm hover:bg-blue-700 transition-colors text-center"
                    >
                      Sign in to Subscribe
                    </a>
                  )}
                </div>
              )
            })}
          </div>
        </div>
      )}
      </div>
    </div>
  )
}
