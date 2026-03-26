'use client'

import { useState, useEffect, useRef, useCallback, Suspense } from 'react'
import { useParams, useSearchParams, useRouter } from 'next/navigation'
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
  defaultVisibility?: string
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
  lockReason?: string
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
  return (
    <Suspense fallback={
      <div className="min-h-screen bg-gray-50 dark:bg-gray-950">
        <div className="max-w-3xl mx-auto px-4 py-8">
          <div className="animate-pulse space-y-6">
            <div className="h-8 bg-gray-200 dark:bg-gray-800 rounded w-64" />
            <div className="h-44 bg-gray-200 dark:bg-gray-800 rounded-lg w-32" />
            <div className="h-64 bg-gray-200 dark:bg-gray-800 rounded-xl" />
          </div>
        </div>
      </div>
    }>
      <ProjectReadingContent />
    </Suspense>
  )
}

function ProjectReadingContent() {
  const params = useParams()
  const searchParams = useSearchParams()
  const router = useRouter()
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
  const [isMuted, setIsMuted] = useState(false)
  const [muteLoading, setMuteLoading] = useState(false)
  const [billingPeriod, setBillingPeriod] = useState<'monthly' | 'yearly'>('monthly')
  const [justSubscribed, setJustSubscribed] = useState(false)
  const supportRef = useRef<HTMLDivElement>(null)

  const scrollToSupport = useCallback(() => {
    const el = supportRef.current
    if (!el) return
    el.scrollIntoView({ behavior: 'smooth', block: 'start' })

    const grid = el.querySelector('.grid')
    if (!grid) return
    const cards = Array.from(grid.children) as HTMLElement[]
    if (cards.length === 0) return

    // Clean up any running animations
    cards.forEach(card => {
      card.classList.remove('tier-glow', 'tier-sparkle')
      card.style.removeProperty('--glow-delay')
    })
    void el.offsetWidth

    const stagger = 180
    const settle = 300

    cards.forEach((card, i) => {
      const isLast = i === cards.length - 1
      card.style.setProperty('--glow-delay', `${settle + i * stagger}ms`)
      card.classList.add(isLast ? 'tier-sparkle' : 'tier-glow')
    })

    // Clean up after all animations complete
    setTimeout(() => {
      cards.forEach(card => {
        card.classList.remove('tier-glow', 'tier-sparkle')
        card.style.removeProperty('--glow-delay')
      })
    }, settle + cards.length * stagger + 1800)
  }, [])

  const apiToken = (session as any)?.apiToken as string | undefined
  const userId = session?.user?.id
  const isOwnProject = !!(userId && author?.userId === userId)

  // Handle ?subscribed=true return from Stripe
  useEffect(() => {
    if (searchParams.get('subscribed') === 'true') {
      setJustSubscribed(true)
      // Clear the query param to prevent re-triggering on re-renders
      router.replace(`/read/${authorUsername}/${projectSlug}`, { scroll: false })
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams])

  // Retry loading subscription state after Stripe redirect (webhook may be delayed)
  useEffect(() => {
    if (!justSubscribed || subscribedTierId || !author?.userId || !userId || !apiToken) return
    let attempts = 0
    const maxAttempts = 5
    const interval = setInterval(async () => {
      attempts++
      try {
        const res = await apiFetch(`/api/users/${userId}/subscriptions?status=active`, apiToken)
        if (res.ok) {
          const data = await res.json()
          const match = data.subscriptions?.find(
            (s: any) => s.subscription?.authorId === author.userId
          )
          if (match) {
            setSubscribedTierId(match.subscription.tierId)
            clearInterval(interval)
          }
        }
      } catch {}
      if (attempts >= maxAttempts) clearInterval(interval)
    }, 2000)
    return () => clearInterval(interval)
  }, [justSubscribed, subscribedTierId, author?.userId, userId, apiToken])

  useEffect(() => {
    loadProject()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authorUsername, projectSlug])

  // Load follow status when project and session are ready
  useEffect(() => {
    if (!project?.id) return
    loadFollowStatus(project.id)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project?.id, apiToken])

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
        setIsMuted(data.muted ?? false)
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

  const handleToggleMute = async () => {
    if (!project?.id || !apiToken || !isFollowingProject) return
    setMuteLoading(true)
    try {
      const res = await apiFetch(`/api/projects/${project.id}/follow`, apiToken, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ muted: !isMuted }),
      })
      if (res.ok) {
        setIsMuted(!isMuted)
      }
    } catch {}
    setMuteLoading(false)
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
          <div className="flex items-center gap-3 mb-2">
            <h1 className="font-display text-3xl font-bold text-gray-900 dark:text-gray-100">
              {project.name}
            </h1>
            {project.defaultVisibility === 'subscribers_only' && (
              <span className="inline-flex items-center rounded-full bg-purple-100 px-2.5 py-0.5 text-xs font-medium text-purple-700 dark:bg-purple-900/30 dark:text-purple-400">
                Subscribers Only
              </span>
            )}
          </div>
          {author && (
            <Link
              href={author.username ? `/read/${author.username}` : '#'}
              className="text-sm text-blue-600 dark:text-blue-400 hover:underline"
            >
              by {authorName}
            </Link>
          )}

          {/* Follow + Subscribe + Mute buttons */}
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
                  <button
                    onClick={scrollToSupport}
                    className="text-xs px-3 py-1.5 rounded-full bg-purple-600 text-white hover:bg-purple-700 transition-colors"
                  >
                    Subscribe
                  </button>
                )}
              </>
            )}
            {isFollowingProject && userId && (
              <button
                onClick={handleToggleMute}
                disabled={muteLoading}
                title={isMuted ? 'Unmute notifications' : 'Mute notifications'}
                className={`p-1.5 rounded-full transition-colors disabled:opacity-50 ${
                  isMuted
                    ? 'text-amber-500 dark:text-amber-400 bg-amber-50 dark:bg-amber-900/20 hover:bg-amber-100 dark:hover:bg-amber-900/40'
                    : 'text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800'
                }`}
              >
                {isMuted ? (
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5.586 15H4a1 1 0 01-1-1v-4a1 1 0 011-1h1.586l4.707-4.707C10.923 3.663 12 4.109 12 5v14c0 .891-1.077 1.337-1.707.707L5.586 15z" />
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2" />
                  </svg>
                ) : (
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" />
                  </svg>
                )}
              </button>
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

      {/* Subscriber-only CTA */}
      {project.defaultVisibility === 'subscribers_only' && !subscribedTierId && !isOwnProject && (
        <div className="mb-6 rounded-lg border border-purple-200 bg-purple-50 p-4 dark:border-purple-800 dark:bg-purple-900/20">
          <p className="text-sm text-purple-700 dark:text-purple-300">
            This is a subscriber-only project. Subscribe to access all chapters.
          </p>
          {tiers.length > 0 && (
            <button onClick={scrollToSupport} className="mt-2 text-sm font-medium text-purple-600 hover:underline dark:text-purple-400">
              View subscription tiers
            </button>
          )}
        </div>
      )}

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
                    <span className="text-xs text-gray-400 dark:text-gray-500">
                      {chapter.lockReason === 'subscription_required'
                        ? 'Subscribe to read'
                        : chapter.embargoUntil
                          ? new Date(chapter.embargoUntil).toLocaleString()
                          : 'Scheduled'}
                    </span>
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
        <div ref={supportRef} id="support" className="border-t border-gray-200 dark:border-gray-800 pt-8">
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
                    <Link
                      href="/settings/subscriptions"
                      className="block w-full mt-3 px-3 py-1.5 bg-green-600 text-white rounded text-sm text-center hover:bg-green-700 transition-colors"
                    >
                      Subscribed
                    </Link>
                  ) : subscribedTierId ? (
                    <Link
                      href="/settings/subscriptions"
                      className="block w-full mt-3 px-3 py-1.5 border border-gray-300 dark:border-gray-600 text-gray-600 dark:text-gray-400 rounded text-sm text-center hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
                    >
                      Manage Subscription
                    </Link>
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
                    <Link
                      href="/login"
                      className="block w-full mt-3 px-3 py-1.5 bg-blue-600 text-white rounded text-sm hover:bg-blue-700 transition-colors text-center"
                    >
                      Sign in to Subscribe
                    </Link>
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
