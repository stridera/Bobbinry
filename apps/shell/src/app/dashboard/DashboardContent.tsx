'use client'

/**
 * Dashboard Content Component
 *
 * Campfire-style dashboard with project cards and recent activity
 */

import { useState, useEffect } from 'react'
import Link from 'next/link'
import { ProjectCard } from './ProjectCard'
import { RecentActivityPanel } from './RecentActivityPanel'
import { SortableCollection } from './SortableCollection'
import { CreateCollectionModal } from './CreateCollectionModal'
import { DashboardLoadingState } from '@/components/LoadingState'
import { EmptyState } from '@/components/EmptyState'
import { SiteNav } from '@/components/SiteNav'
import { apiFetch } from '@/lib/api'

interface User {
  id: string
  email: string
  name?: string | null
  emailVerified?: boolean
}

interface Project {
  id: string
  name: string
  description: string | null
  coverImage: string | null
  shortUrl: string | null
  isArchived: boolean
  createdAt: string
  updatedAt: string
}

interface Collection {
  id: string
  name: string
  description: string | null
  coverImage: string | null
  colorTheme: string | null
  projects: Project[]
}

interface DashboardData {
  collections: Collection[]
  uncategorized: Project[]
}

interface DashboardStats {
  projects: { total: string; active: string; archived: string }
  collections: { total: string }
  entities: { total: string }
  trashed?: { total: string }
}

function EmailVerificationBanner({ apiToken }: { apiToken: string }) {
  const [resending, setResending] = useState(false)
  const [sent, setSent] = useState(false)

  const handleResend = async () => {
    setResending(true)
    try {
      await apiFetch('/api/auth/resend-verification', apiToken, { method: 'POST' })
      setSent(true)
    } catch {
      // silent fail
    } finally {
      setResending(false)
    }
  }

  return (
    <div className="bg-amber-50 dark:bg-amber-950/30 border-b border-amber-200 dark:border-amber-900">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-3 flex items-center justify-between">
        <p className="text-sm text-amber-800 dark:text-amber-200">
          Please verify your email to unlock all features.
        </p>
        {sent ? (
          <span className="text-sm text-green-700 dark:text-green-400">Verification email sent!</span>
        ) : (
          <button
            onClick={handleResend}
            disabled={resending}
            className="text-sm font-medium text-amber-700 dark:text-amber-300 hover:text-amber-900 dark:hover:text-amber-100 disabled:opacity-50"
          >
            {resending ? 'Sending...' : 'Resend verification email'}
          </button>
        )}
      </div>
    </div>
  )
}

function getGreeting(): string {
  const hour = new Date().getHours()
  if (hour < 12) return 'Good morning'
  if (hour < 17) return 'Good afternoon'
  return 'Good evening'
}

