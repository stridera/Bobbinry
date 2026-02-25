'use client'

import { useState, useEffect, useCallback } from 'react'
import { useSession } from 'next-auth/react'
import Link from 'next/link'
import { config } from '@/lib/config'
import { apiFetch } from '@/lib/api'

interface DiscoverProject {
  id: string
  name: string
  description: string | null
  coverImage: string | null
  shortUrl: string | null
  updatedAt: string
  authorId: string
  authorUsername: string | null
  authorDisplayName: string
  authorAvatarUrl: string | null
  tags: string[]
  tagDetails: Array<{ name: string; category: string }>
  chapterCount: number
  totalViews: number
}

interface DiscoverAuthor {
  userId: string
  username: string | null
  displayName: string
  bio: string | null
  avatarUrl: string | null
  followerCount: number
  publishedProjectCount: number
}

interface Tag {
  name: string
  category: string
  projectCount: number
}

type ActiveTab = 'stories' | 'authors'
type StorySort = 'recent' | 'popular' | 'trending'
type AuthorSort = 'popular' | 'recent' | 'alphabetical'

export default function ExplorePage() {
  const { data: session } = useSession()
  const [activeTab, setActiveTab] = useState<ActiveTab>('stories')
  const [searchQuery, setSearchQuery] = useState('')
  const [debouncedQuery, setDebouncedQuery] = useState('')
  const [selectedGenre, setSelectedGenre] = useState<string | null>(null)
  const [storySort, setStorySort] = useState<StorySort>('recent')
  const [authorSort, setAuthorSort] = useState<AuthorSort>('popular')

  const [projects, setProjects] = useState<DiscoverProject[]>([])
  const [authors, setAuthors] = useState<DiscoverAuthor[]>([])
  const [tags, setTags] = useState<Tag[]>([])
  const [followedAuthors, setFollowedAuthors] = useState<Set<string>>(new Set())

  const [projectsTotal, setProjectsTotal] = useState(0)
  const [authorsTotal, setAuthorsTotal] = useState(0)
  const [projectsHasMore, setProjectsHasMore] = useState(false)
  const [authorsHasMore, setAuthorsHasMore] = useState(false)
  const [loadingProjects, setLoadingProjects] = useState(true)
  const [loadingAuthors, setLoadingAuthors] = useState(false)
  const [loadingMore, setLoadingMore] = useState(false)

  const apiToken = (session as any)?.apiToken
  const userId = session?.user?.id

  // Debounce search query
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedQuery(searchQuery), 300)
    return () => clearTimeout(timer)
  }, [searchQuery])

  // Load genre tags on mount
  useEffect(() => {
    fetch(`${config.apiUrl}/api/discover/tags?category=genre&limit=30`)
      .then(r => r.json())
      .then(data => setTags(data.tags || []))
      .catch(() => {})
  }, [])

  // Load projects when filters change
  const loadProjects = useCallback(async (append = false) => {
    if (append) setLoadingMore(true)
    else setLoadingProjects(true)

    try {
      const params = new URLSearchParams()
      if (debouncedQuery) params.set('q', debouncedQuery)
      if (selectedGenre) params.set('genre', selectedGenre)
      params.set('sort', storySort)
      params.set('limit', '18')
      if (append) params.set('offset', String(projects.length))

      const res = await fetch(`${config.apiUrl}/api/discover/projects?${params}`)
      const data = await res.json()

      if (append) {
        setProjects(prev => [...prev, ...(data.projects || [])])
      } else {
        setProjects(data.projects || [])
      }
      setProjectsTotal(data.total || 0)
      setProjectsHasMore(data.hasMore || false)
    } catch {
      if (!append) setProjects([])
    } finally {
      setLoadingProjects(false)
      setLoadingMore(false)
    }
  }, [debouncedQuery, selectedGenre, storySort, projects.length])

  // Load authors when filters change
  const loadAuthors = useCallback(async (append = false) => {
    if (append) setLoadingMore(true)
    else setLoadingAuthors(true)

    try {
      const params = new URLSearchParams()
      if (debouncedQuery) params.set('q', debouncedQuery)
      params.set('sort', authorSort)
      params.set('limit', '18')
      if (append) params.set('offset', String(authors.length))

      const res = await fetch(`${config.apiUrl}/api/discover/authors?${params}`)
      const data = await res.json()

      if (append) {
        setAuthors(prev => [...prev, ...(data.authors || [])])
      } else {
        setAuthors(data.authors || [])
      }
      setAuthorsTotal(data.total || 0)
      setAuthorsHasMore(data.hasMore || false)
    } catch {
      if (!append) setAuthors([])
    } finally {
      setLoadingAuthors(false)
      setLoadingMore(false)
    }
  }, [debouncedQuery, authorSort, authors.length])

  // Fetch projects on filter change
  useEffect(() => {
    if (activeTab === 'stories') {
      loadProjects(false)
    }
  }, [debouncedQuery, selectedGenre, storySort, activeTab])

  // Fetch authors on filter change
  useEffect(() => {
    if (activeTab === 'authors') {
      loadAuthors(false)
    }
  }, [debouncedQuery, authorSort, activeTab])

  // Check follow status for displayed authors
  useEffect(() => {
    if (!userId || !apiToken || authors.length === 0) return

    const checkFollows = async () => {
      const followed = new Set<string>()
      for (const author of authors) {
        if (author.userId === userId) continue
        try {
          const res = await fetch(
            `${config.apiUrl}/api/users/${userId}/is-following/${author.userId}`
          )
          if (res.ok) {
            const data = await res.json()
            if (data.isFollowing) followed.add(author.userId)
          }
        } catch {}
      }
      setFollowedAuthors(followed)
    }
    checkFollows()
  }, [authors, userId, apiToken])

  const handleFollow = async (authorId: string) => {
    if (!userId || !apiToken) return

    const isCurrentlyFollowing = followedAuthors.has(authorId)

    try {
      if (isCurrentlyFollowing) {
        await apiFetch(`/api/users/${userId}/follow/${authorId}`, apiToken, { method: 'DELETE' })
        setFollowedAuthors(prev => {
          const next = new Set(prev)
          next.delete(authorId)
          return next
        })
        setAuthors(prev => prev.map(a =>
          a.userId === authorId ? { ...a, followerCount: Math.max(0, a.followerCount - 1) } : a
        ))
      } else {
        await apiFetch(`/api/users/${userId}/follow`, apiToken, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ followingId: authorId })
        })
        setFollowedAuthors(prev => new Set(prev).add(authorId))
        setAuthors(prev => prev.map(a =>
          a.userId === authorId ? { ...a, followerCount: a.followerCount + 1 } : a
        ))
      }
    } catch (err) {
      console.error('Failed to follow/unfollow:', err)
    }
  }

  function formatNumber(n: number): string {
    if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
    if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`
    return String(n)
  }

  function getProjectUrl(project: DiscoverProject): string {
    if (project.shortUrl) return `/read/${project.shortUrl}`
    return `/read/${project.id}`
  }

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-950">
      {/* Header */}
      <div className="border-b border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900">
        <div className="max-w-6xl mx-auto px-4 h-14 flex items-center justify-between">
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
            <span className="text-sm font-medium text-gray-900 dark:text-gray-100">Explore</span>
          </div>
          {session ? (
            <Link
              href="/library"
              className="text-sm text-gray-500 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-100 transition-colors"
            >
              My Library
            </Link>
          ) : (
            <Link
              href="/login"
              className="text-sm text-blue-600 dark:text-blue-400 hover:underline"
            >
              Sign In
            </Link>
          )}
        </div>
      </div>

      <div className="max-w-6xl mx-auto px-4 py-8">
        {/* Hero search area */}
        <div className="text-center mb-8">
          <h1 className="text-3xl font-bold text-gray-900 dark:text-gray-100 mb-2">
            Discover Stories & Authors
          </h1>
          <p className="text-gray-500 dark:text-gray-400 mb-6">
            Find your next favorite read or follow new authors
          </p>

          {/* Search bar */}
          <div className="max-w-2xl mx-auto relative">
            <svg
              className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
            <input
              type="text"
              placeholder={activeTab === 'stories' ? 'Search stories by title or description...' : 'Search authors by name or bio...'}
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-12 pr-4 py-3 text-base border border-gray-300 dark:border-gray-700 rounded-xl bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100 placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent shadow-sm"
            />
            {searchQuery && (
              <button
                onClick={() => setSearchQuery('')}
                className="absolute right-4 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            )}
          </div>
        </div>

        {/* Genre tag pills */}
        {activeTab === 'stories' && tags.length > 0 && (
          <div className="flex flex-wrap justify-center gap-2 mb-6">
            <button
              onClick={() => setSelectedGenre(null)}
              className={`px-3 py-1.5 text-sm rounded-full transition-colors ${
                !selectedGenre
                  ? 'bg-blue-600 text-white'
                  : 'bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-700'
              }`}
            >
              All Genres
            </button>
            {tags.map(tag => (
              <button
                key={tag.name}
                onClick={() => setSelectedGenre(selectedGenre === tag.name ? null : tag.name)}
                className={`px-3 py-1.5 text-sm rounded-full transition-colors ${
                  selectedGenre === tag.name
                    ? 'bg-blue-600 text-white'
                    : 'bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-700'
                }`}
              >
                {tag.name}
                <span className="ml-1 opacity-60">({tag.projectCount})</span>
              </button>
            ))}
          </div>
        )}

        {/* Tab bar + sort controls */}
        <div className="flex items-center justify-between mb-6 border-b border-gray-200 dark:border-gray-800">
          <div className="flex gap-1">
            <button
              onClick={() => setActiveTab('stories')}
              className={`px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${
                activeTab === 'stories'
                  ? 'border-blue-500 text-blue-600 dark:text-blue-400'
                  : 'border-transparent text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300'
              }`}
            >
              Stories
              {projectsTotal > 0 && activeTab === 'stories' && (
                <span className="ml-1.5 text-xs bg-blue-100 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400 px-1.5 py-0.5 rounded-full">
                  {projectsTotal}
                </span>
              )}
            </button>
            <button
              onClick={() => setActiveTab('authors')}
              className={`px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${
                activeTab === 'authors'
                  ? 'border-blue-500 text-blue-600 dark:text-blue-400'
                  : 'border-transparent text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300'
              }`}
            >
              Authors
              {authorsTotal > 0 && activeTab === 'authors' && (
                <span className="ml-1.5 text-xs bg-blue-100 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400 px-1.5 py-0.5 rounded-full">
                  {authorsTotal}
                </span>
              )}
            </button>
          </div>

          {/* Sort dropdown */}
          <div className="flex items-center gap-2 pb-2">
            <span className="text-xs text-gray-500 dark:text-gray-400">Sort:</span>
            {activeTab === 'stories' ? (
              <select
                value={storySort}
                onChange={(e) => setStorySort(e.target.value as StorySort)}
                className="text-sm border border-gray-300 dark:border-gray-700 rounded-md px-2 py-1 bg-white dark:bg-gray-900 text-gray-700 dark:text-gray-300 focus:outline-none focus:ring-1 focus:ring-blue-500"
              >
                <option value="recent">Recent</option>
                <option value="popular">Popular</option>
                <option value="trending">Trending</option>
              </select>
            ) : (
              <select
                value={authorSort}
                onChange={(e) => setAuthorSort(e.target.value as AuthorSort)}
                className="text-sm border border-gray-300 dark:border-gray-700 rounded-md px-2 py-1 bg-white dark:bg-gray-900 text-gray-700 dark:text-gray-300 focus:outline-none focus:ring-1 focus:ring-blue-500"
              >
                <option value="popular">Popular</option>
                <option value="recent">Recent</option>
                <option value="alphabetical">A-Z</option>
              </select>
            )}
          </div>
        </div>

        {/* Stories tab */}
        {activeTab === 'stories' && (
          <div>
            {loadingProjects ? (
              <div className="text-center py-16">
                <p className="text-gray-500 dark:text-gray-400">Loading stories...</p>
              </div>
            ) : projects.length === 0 ? (
              <div className="text-center py-16">
                <svg className="w-12 h-12 text-gray-300 dark:text-gray-700 mx-auto mb-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" />
                </svg>
                <p className="text-gray-500 dark:text-gray-400 mb-1">No published stories found.</p>
                <p className="text-sm text-gray-400 dark:text-gray-500">
                  {searchQuery || selectedGenre ? 'Try adjusting your search or filters.' : 'Check back later for new content.'}
                </p>
              </div>
            ) : (
              <>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
                  {projects.map(project => (
                    <Link
                      key={project.id}
                      href={getProjectUrl(project)}
                      className="group bg-white dark:bg-gray-900 rounded-lg border border-gray-200 dark:border-gray-800 hover:border-blue-300 dark:hover:border-blue-700 hover:shadow-md transition-all overflow-hidden"
                    >
                      {/* Cover image or placeholder */}
                      <div className="aspect-[16/9] bg-gradient-to-br from-blue-100 to-purple-100 dark:from-blue-900/30 dark:to-purple-900/30 relative overflow-hidden">
                        {project.coverImage ? (
                          <img
                            src={project.coverImage}
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
                      </div>

                      <div className="p-4">
                        {/* Title */}
                        <h3 className="font-semibold text-gray-900 dark:text-gray-100 truncate group-hover:text-blue-600 dark:group-hover:text-blue-400 transition-colors">
                          {project.name}
                        </h3>

                        {/* Author */}
                        <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">
                          by {project.authorDisplayName}
                        </p>

                        {/* Description */}
                        {project.description && (
                          <p className="text-sm text-gray-600 dark:text-gray-400 mt-2 line-clamp-2">
                            {project.description}
                          </p>
                        )}

                        {/* Genre tags */}
                        {project.tags.length > 0 && (
                          <div className="flex flex-wrap gap-1.5 mt-3">
                            {project.tags.slice(0, 3).map(tag => (
                              <span
                                key={tag}
                                className="text-xs px-2 py-0.5 rounded-full bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400"
                              >
                                {tag}
                              </span>
                            ))}
                            {project.tags.length > 3 && (
                              <span className="text-xs text-gray-400">+{project.tags.length - 3}</span>
                            )}
                          </div>
                        )}

                        {/* Stats row */}
                        <div className="flex items-center gap-3 mt-3 text-xs text-gray-400 dark:text-gray-500">
                          <span className="flex items-center gap-1">
                            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                            </svg>
                            {formatNumber(project.totalViews)}
                          </span>
                          <span className="flex items-center gap-1">
                            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                            </svg>
                            {project.chapterCount} ch.
                          </span>
                        </div>
                      </div>
                    </Link>
                  ))}
                </div>

                {/* Load more */}
                {projectsHasMore && (
                  <div className="text-center mt-8">
                    <button
                      onClick={() => loadProjects(true)}
                      disabled={loadingMore}
                      className="px-6 py-2.5 text-sm bg-white dark:bg-gray-900 border border-gray-300 dark:border-gray-700 text-gray-700 dark:text-gray-300 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-800 disabled:opacity-50 transition-colors"
                    >
                      {loadingMore ? 'Loading...' : 'Load More Stories'}
                    </button>
                  </div>
                )}
              </>
            )}
          </div>
        )}

        {/* Authors tab */}
        {activeTab === 'authors' && (
          <div>
            {loadingAuthors ? (
              <div className="text-center py-16">
                <p className="text-gray-500 dark:text-gray-400">Loading authors...</p>
              </div>
            ) : authors.length === 0 ? (
              <div className="text-center py-16">
                <svg className="w-12 h-12 text-gray-300 dark:text-gray-700 mx-auto mb-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" />
                </svg>
                <p className="text-gray-500 dark:text-gray-400 mb-1">No authors found.</p>
                <p className="text-sm text-gray-400 dark:text-gray-500">
                  {searchQuery ? 'Try a different search term.' : 'Check back later for new authors.'}
                </p>
              </div>
            ) : (
              <>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
                  {authors.map(author => (
                    <div
                      key={author.userId}
                      className="bg-white dark:bg-gray-900 rounded-lg border border-gray-200 dark:border-gray-800 hover:border-blue-300 dark:hover:border-blue-700 hover:shadow-md transition-all p-5"
                    >
                      <div className="flex items-start gap-4">
                        {/* Avatar */}
                        <Link href={`/u/${author.username || author.userId}`} className="flex-shrink-0">
                          {author.avatarUrl ? (
                            <img
                              src={author.avatarUrl}
                              alt={author.displayName}
                              className="w-14 h-14 rounded-full object-cover"
                            />
                          ) : (
                            <div className="w-14 h-14 rounded-full bg-gradient-to-br from-purple-400 to-blue-500 flex items-center justify-center text-white font-bold text-xl">
                              {author.displayName.charAt(0).toUpperCase()}
                            </div>
                          )}
                        </Link>

                        <div className="flex-1 min-w-0">
                          <Link
                            href={`/u/${author.username || author.userId}`}
                            className="font-semibold text-gray-900 dark:text-gray-100 hover:text-blue-600 dark:hover:text-blue-400 transition-colors truncate block"
                          >
                            {author.displayName}
                          </Link>
                          {author.username && (
                            <p className="text-sm text-gray-500 dark:text-gray-400">@{author.username}</p>
                          )}
                        </div>
                      </div>

                      {/* Bio */}
                      {author.bio && (
                        <p className="text-sm text-gray-600 dark:text-gray-400 mt-3 line-clamp-2">
                          {author.bio}
                        </p>
                      )}

                      {/* Stats + follow */}
                      <div className="flex items-center justify-between mt-4">
                        <div className="flex items-center gap-4 text-xs text-gray-500 dark:text-gray-400">
                          <span>{formatNumber(author.followerCount)} followers</span>
                          <span>{author.publishedProjectCount} works</span>
                        </div>

                        {/* Follow button */}
                        {userId && userId !== author.userId ? (
                          <button
                            onClick={() => handleFollow(author.userId)}
                            className={`text-xs px-3 py-1.5 rounded-full transition-colors ${
                              followedAuthors.has(author.userId)
                                ? 'bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400 hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-900/20 dark:hover:text-red-400'
                                : 'bg-blue-600 text-white hover:bg-blue-700'
                            }`}
                          >
                            {followedAuthors.has(author.userId) ? 'Following' : 'Follow'}
                          </button>
                        ) : !session ? (
                          <Link
                            href="/login"
                            className="text-xs text-blue-600 dark:text-blue-400 hover:underline"
                          >
                            Sign in to Follow
                          </Link>
                        ) : null}
                      </div>
                    </div>
                  ))}
                </div>

                {/* Load more */}
                {authorsHasMore && (
                  <div className="text-center mt-8">
                    <button
                      onClick={() => loadAuthors(true)}
                      disabled={loadingMore}
                      className="px-6 py-2.5 text-sm bg-white dark:bg-gray-900 border border-gray-300 dark:border-gray-700 text-gray-700 dark:text-gray-300 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-800 disabled:opacity-50 transition-colors"
                    >
                      {loadingMore ? 'Loading...' : 'Load More Authors'}
                    </button>
                  </div>
                )}
              </>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
