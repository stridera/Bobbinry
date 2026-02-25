'use client'

import { useState, useEffect } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { useSession } from 'next-auth/react'
import Link from 'next/link'
import { config } from '@/lib/config'
import { apiFetch } from '@/lib/api'

interface UserProfile {
  userId: string
  username: string
  displayName: string | null
  bio: string | null
  avatarUrl: string | null
  websiteUrl: string | null
  twitterHandle: string | null
  discordHandle: string | null
  otherSocials: Record<string, string> | null
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

export default function PublicProfilePage() {
  const params = useParams()
  const router = useRouter()
  const username = params.username as string
  const { data: session } = useSession()

  const [profile, setProfile] = useState<UserProfile | null>(null)
  const [projects, setProjects] = useState<PublishedProject[]>([])
  const [tiers, setTiers] = useState<SubscriptionTier[]>([])
  const [isFollowing, setIsFollowing] = useState(false)
  const [loading, setLoading] = useState(true)
  const [followLoading, setFollowLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const isOwnProfile = session?.user?.id === profile?.userId

  useEffect(() => {
    loadProfile()
  }, [username])

  useEffect(() => {
    if (profile?.userId && session?.user?.id && !isOwnProfile) {
      checkFollowStatus()
    }
  }, [profile?.userId, session?.user?.id])

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

      // Load published projects and tiers in parallel
      const [projectsRes, tiersRes] = await Promise.all([
        fetch(`${config.apiUrl}/api/users/${data.profile.userId}/published-projects`),
        fetch(`${config.apiUrl}/api/users/${data.profile.userId}/subscription-tiers`)
      ])

      if (projectsRes.ok) {
        const projectsData = await projectsRes.json()
        setProjects(projectsData.projects || [])
      }

      if (tiersRes.ok) {
        const tiersData = await tiersRes.json()
        setTiers((tiersData.tiers || []).filter((t: SubscriptionTier) => t.tierLevel > 0))
      }
    } catch (err) {
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
    if (!session?.apiToken || !session?.user?.id || !profile?.userId) return
    setFollowLoading(true)
    try {
      if (isFollowing) {
        await apiFetch(
          `/api/users/${session.user.id}/follow/${profile.userId}`,
          session.apiToken,
          { method: 'DELETE' }
        )
        setIsFollowing(false)
        setProfile(prev => prev ? { ...prev, followerCount: prev.followerCount - 1 } : prev)
      } else {
        await apiFetch(
          `/api/users/${session.user.id}/follow`,
          session.apiToken,
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

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 dark:bg-gray-900 flex items-center justify-center">
        <div className="text-gray-500 dark:text-gray-400">Loading profile...</div>
      </div>
    )
  }

  if (error || !profile) {
    return (
      <div className="min-h-screen bg-gray-50 dark:bg-gray-900 flex items-center justify-center">
        <div className="text-center">
          <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100 mb-2">
            {error || 'Profile not found'}
          </h1>
          <Link href="/dashboard" className="text-blue-600 dark:text-blue-400 hover:underline">
            Back to Dashboard
          </Link>
        </div>
      </div>
    )
  }

  const displayName = profile.displayName || profile.userName || profile.username

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900">
      {/* Header */}
      <header className="bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-4">
          <Link href="/dashboard" className="text-sm text-gray-500 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-100 transition-colors">
            &larr; Back
          </Link>
        </div>
      </header>

      {/* Profile section */}
      <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-8 animate-fade-in">
        <div className="bg-white dark:bg-gray-800 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700 p-6 mb-6">
          <div className="flex items-start gap-6">
            {/* Avatar */}
            <div className="flex-shrink-0">
              {profile.avatarUrl ? (
                <img
                  src={profile.avatarUrl}
                  alt={displayName}
                  className="w-20 h-20 rounded-full object-cover"
                />
              ) : (
                <div className="w-20 h-20 rounded-full bg-blue-600 dark:bg-blue-700 flex items-center justify-center text-white text-2xl font-bold">
                  {displayName.charAt(0).toUpperCase()}
                </div>
              )}
            </div>

            {/* Info */}
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-3 mb-1">
                <h1 className="font-display text-2xl font-bold text-gray-900 dark:text-gray-100 truncate">
                  {displayName}
                </h1>
                {isOwnProfile && (
                  <Link
                    href="/settings"
                    className="text-xs px-2 py-1 rounded bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600 transition-colors"
                  >
                    Edit Profile
                  </Link>
                )}
              </div>
              <p className="text-sm text-gray-500 dark:text-gray-400 mb-3">@{profile.username}</p>

              {profile.bio && (
                <p className="text-gray-700 dark:text-gray-300 mb-4 whitespace-pre-line">{profile.bio}</p>
              )}

              {/* Stats */}
              <div className="flex items-center gap-6 text-sm mb-4">
                <span className="text-gray-900 dark:text-gray-100">
                  <strong>{profile.followerCount}</strong>{' '}
                  <span className="text-gray-500 dark:text-gray-400">followers</span>
                </span>
                <span className="text-gray-900 dark:text-gray-100">
                  <strong>{profile.followingCount}</strong>{' '}
                  <span className="text-gray-500 dark:text-gray-400">following</span>
                </span>
                <span className="text-gray-900 dark:text-gray-100">
                  <strong>{projects.length}</strong>{' '}
                  <span className="text-gray-500 dark:text-gray-400">published works</span>
                </span>
              </div>

              {/* Social links */}
              <div className="flex items-center gap-3 flex-wrap">
                {profile.websiteUrl && (
                  <a
                    href={profile.websiteUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-sm text-blue-600 dark:text-blue-400 hover:underline"
                  >
                    {profile.websiteUrl.replace(/^https?:\/\//, '')}
                  </a>
                )}
                {profile.twitterHandle && (
                  <span className="text-sm text-gray-500 dark:text-gray-400">
                    @{profile.twitterHandle}
                  </span>
                )}
                {profile.discordHandle && (
                  <span className="text-sm text-gray-500 dark:text-gray-400">
                    Discord: {profile.discordHandle}
                  </span>
                )}
              </div>
            </div>

            {/* Follow button */}
            {!isOwnProfile && session?.user && (
              <div className="flex-shrink-0">
                <button
                  onClick={handleFollow}
                  disabled={followLoading}
                  className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                    isFollowing
                      ? 'bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 hover:bg-red-50 dark:hover:bg-red-900/20 hover:text-red-600 dark:hover:text-red-400'
                      : 'bg-blue-600 text-white hover:bg-blue-700'
                  } disabled:opacity-50`}
                >
                  {followLoading ? '...' : isFollowing ? 'Following' : 'Follow'}
                </button>
              </div>
            )}

            {!session?.user && (
              <div className="flex-shrink-0">
                <Link
                  href="/login"
                  className="px-4 py-2 rounded-lg text-sm font-medium bg-blue-600 text-white hover:bg-blue-700 transition-colors"
                >
                  Sign in to Follow
                </Link>
              </div>
            )}
          </div>
        </div>

        {/* Published Works */}
        {projects.length > 0 && (
          <div className="mb-6">
            <h2 className="font-display text-lg font-semibold text-gray-900 dark:text-gray-100 mb-4">
              Published Works
            </h2>
            <div className="grid gap-4 sm:grid-cols-2">
              {projects.map(project => (
                <Link
                  key={project.id}
                  href={project.shortUrl ? `/read/${project.shortUrl}` : `/read/${project.id}`}
                  className="bg-white dark:bg-gray-800 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700 p-4 hover:shadow-md transition-shadow"
                >
                  <div className="flex gap-3">
                    {project.coverImage && (
                      <img
                        src={project.coverImage}
                        alt={project.name}
                        className="w-16 h-20 rounded object-cover flex-shrink-0"
                      />
                    )}
                    <div className="min-w-0">
                      <h3 className="font-medium text-gray-900 dark:text-gray-100 truncate">
                        {project.name}
                      </h3>
                      {project.description && (
                        <p className="text-sm text-gray-500 dark:text-gray-400 mt-1 line-clamp-2">
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
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {tiers.map(tier => (
                <div
                  key={tier.id}
                  className="bg-white dark:bg-gray-800 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700 p-5"
                >
                  <h3 className="font-medium text-gray-900 dark:text-gray-100 mb-1">{tier.name}</h3>
                  <div className="text-2xl font-bold text-gray-900 dark:text-gray-100 mb-2">
                    ${tier.priceMonthly || '0'}
                    <span className="text-sm font-normal text-gray-500 dark:text-gray-400">/mo</span>
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
                  {tier.chapterDelayDays === 0 ? (
                    <p className="text-xs text-green-600 dark:text-green-400 mb-3">Immediate access to new chapters</p>
                  ) : (
                    <p className="text-xs text-gray-500 dark:text-gray-400 mb-3">
                      New chapters {tier.chapterDelayDays} day{tier.chapterDelayDays !== 1 ? 's' : ''} after release
                    </p>
                  )}
                  <button
                    className="w-full px-4 py-2 rounded-lg text-sm font-medium bg-blue-600 text-white hover:bg-blue-700 transition-colors"
                    onClick={() => {
                      // Phase 4: Wire to Stripe Checkout
                      alert('Subscription checkout coming soon!')
                    }}
                  >
                    Subscribe
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
