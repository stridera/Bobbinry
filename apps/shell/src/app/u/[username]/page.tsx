'use client'

import { useState, useEffect } from 'react'
import { useParams, useRouter, useSearchParams } from 'next/navigation'
import { useSession } from 'next-auth/react'
import Link from 'next/link'
import { config } from '@/lib/config'
import { apiFetch } from '@/lib/api'
import { SiteNav } from '@/components/SiteNav'
import { OptimizedImage } from '@/components/OptimizedImage'
import { UserBadges } from '@/components/UserBadges'

interface UserProfile {
  userId: string
  username: string
  displayName: string | null
  bio: string | null
  avatarUrl: string | null
  websiteUrl: string | null
  blueskyHandle: string | null
  threadsHandle: string | null
  instagramHandle: string | null
  discordHandle: string | null
  userName: string | null
  followerCount: number
  followingCount: number
}

interface PublishedProject {
  id: string
  name: string
  description: string | null
  coverImage: string | null
  shortUrl: string | null
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

// Compact SVG icons for social platforms
function WebsiteIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10" />
      <path d="M2 12h20M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
    </svg>
  )
}

function BlueskyIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor">
      <path d="M12 10.8c-1.087-2.114-4.046-6.053-6.798-7.995C2.566.944 1.561 1.266.902 1.565.139 1.908 0 3.08 0 3.768c0 .69.378 5.65.624 6.479.785 2.643 3.593 3.512 6.137 3.045-3.894.695-7.39 2.373-2.882 8.381C8.882 28.227 16.146 18.08 12 10.8zm0 0c1.087-2.114 4.046-6.053 6.798-7.995C21.434.944 22.439 1.266 23.098 1.565 23.861 1.908 24 3.08 24 3.768c0 .69-.378 5.65-.624 6.479-.785 2.643-3.593 3.512-6.137 3.045 3.894.695 7.39 2.373 2.882 8.381C15.118 28.227 7.854 18.08 12 10.8z" />
    </svg>
  )
}

function ThreadsIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor">
      <path d="M12.186 24h-.007C5.965 23.97 2.634 20.273 2.634 14.618c0-5.986 3.632-9.384 9.552-9.384 4.607 0 7.623 2.368 8.608 6.392l-2.832.728c-.676-2.786-2.574-4.32-5.776-4.32-4.078 0-6.315 2.666-6.315 6.584 0 4.088 2.218 6.67 6.315 6.67 2.1 0 3.722-.578 4.69-1.672.89-1.007 1.323-2.395 1.287-4.128-.297.157-.615.296-.955.414-.86.3-1.8.45-2.794.45-4.378 0-6.56-2.17-6.2-5.536.24-2.244 1.762-4.39 5.356-4.39 2.505 0 4.23 1.258 4.752 3.466l.016.068c.126.587.192 1.224.192 1.904 0 3.32-.835 5.782-2.415 7.113C14.764 23.36 13.5 24 12.186 24zm1.638-11.164c-.983 0-2.175.45-2.335 1.946-.178 1.664.892 2.705 3.007 2.705.625 0 1.19-.088 1.695-.262.067-.556.098-1.14.098-1.743 0-.422-.033-.818-.097-1.186-.322-1.176-1.263-1.46-2.368-1.46z" />
    </svg>
  )
}

function InstagramIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round">
      <rect x="2" y="2" width="20" height="20" rx="5" />
      <circle cx="12" cy="12" r="5" />
      <circle cx="17.5" cy="6.5" r="1.5" fill="currentColor" stroke="none" />
    </svg>
  )
}

function DiscordIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor">
      <path d="M20.317 4.37a19.791 19.791 0 0 0-4.885-1.515.074.074 0 0 0-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 0 0-5.487 0 12.64 12.64 0 0 0-.617-1.25.077.077 0 0 0-.079-.037A19.736 19.736 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057a.082.082 0 0 0 .031.057 19.9 19.9 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028 14.09 14.09 0 0 0 1.226-1.994.076.076 0 0 0-.041-.106 13.107 13.107 0 0 1-1.872-.892.077.077 0 0 1-.008-.128 10.2 10.2 0 0 0 .372-.292.074.074 0 0 1 .077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 0 1 .078.01c.12.098.246.198.373.292a.077.077 0 0 1-.006.127 12.299 12.299 0 0 1-1.873.892.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028 19.839 19.839 0 0 0 6.002-3.03.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.03zM8.02 15.33c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.956-2.419 2.157-2.419 1.21 0 2.176 1.095 2.157 2.42 0 1.333-.956 2.418-2.157 2.418zm7.975 0c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.956-2.419 2.157-2.419 1.21 0 2.176 1.095 2.157 2.42 0 1.333-.947 2.418-2.157 2.418z" />
    </svg>
  )
}

export default function PublicProfilePage() {
  const params = useParams()
  const router = useRouter()
  const searchParams = useSearchParams()
  const username = params.username as string
  const { data: session } = useSession()

  const [profile, setProfile] = useState<UserProfile | null>(null)
  const [projects, setProjects] = useState<PublishedProject[]>([])
  const [tiers, setTiers] = useState<SubscriptionTier[]>([])
  const [acceptsPayments, setAcceptsPayments] = useState(false)
  const [badges, setBadges] = useState<string[]>([])
  const [isFollowing, setIsFollowing] = useState(false)
  const [loading, setLoading] = useState(true)
  const [followLoading, setFollowLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [subscribing, setSubscribing] = useState<string | null>(null)
  const [subscribeError, setSubscribeError] = useState<string | null>(null)
  const [subscribedTierId, setSubscribedTierId] = useState<string | null>(null)
  const [billingPeriod, setBillingPeriod] = useState<'monthly' | 'yearly'>('monthly')
  const [justSubscribed, setJustSubscribed] = useState(false)

  const apiToken = (session as any)?.apiToken as string | undefined
  const isOwnProfile = session?.user?.id === profile?.userId

  // Handle ?subscribed=true return from Stripe
  useEffect(() => {
    if (searchParams.get('subscribed') === 'true') {
      setJustSubscribed(true)
    }
  }, [searchParams])

  // Retry loading subscription state after Stripe redirect (webhook may be delayed)
  useEffect(() => {
    if (!justSubscribed || subscribedTierId || !profile?.userId || !session?.user?.id || !apiToken) return
    let attempts = 0
    const maxAttempts = 5
    const interval = setInterval(async () => {
      attempts++
      try {
        const res = await apiFetch(`/api/users/${session.user.id}/subscriptions?status=active`, apiToken)
        if (res.ok) {
          const data = await res.json()
          const match = data.subscriptions?.find(
            (s: any) => s.subscription?.authorId === profile.userId
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
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [justSubscribed, subscribedTierId, profile?.userId, session?.user?.id, apiToken])

  useEffect(() => {
    loadProfile()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [username])

  useEffect(() => {
    if (profile?.userId && session?.user?.id && !isOwnProfile) {
      checkFollowStatus()
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile?.userId, session?.user?.id])

  // Load subscription state
  useEffect(() => {
    if (!profile?.userId || !session?.user?.id || !apiToken || isOwnProfile) return
    loadSubscriptionState()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile?.userId, session?.user?.id, apiToken])

  const loadSubscriptionState = async () => {
    if (!session?.user?.id || !apiToken || !profile?.userId) return
    try {
      const res = await apiFetch(`/api/users/${session.user.id}/subscriptions?status=active`, apiToken)
      if (res.ok) {
        const data = await res.json()
        const match = data.subscriptions?.find(
          (s: any) => s.subscription?.authorId === profile.userId
        )
        if (match) {
          setSubscribedTierId(match.subscription.tierId)
        }
      }
    } catch {}
  }

  const loadProfile = async () => {
    setLoading(true)
    setError(null)
    try {
      // Try username lookup first, fall back to user ID lookup
      let data: any = null
      const res = await fetch(`${config.apiUrl}/api/users/by-username/${encodeURIComponent(username)}`)
      if (res.ok) {
        data = await res.json()
      } else {
        // username not found — try as a user ID (UUID)
        const idRes = await fetch(`${config.apiUrl}/api/users/${encodeURIComponent(username)}/profile`)
        if (idRes.ok) {
          const idData = await idRes.json()
          if (idData.profile) {
            // Wrap in the same shape as by-username response
            data = {
              profile: {
                ...idData.profile,
                followerCount: 0,
                followingCount: 0,
                userName: null
              }
            }
          }
        }
      }

      if (!data?.profile) {
        setError('User not found')
        return
      }

      // If we resolved via user ID and the profile has a username,
      // redirect to the clean URL so it's shareable
      const isUUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(username)
      if (isUUID && data.profile.username) {
        router.replace(`/u/${data.profile.username}`)
        return
      }

      setProfile(data.profile)

      // Load published projects, tiers, and badges in parallel
      const [projectsRes, tiersRes, badgesRes] = await Promise.all([
        fetch(`${config.apiUrl}/api/users/${data.profile.userId}/published-projects`),
        fetch(`${config.apiUrl}/api/users/${data.profile.userId}/subscription-tiers`),
        fetch(`${config.apiUrl}/api/users/${data.profile.userId}/badges`)
      ])

      if (projectsRes.ok) {
        const projectsData = await projectsRes.json()
        setProjects(projectsData.projects || [])
      }

      if (tiersRes.ok) {
        const tiersData = await tiersRes.json()
        setTiers((tiersData.tiers || []).filter((t: SubscriptionTier) => t.tierLevel > 0))
        setAcceptsPayments(tiersData.acceptsPayments ?? false)
      }

      if (badgesRes.ok) {
        const badgesData = await badgesRes.json()
        setBadges(badgesData.badges || [])
      }
    } catch {
      setError('Failed to load profile')
    } finally {
      setLoading(false)
    }
  }

  const checkFollowStatus = async () => {
    if (!session?.user?.id || !profile?.userId) return
    try {
      const res = await fetch(
        `${config.apiUrl}/api/users/${session.user.id}/is-following/${profile.userId}`
      )
      if (res.ok) {
        const data = await res.json()
        setIsFollowing(data.isFollowing)
      }
    } catch {}
  }

  const handleFollow = async () => {
    if (!apiToken || !session?.user?.id || !profile?.userId) return
    setFollowLoading(true)
    try {
      if (isFollowing) {
        await apiFetch(
          `/api/users/${session.user.id}/follow/${profile.userId}`,
          apiToken,
          { method: 'DELETE' }
        )
        setIsFollowing(false)
        setProfile(prev => prev ? { ...prev, followerCount: prev.followerCount - 1 } : prev)
      } else {
        await apiFetch(
          `/api/users/${session.user.id}/follow`,
          apiToken,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ followingId: profile.userId })
          }
        )
        setIsFollowing(true)
        setProfile(prev => prev ? { ...prev, followerCount: prev.followerCount + 1 } : prev)
      }
    } catch (err) {
      console.error('Failed to update follow status:', err)
    } finally {
      setFollowLoading(false)
    }
  }

  const handleSubscribe = async (tierId: string) => {
    if (!session?.user?.id || !profile?.userId || !apiToken) return
    setSubscribing(tierId)
    setSubscribeError(null)
    try {
      const tier = tiers.find(t => t.id === tierId)
      const price = parseFloat(tier?.priceMonthly || '0')

      if (price > 0) {
        const returnUrl = `${window.location.origin}/u/${username}`
        const res = await apiFetch('/api/subscribe/checkout', apiToken, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            subscriberId: session.user.id,
            authorId: profile.userId,
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
        // Free tier
        const res = await apiFetch(
          `/api/users/${session.user.id}/subscribe`,
          apiToken,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ authorId: profile.userId, tierId })
          }
        )
        if (res.ok) {
          setSubscribedTierId(tierId)
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

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 dark:bg-gray-950">
        <SiteNav />
        <div className="flex items-center justify-center py-32">
          <div className="text-gray-500 dark:text-gray-400">Loading profile...</div>
        </div>
      </div>
    )
  }

  if (error || !profile) {
    return (
      <div className="min-h-screen bg-gray-50 dark:bg-gray-950">
        <SiteNav />
        <div className="flex items-center justify-center py-32">
          <div className="text-center">
            <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100 mb-2">
              {error || 'Profile not found'}
            </h1>
            <Link href="/explore" className="text-blue-600 dark:text-blue-400 hover:underline">
              Browse Stories
            </Link>
          </div>
        </div>
      </div>
    )
  }

  const displayName = profile.displayName || profile.userName || profile.username || 'User'
  const hasSocials = profile.websiteUrl || profile.blueskyHandle || profile.threadsHandle || profile.instagramHandle || profile.discordHandle

  const getDisplayPrice = (tier: SubscriptionTier) => {
    if (billingPeriod === 'yearly' && tier.priceYearly) {
      return { price: tier.priceYearly, label: '/yr' }
    }
    return { price: tier.priceMonthly || '0', label: '/mo' }
  }

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-950">
      <SiteNav />

      <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-8 animate-fade-in">

        {/* Success banner */}
        {justSubscribed && (
          <div className="mb-6 bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-lg p-4">
            <p className="text-sm text-green-700 dark:text-green-300 font-medium">
              Subscription activated! You now have access to subscriber content.
            </p>
          </div>
        )}

        {/* Profile Hero */}
        <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-200 dark:border-gray-700 overflow-hidden mb-8">
          {/* Decorative header band */}
          <div className="h-24 bg-gradient-to-br from-blue-500/20 via-blue-600/10 to-purple-500/10 dark:from-blue-500/10 dark:via-blue-600/5 dark:to-purple-500/5" />

          <div className="px-6 pb-6">
            {/* Avatar + actions row */}
            <div className="flex items-end justify-between -mt-12 mb-4">
              <div className="ring-4 ring-white dark:ring-gray-800 rounded-full">
                {profile.avatarUrl ? (
                  <OptimizedImage
                    src={profile.avatarUrl}
                    variant="thumb"
                    alt={displayName}
                    className="w-24 h-24 rounded-full object-cover"
                  />
                ) : (
                  <div className="w-24 h-24 rounded-full bg-blue-600 dark:bg-blue-700 flex items-center justify-center text-white text-3xl font-bold">
                    {displayName.charAt(0).toUpperCase()}
                  </div>
                )}
              </div>

              <div className="flex items-center gap-2">
                {isOwnProfile && (
                  <Link
                    href="/settings"
                    className="px-4 py-2 rounded-lg text-sm font-medium border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
                  >
                    Edit Profile
                  </Link>
                )}
                {!isOwnProfile && session?.user && (
                  <button
                    onClick={handleFollow}
                    disabled={followLoading}
                    className={`px-5 py-2 rounded-lg text-sm font-medium transition-colors disabled:opacity-50 ${
                      isFollowing
                        ? 'border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 hover:border-red-300 dark:hover:border-red-700 hover:text-red-600 dark:hover:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/20'
                        : 'bg-blue-600 text-white hover:bg-blue-700'
                    }`}
                  >
                    {followLoading ? '...' : isFollowing ? 'Following' : 'Follow'}
                  </button>
                )}
                {!session?.user && (
                  <Link
                    href="/login"
                    className="px-5 py-2 rounded-lg text-sm font-medium bg-blue-600 text-white hover:bg-blue-700 transition-colors"
                  >
                    Sign in to Follow
                  </Link>
                )}
              </div>
            </div>

            {/* Name & username */}
            <div className="flex items-center gap-2">
              <h1 className="font-display text-2xl font-bold text-gray-900 dark:text-gray-100">
                {displayName}
              </h1>
              {badges.length > 0 && <UserBadges badges={badges} size="md" />}
            </div>
            <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">@{profile.username}</p>

            {/* Bio */}
            {profile.bio && (
              <p className="text-gray-700 dark:text-gray-300 mt-3 whitespace-pre-line leading-relaxed">
                {profile.bio}
              </p>
            )}

            {/* Stats */}
            <div className="flex items-center gap-5 mt-4 text-sm">
              <span className="text-gray-900 dark:text-gray-100">
                <strong>{profile.followerCount}</strong>{' '}
                <span className="text-gray-500 dark:text-gray-400">followers</span>
              </span>
              <span className="text-gray-300 dark:text-gray-600">|</span>
              <span className="text-gray-900 dark:text-gray-100">
                <strong>{profile.followingCount}</strong>{' '}
                <span className="text-gray-500 dark:text-gray-400">following</span>
              </span>
              <span className="text-gray-300 dark:text-gray-600">|</span>
              <span className="text-gray-900 dark:text-gray-100">
                <strong>{projects.length}</strong>{' '}
                <span className="text-gray-500 dark:text-gray-400">published works</span>
              </span>
            </div>

            {/* Social links as icon pills */}
            {hasSocials && (
              <div className="flex items-center gap-2 flex-wrap mt-4">
                {profile.websiteUrl && (
                  <a
                    href={profile.websiteUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600 transition-colors"
                  >
                    <WebsiteIcon className="w-3.5 h-3.5" />
                    {profile.websiteUrl.replace(/^https?:\/\/(www\.)?/, '').replace(/\/$/, '')}
                  </a>
                )}
                {profile.blueskyHandle && (
                  <a
                    href={`https://bsky.app/profile/${profile.blueskyHandle}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 hover:bg-blue-100 dark:hover:bg-blue-900/30 hover:text-blue-700 dark:hover:text-blue-300 transition-colors"
                  >
                    <BlueskyIcon className="w-3.5 h-3.5" />
                    @{profile.blueskyHandle}
                  </a>
                )}
                {profile.threadsHandle && (
                  <a
                    href={`https://www.threads.net/${profile.threadsHandle.replace(/^@/, '')}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600 transition-colors"
                  >
                    <ThreadsIcon className="w-3.5 h-3.5" />
                    {profile.threadsHandle}
                  </a>
                )}
                {profile.instagramHandle && (
                  <a
                    href={`https://www.instagram.com/${profile.instagramHandle.replace(/^@/, '')}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 hover:bg-pink-100 dark:hover:bg-pink-900/20 hover:text-pink-700 dark:hover:text-pink-300 transition-colors"
                  >
                    <InstagramIcon className="w-3.5 h-3.5" />
                    {profile.instagramHandle}
                  </a>
                )}
                {profile.discordHandle && (
                  <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300">
                    <DiscordIcon className="w-3.5 h-3.5" />
                    {profile.discordHandle}
                  </span>
                )}
              </div>
            )}
          </div>
        </div>

        {/* Published Works */}
        {projects.length > 0 && (
          <div className="mb-8">
            <h2 className="font-display text-lg font-semibold text-gray-900 dark:text-gray-100 mb-4">
              Published Works
            </h2>
            <div className="grid gap-4 sm:grid-cols-2">
              {projects.map(project => (
                <Link
                  key={project.id}
                  href={project.shortUrl ? `/read/${profile?.username || profile?.userId}/${project.shortUrl}` : '#'}
                  className="group bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-200 dark:border-gray-700 p-4 hover:shadow-md hover:border-blue-200 dark:hover:border-blue-800 transition-all"
                >
                  <div className="flex gap-4">
                    {project.coverImage ? (
                      <OptimizedImage
                        src={project.coverImage}
                        variant="thumb"
                        alt={project.name}
                        className="w-16 h-22 rounded-lg object-cover flex-shrink-0"
                      />
                    ) : (
                      <div className="w-16 h-22 rounded-lg bg-gray-100 dark:bg-gray-700 flex-shrink-0 flex items-center justify-center">
                        <svg className="w-6 h-6 text-gray-400 dark:text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" />
                        </svg>
                      </div>
                    )}
                    <div className="min-w-0 flex-1">
                      <h3 className="font-medium text-gray-900 dark:text-gray-100 truncate group-hover:text-blue-700 dark:group-hover:text-blue-400 transition-colors">
                        {project.name}
                      </h3>
                      {project.description && (
                        <p className="text-sm text-gray-500 dark:text-gray-400 mt-1 line-clamp-2 leading-relaxed">
                          {project.description}
                        </p>
                      )}
                    </div>
                  </div>
                </Link>
              ))}
            </div>
          </div>
        )}

        {/* Subscription Tiers */}
        {tiers.length > 0 && (
          <div>
            <h2 className="font-display text-lg font-semibold text-gray-900 dark:text-gray-100 mb-4">
              Support {displayName}
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

            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {tiers.map(tier => {
                const { price, label } = getDisplayPrice(tier)
                const isPaid = parseFloat(tier.priceMonthly || '0') > 0
                const canSubscribe = !isPaid || acceptsPayments

                return (
                  <div
                    key={tier.id}
                    className={`bg-white dark:bg-gray-800 rounded-xl shadow-sm border p-5 flex flex-col ${
                      subscribedTierId === tier.id
                        ? 'border-green-500 dark:border-green-400'
                        : 'border-gray-200 dark:border-gray-700'
                    }`}
                  >
                    <h3 className="font-medium text-gray-900 dark:text-gray-100 mb-1">{tier.name}</h3>
                    <div className="text-2xl font-bold text-gray-900 dark:text-gray-100 mb-2">
                      ${price}
                      <span className="text-sm font-normal text-gray-500 dark:text-gray-400">{label}</span>
                    </div>
                    {tier.description && (
                      <p className="text-sm text-gray-500 dark:text-gray-400 mb-3">{tier.description}</p>
                    )}
                    {tier.benefits && (tier.benefits as string[]).length > 0 && (
                      <ul className="space-y-1.5 mb-4">
                        {(tier.benefits as string[]).map((benefit, i) => (
                          <li key={i} className="flex items-start gap-2 text-sm text-gray-700 dark:text-gray-300">
                            <svg className="w-4 h-4 text-green-500 mt-0.5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                            </svg>
                            {benefit}
                          </li>
                        ))}
                      </ul>
                    )}
                    <div className="mt-auto">
                      {tier.chapterDelayDays === 0 ? (
                        <p className="text-xs text-green-600 dark:text-green-400 mb-3">Immediate access to new chapters</p>
                      ) : (
                        <p className="text-xs text-gray-500 dark:text-gray-400 mb-3">
                          New chapters {tier.chapterDelayDays} day{tier.chapterDelayDays !== 1 ? 's' : ''} after release
                        </p>
                      )}
                      {subscribedTierId === tier.id ? (
                        <Link
                          href="/settings/subscriptions"
                          className="block w-full px-4 py-2 bg-green-600 text-white rounded-lg text-sm text-center font-medium hover:bg-green-700 transition-colors"
                        >
                          Subscribed
                        </Link>
                      ) : subscribedTierId ? (
                        <Link
                          href="/settings/subscriptions"
                          className="block w-full px-4 py-2 border border-gray-300 dark:border-gray-600 text-gray-600 dark:text-gray-400 rounded-lg text-sm text-center font-medium hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
                        >
                          Manage Subscription
                        </Link>
                      ) : !canSubscribe ? (
                        <div className="w-full px-4 py-2 bg-gray-200 dark:bg-gray-700 text-gray-500 dark:text-gray-400 rounded-lg text-sm text-center">
                          Author hasn&apos;t enabled payments yet
                        </div>
                      ) : session?.user ? (
                        <button
                          className="w-full px-4 py-2 rounded-lg text-sm font-medium bg-blue-600 text-white hover:bg-blue-700 transition-colors disabled:opacity-50"
                          onClick={() => handleSubscribe(tier.id)}
                          disabled={subscribing !== null}
                        >
                          {subscribing === tier.id ? 'Subscribing...' : 'Subscribe'}
                        </button>
                      ) : (
                        <Link
                          href="/login"
                          className="block w-full px-4 py-2 rounded-lg text-sm font-medium bg-blue-600 text-white hover:bg-blue-700 transition-colors text-center"
                        >
                          Sign in to Subscribe
                        </Link>
                      )}
                    </div>
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