export function DashboardContent({ user, apiToken }: { user: User; apiToken: string }) {
  const [data, setData] = useState<DashboardData | null>(null)
  const [stats, setStats] = useState<DashboardStats | null>(null)
  const [loading, setLoading] = useState(true)
  const [searchQuery, setSearchQuery] = useState('')
  const [showArchived, setShowArchived] = useState(false)
  const [showCreateCollection, setShowCreateCollection] = useState(false)
  const [sortBy, setSortBy] = useState<'recent' | 'alphabetical' | 'created'>('recent')

  useEffect(() => {
    loadDashboard()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user.id, apiToken])

  const loadDashboard = async () => {
    try {
      const [projectsRes, statsRes] = await Promise.all([
        apiFetch('/api/users/me/projects/grouped', apiToken),
        apiFetch('/api/dashboard/stats', apiToken)
      ])

      if (projectsRes.ok && statsRes.ok) {
        const [projectsData, statsData] = await Promise.all([
          projectsRes.json(),
          statsRes.json()
        ])
        setData(projectsData)
        setStats(statsData.stats)
      }
    } catch (error) {
      console.error('Failed to load dashboard:', error)
    } finally {
      setLoading(false)
    }
  }

  const filteredProjects = (projects: Project[]) => {
    return projects.filter(p => {
      const matchesSearch = !searchQuery ||
        p.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        p.description?.toLowerCase().includes(searchQuery.toLowerCase())
      const matchesArchived = showArchived || !p.isArchived
      return matchesSearch && matchesArchived
    })
  }

  const sortedProjects = (projects: Project[]) => {
    return [...projects].sort((a, b) => {
      switch (sortBy) {
        case 'alphabetical':
          return a.name.localeCompare(b.name)
        case 'created':
          return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
        case 'recent':
        default:
          return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
      }
    })
  }

  const handleReorder = async (collectionId: string, projectIds: string[]) => {
    try {
      const response = await apiFetch(
        `/api/collections/${collectionId}/projects/reorder`,
        apiToken,
        {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ projectIds })
        }
      )

      if (!response.ok) {
        throw new Error('Failed to reorder projects')
      }
    } catch (error) {
      console.error('Failed to reorder:', error)
      throw error
    }
  }

  const handleAddToCollection = async (collectionId: string, projectId: string) => {
    try {
      const res = await apiFetch(
        `/api/collections/${collectionId}/projects/${projectId}`,
        apiToken,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ orderIndex: 0 }),
        }
      )
      if (res.ok || res.status === 409) {
        loadDashboard()
      }
    } catch (error) {
      console.error('Failed to add project to collection:', error)
    }
  }

  const handleRemoveFromCollection = async (collectionId: string, projectId: string) => {
    try {
      const res = await apiFetch(
        `/api/collections/${collectionId}/projects/${projectId}`,
        apiToken,
        { method: 'DELETE' }
      )
      if (res.ok || res.status === 204) {
        loadDashboard()
      }
    } catch (error) {
      console.error('Failed to remove project from collection:', error)
    }
  }

  const handleDeleteCollection = async (collectionId: string) => {
    try {
      const res = await apiFetch(
        `/api/collections/${collectionId}`,
        apiToken,
        { method: 'DELETE' }
      )
      if (res.ok || res.status === 204) {
        loadDashboard()
      }
    } catch (error) {
      console.error('Failed to delete collection:', error)
    }
  }

  const collectionsList = data?.collections.map(c => ({ id: c.id, name: c.name })) ?? []

  if (loading) {
    return <DashboardLoadingState />
  }

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-950">
      <SiteNav />

      {!user.emailVerified && <EmailVerificationBanner apiToken={apiToken} />}

      {/* Sub-header with greeting and actions */}
      <header className="bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div>
              <p className="text-sm text-gray-500 dark:text-gray-400">
                {getGreeting()}, {user.name || user.email}
              </p>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={() => setShowCreateCollection(true)}
                className="inline-flex items-center gap-2 px-4 py-2 border border-gray-200 dark:border-gray-600 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700 rounded-lg font-medium transition-colors"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
                </svg>
                New Collection
              </button>
              <Link
                href="/projects/new"
                className="inline-flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 dark:bg-blue-700 dark:hover:bg-blue-600 text-white rounded-lg font-medium transition-colors"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                </svg>
                New Project
              </Link>
            </div>
          </div>

          {/* Stats */}
          {stats && (
            <div className="mt-6 grid grid-cols-2 sm:grid-cols-3 gap-3 sm:gap-4">
              <div className="bg-blue-50/80 dark:bg-blue-950/20 rounded-lg p-4 border border-blue-100 dark:border-blue-900/30">
                <div className="font-display text-3xl font-bold text-blue-700 dark:text-blue-400">{stats.projects.active}</div>
                <div className="text-sm text-gray-600 dark:text-gray-400 mt-0.5">Active Projects</div>
              </div>
              <div className="bg-purple-50/80 dark:bg-purple-950/20 rounded-lg p-4 border border-purple-100 dark:border-purple-900/30">
                <div className="font-display text-3xl font-bold text-purple-700 dark:text-purple-400">{stats.collections.total}</div>
                <div className="text-sm text-gray-600 dark:text-gray-400 mt-0.5">Collections</div>
              </div>
              <div className="bg-green-50/80 dark:bg-green-950/20 rounded-lg p-4 border border-green-100 dark:border-green-900/30">
                <div className="font-display text-3xl font-bold text-green-700 dark:text-green-400">{stats.entities.total}</div>
                <div className="text-sm text-gray-600 dark:text-gray-400 mt-0.5">Total Items</div>
              </div>
            </div>
          )}

          {/* Search and filters */}
          <div className="mt-6 flex flex-col sm:flex-row sm:items-center gap-3 sm:gap-4">
            <div className="flex-1 relative">
              <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 dark:text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
              </svg>
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search projects..."
                className="w-full pl-10 pr-4 py-2 border border-gray-200 dark:border-gray-600 bg-gray-50/50 dark:bg-gray-900/50 text-gray-900 dark:text-gray-100 rounded-lg focus:ring-2 focus:ring-blue-500/40 focus:border-blue-500 dark:focus:border-blue-400 transition-colors placeholder-gray-400 dark:placeholder-gray-500"
              />
            </div>
            <div className="flex items-center gap-3 sm:gap-4 flex-wrap">
              <select
                value={sortBy}
                onChange={(e) => setSortBy(e.target.value as typeof sortBy)}
                aria-label="Sort projects"
                className="text-sm border border-gray-200 dark:border-gray-600 bg-gray-50/50 dark:bg-gray-900/50 text-gray-700 dark:text-gray-300 rounded-lg px-3 py-2 focus:ring-2 focus:ring-blue-500/40 focus:border-blue-500 cursor-pointer"
              >
                <option value="recent">Recently Modified</option>
                <option value="alphabetical">Alphabetical</option>
                <option value="created">Newest First</option>
              </select>
              <label className="flex items-center gap-2 text-sm text-gray-600 dark:text-gray-400 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={showArchived}
                  onChange={(e) => setShowArchived(e.target.checked)}
                  className="rounded border-gray-300 dark:border-gray-600 text-blue-600 focus:ring-blue-500"
                />
                Show archived
              </label>
              {stats?.trashed && parseInt(stats.trashed.total) > 0 && (
                <Link
                  href="/dashboard/trash"
                  className="flex items-center gap-1.5 text-sm text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300 transition-colors"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                  </svg>
                  Trash ({stats.trashed.total})
                </Link>
              )}
            </div>
          </div>
        </div>
      </header>

      {/* Main content */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          {/* Projects section */}
          <div className="lg:col-span-2 space-y-8 animate-fade-in">
            {/* Collections */}
            {data?.collections.map((collection) => {
              const filtered = filteredProjects(collection.projects)
              if (filtered.length === 0 && searchQuery) return null

              return (
                <SortableCollection
                  key={collection.id}
                  collection={{ ...collection, projects: filtered }}
                  searchQuery={searchQuery}
                  onReorder={handleReorder}
                  onDeleteCollection={handleDeleteCollection}
                  onRemoveFromCollection={handleRemoveFromCollection}
                />
              )
            })}

            {/* Uncategorized projects */}
            {data?.uncategorized && sortedProjects(filteredProjects(data.uncategorized)).length > 0 && (
              <div className="bg-white dark:bg-gray-800 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700 p-6">
                <h2 className="font-display text-xl font-bold text-gray-900 dark:text-gray-100 mb-4">All Projects</h2>
                <div className="grid gap-3">
                  {sortedProjects(filteredProjects(data.uncategorized)).map((project) => (
                    <ProjectCard
                      key={project.id}
                      project={project}
                      collections={collectionsList}
                      searchQuery={searchQuery}
                      onAddToCollection={handleAddToCollection}
                    />
                  ))}
                </div>
              </div>
            )}

            {!loading && data && filteredProjects([...data.uncategorized, ...data.collections.flatMap(c => c.projects)]).length === 0 && (
              <EmptyState
                icon={
                  <svg className="w-16 h-16 text-gray-300 dark:text-gray-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d={searchQuery ? "M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" : "M12 6.042A8.967 8.967 0 006 3.75c-1.052 0-2.062.18-3 .512v14.25A8.987 8.987 0 016 18c2.305 0 4.408.867 6 2.292m0-14.25a8.966 8.966 0 016-2.292c1.052 0 2.062.18 3 .512v14.25A8.987 8.987 0 0018 18a8.967 8.967 0 00-6 2.292m0-14.25v14.25"} />
                  </svg>
                }
                title={searchQuery ? 'No results found' : 'Your story begins here'}
                description={searchQuery ? `No projects matching "${searchQuery}"` : 'Create a project to start writing, or organize with a collection'}
                {...(!searchQuery && {
                  action: { label: 'Create Project', href: '/projects/new' },
                  secondaryAction: { label: 'New Collection', onClick: () => setShowCreateCollection(true) },
                })}
              />
            )}
          </div>

          {/* Recent activity panel */}
          <div className="lg:col-span-1 animate-fade-in" style={{ animationDelay: '0.1s' }}>
            <RecentActivityPanel userId={user.id} apiToken={apiToken} />
          </div>
        </div>
      </div>

      {/* Create Collection Modal */}
      {showCreateCollection && (
        <CreateCollectionModal
          apiToken={apiToken}
          onCreated={() => {
            setShowCreateCollection(false)
            loadDashboard()
          }}
          onClose={() => setShowCreateCollection(false)}
        />
      )}
    </div>
  )
}
