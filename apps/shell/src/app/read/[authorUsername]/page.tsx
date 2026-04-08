'use client'

import { useState, useEffect } from 'react'
import { useParams } from 'next/navigation'
import { useSession } from 'next-auth/react'
import Link from 'next/link'
import { config } from '@/lib/config'
import { apiFetch } from '@/lib/api'
import { ReaderNav } from '@/components/ReaderNav'
import { OptimizedImage } from '@/components/OptimizedImage'

interface AuthorInfo {
  userId: string
  username: string
  displayName: string | null
  avatarUrl: string | null
  bio?: string | null
  userName: string | null
}

interface PublishedProject {
  id: string
  name: string
  description: string | null
  coverImage: string | null
  shortUrl: string | null
  createdAt: string
}

interface CollectionGroup {
  id: string
  name: string
  description: string | null
  coverImage: string | null
  colorTheme: string | null
  projectIds: string[]
}

export default function AuthorReadPage() {
  const params = useParams()
  const authorUsername = params.authorUsername as string
  const { data: session } = useSession()

  const [author, setAuthor] = useState<AuthorInfo | null>(null)
  const [projects, setProjects] = useState<PublishedProject[]>([])
  const [collections, setCollections] = useState<CollectionGroup[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [followedProjects, setFollowedProjects] = useState<Set<string>>(new Set())
  const [isSubscribed, setIsSubscribed] = useState(false)
  const [hasPaidTiers, setHasPaidTiers] = useState(false)

  const apiToken = (session as any)?.apiToken as string | undefined
  const userId = session?.user?.id

  useEffect(() => {
    loadAuthor()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authorUsername])

  // Check follow status and subscription when data is ready
  useEffect(() => {
    if (!author || projects.length === 0) return
    checkFollowStatuses()
    checkSubscription()
    checkTiers()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [author, projects, session])

  const loadAuthor = async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(
        `${config.apiUrl}/api/public/authors/${encodeURIComponent(authorUsername)}/projects`
      )
      if (!res.ok) {
        setError(res.status === 404 ? 'Author not found' : 'Failed to load author')
        return
      }
      const data = await res.json()
      setAuthor(data.author)
      setProjects(data.projects || [])
      setCollections(data.collections || [])
    } catch {
      setError('Failed to load author')
    } finally {
      setLoading(false)
    }
  }

  const checkFollowStatuses = async () => {
    if (!apiToken || projects.length === 0) return
    const headers: Record<string, string> = { 'Authorization': `Bearer ${apiToken}` }
    const results = await Promise.all(
      projects.map(async (p) => {
        try {
          const res = await fetch(
            `${config.apiUrl}/api/projects/${p.id}/follow-status`,
            { headers }
          )
          if (res.ok) {
            const data = await res.json()
            return data.isFollowing ? p.id : null
          }
        } catch {}
        return null
      })
    )
    setFollowedProjects(new Set(results.filter(Boolean) as string[]))
  }

  const checkSubscription = async () => {
    if (!userId || !author || !apiToken) return
    try {
      const res = await apiFetch(`/api/users/${userId}/subscriptions?status=active`, apiToken)
      if (res.ok) {
        const data = await res.json()
        const subs = data.subscriptions || []
        setIsSubscribed(subs.some((s: any) => s.subscription?.authorId === author.userId))
      }
    } catch {}
  }

  const checkTiers = async () => {
    if (!author) return
    try {
      const res = await fetch(
        `${config.apiUrl}/api/users/${author.userId}/subscription-tiers`
      )
      if (res.ok) {
        const data = await res.json()
        const paidTiers = (data.tiers || []).filter((t: any) => t.tierLevel > 0)
        setHasPaidTiers(paidTiers.length > 0)
      }
    } catch {}
  }

  const handleFollowProject = async (projectId: string) => {
    if (!apiToken) return
    const isCurrentlyFollowing = followedProjects.has(projectId)

    try {
      if (isCurrentlyFollowing) {
        const res = await apiFetch(`/api/projects/${projectId}/follow`, apiToken, { method: 'DELETE' })
        if (res.ok) {
          setFollowedProjects(prev => {
            const next = new Set(prev)
            next.delete(projectId)
            return next
          })
        }
      } else {
        const res = await apiFetch(`/api/projects/${projectId}/follow`, apiToken, { method: 'POST' })
        if (res.ok) {
          setFollowedProjects(prev => new Set(prev).add(projectId))
        }
      }
    } catch {}
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 dark:bg-gray-950">
        <ReaderNav crumbs={[{ label: 'Explore', href: '/explore' }]} />
        <div className="flex items-center justify-center py-32">
          <p className="text-gray-500 dark:text-gray-400">Loading...</p>
        </div>
      </div>
    )
  }

  if (error || !author) {
    return (
      <div className="min-h-screen bg-gray-50 dark:bg-gray-950">
        <ReaderNav crumbs={[{ label: 'Explore', href: '/explore' }]} />
        <div className="flex items-center justify-center py-32">
          <div className="text-center">
            <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100 mb-2">
              {error || 'Author not found'}
            </h1>
            <Link href="/explore" className="text-blue-600 dark:text-blue-400 hover:underline">
              Browse Stories
            </Link>
          </div>
        </div>
      </div>
    )
  }

  const displayName = author.displayName || author.userName || author.username
  const isOwnPage = userId === author.userId

  // Split projects into collection-grouped and uncategorized
  const collectionProjectIds = new Set(collections.flatMap(c => c.projectIds))
  const uncategorizedProjects = projects.filter(p => !collectionProjectIds.has(p.id))

  const renderProjectCard = (project: PublishedProject, badge?: string) => (
    <div
      key={project.id}
      className="group bg-white dark:bg-gray-900 rounded-lg border border-gray-200 dark:border-gray-800 hover:border-blue-300 dark:hover:border-blue-700 hover:shadow-md transition-all overflow-hidden"
    >
      <Link href={`/read/${author.username}/${project.shortUrl}`}>
        <div className="aspect-[16/9] bg-gradient-to-br from-blue-100 to-purple-100 dark:from-blue-900/30 dark:to-purple-900/30 relative overflow-hidden">
          {project.coverImage ? (
            <OptimizedImage
              src={project.coverImage}
              variant="thumb"
              alt={project.name}
              className="w-full h-full object-cover"
            />
          ) : (
            <div className="w-full h-full flex items-center justify-center">
              <span className="text-4xl font-bold text-blue-300 dark:text-blue-700 opacity-50">
                {project.name.charAt(0).toUpperCase()}
              </span>
            </div>
          )}
          {badge && (
            <span className="absolute top-2 left-2 bg-black/60 text-white text-xs font-medium px-2 py-0.5 rounded">
              {badge}
            </span>
          )}
        </div>
      </Link>
      <div className="p-4">
        <Link href={`/read/${author.username}/${project.shortUrl}`}>
          <h3 className="font-semibold text-gray-900 dark:text-gray-100 truncate group-hover:text-blue-600 dark:group-hover:text-blue-400 transition-colors">
            {project.name}
          </h3>
        </Link>
        {project.description && (
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1 line-clamp-2">
            {project.description}
          </p>
        )}

        {/* Follow / Subscribe buttons */}
        {!isOwnPage && (
          <div className="flex items-center gap-2 mt-3">
            {isSubscribed ? (
              <span className="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400">
                Subscribed
              </span>
            ) : (
              <>
                {userId ? (
                  <button
                    onClick={() => handleFollowProject(project.id)}
                    className={`text-xs px-2.5 py-1 rounded-full transition-colors ${
                      followedProjects.has(project.id)
                        ? 'bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400 hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-900/20 dark:hover:text-red-400'
                        : 'bg-blue-600 text-white hover:bg-blue-700'
                    }`}
                  >
                    {followedProjects.has(project.id) ? 'Following' : 'Follow'}
                  </button>
                ) : (
                  <Link
                    href="/login"
                    className="text-xs px-2.5 py-1 rounded-full bg-blue-600 text-white hover:bg-blue-700 transition-colors"
                  >
                    Follow
                  </Link>
                )}
                {hasPaidTiers && (
                  <Link
                    href={`/read/${author.username}/${project.shortUrl}#support`}
                    className="text-xs px-2.5 py-1 rounded-full bg-purple-600 text-white hover:bg-purple-700 transition-colors"
                  >
                    Subscribe
                  </Link>
                )}
              </>
            )}
          </div>
        )}
      </div>
    </div>
  )

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-950">
      <ReaderNav crumbs={[{ label: displayName, href: `/u/${author.username}` }, { label: 'Works' }]} />

      <div className="max-w-4xl mx-auto px-4 py-8">
        {/* Author header */}
        <div className="flex items-center gap-4 mb-8">
          {author.avatarUrl ? (
            <OptimizedImage
              src={author.avatarUrl}
              variant="thumb"
              alt={displayName}
              className="w-16 h-16 rounded-full object-cover"
            />
          ) : (
            <div className="w-16 h-16 rounded-full bg-gradient-to-br from-purple-400 to-blue-500 flex items-center justify-center text-white font-bold text-2xl">
              {displayName.charAt(0).toUpperCase()}
            </div>
          )}
          <div>
            <h1 className="font-display text-2xl font-bold text-gray-900 dark:text-gray-100">
              {displayName}
            </h1>
            <div className="flex items-center gap-3 text-sm text-gray-500 dark:text-gray-400">
              <span>@{author.username}</span>
              <span>&middot;</span>
              <span>{projects.length} published work{projects.length !== 1 ? 's' : ''}</span>
            </div>
            <Link
              href={`/u/${author.username}`}
              className="text-xs text-blue-600 dark:text-blue-400 hover:underline mt-1 inline-block"
            >
              View full profile
            </Link>
          </div>
        </div>

        {projects.length === 0 ? (
          <div className="text-center py-12">
            <p className="text-gray-500 dark:text-gray-400">
              This author hasn&apos;t published any stories yet.
            </p>
          </div>
        ) : (
          <div className="space-y-10">
            {/* Collection sections */}
            {collections.map(collection => {
              const collProjects = collection.projectIds
                .map(id => projects.find(p => p.id === id))
                .filter((p): p is PublishedProject => !!p)

              return (
                <section key={collection.id}>
                  <div className="flex items-center justify-between mb-4">
                    <div className="flex items-center gap-3 min-w-0">
                      <div className="flex items-center gap-2 min-w-0">
                        <svg className="w-5 h-5 text-gray-400 dark:text-gray-500 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
                        </svg>
                        <h2 className="font-display text-lg font-semibold text-gray-900 dark:text-gray-100 truncate">
                          {collection.name}
                        </h2>
                        <span className="text-xs text-gray-400 dark:text-gray-500 flex-shrink-0">
                          {collProjects.length} book{collProjects.length !== 1 ? 's' : ''}
                        </span>
                      </div>
                    </div>
                    <Link
                      href={`/read/${author.username}/collection/${collection.id}`}
                      className="text-xs text-blue-600 dark:text-blue-400 hover:underline flex-shrink-0"
                    >
                      View series
                    </Link>
                  </div>
                  {collection.description && (
                    <p className="text-sm text-gray-500 dark:text-gray-400 mb-4 -mt-2">
                      {collection.description}
                    </p>
                  )}
                  <div className="grid gap-4 sm:grid-cols-2">
                    {collProjects.map((project, index) =>
                      renderProjectCard(project, `Book ${index + 1}`)
                    )}
                  </div>
                </section>
              )
            })}

            {/* Uncategorized projects */}
            {uncategorizedProjects.length > 0 && (
              <section>
                {collections.length > 0 && (
                  <h2 className="font-display text-lg font-semibold text-gray-900 dark:text-gray-100 mb-4">
                    Standalone Works
                  </h2>
                )}
                <div className="grid gap-4 sm:grid-cols-2">
                  {uncategorizedProjects.map(project => renderProjectCard(project))}
                </div>
              </section>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
