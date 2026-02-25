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
import { DashboardLoadingState } from '@/components/LoadingState'
import { EmptyState } from '@/components/EmptyState'
import { SiteNav } from '@/components/SiteNav'
import { config } from '@/lib/config'

interface User {
  id: string
  email: string
  name?: string | null
}

interface Project {
  id: string
  name: string
  description: string | null
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
}

function getGreeting(): string {
  const hour = new Date().getHours()
  if (hour < 12) return 'Good morning'
  if (hour < 17) return 'Good afternoon'
  return 'Good evening'
}

export function DashboardContent({ user }: { user: User }) {
  const [data, setData] = useState<DashboardData | null>(null)
  const [stats, setStats] = useState<DashboardStats | null>(null)
  const [loading, setLoading] = useState(true)
  const [searchQuery, setSearchQuery] = useState('')
  const [showArchived, setShowArchived] = useState(false)

  useEffect(() => {
    loadDashboard()
  }, [user.id])

  const loadDashboard = async () => {
    try {
      const [projectsRes, statsRes] = await Promise.all([
        fetch(`${config.apiUrl}/api/users/me/projects/grouped?userId=${user.id}`),
        fetch(`${config.apiUrl}/api/dashboard/stats?userId=${user.id}`)
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

  const handleReorder = async (collectionId: string, projectIds: string[]) => {
    try {
      const response = await fetch(
        `${config.apiUrl}/api/collections/${collectionId}/projects/reorder`,
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

  if (loading) {
    return <DashboardLoadingState />
  }

  const allProjects = data ? [...data.uncategorized, ...data.collections.flatMap(c => c.projects)] : []
  const publishedCount = allProjects.filter(p => p.shortUrl).length

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900">
      <SiteNav />

      {/* Sub-header with greeting and actions */}
      <header className="bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-gray-500 dark:text-gray-400">
                {getGreeting()}, {user.name || user.email}
              </p>
            </div>
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

          {/* Stats */}
          {stats && (
            <div className="mt-6 grid grid-cols-3 gap-4">
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

          {/* Three Pillars */}
          <div className="mt-6 grid grid-cols-1 md:grid-cols-3 gap-4">
            {/* Write */}
            <div className="bg-white dark:bg-gray-900/50 rounded-lg border border-gray-200 dark:border-gray-700 p-4">
              <div className="flex items-center gap-2 mb-2">
                <svg className="w-5 h-5 text-blue-600 dark:text-blue-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                </svg>
                <h3 className="font-display font-semibold text-gray-900 dark:text-gray-100">Write</h3>
              </div>
              <div className="flex flex-col gap-1.5">
                <Link href="/projects/new" className="text-sm text-blue-600 dark:text-blue-400 hover:underline">
                  New Project
                </Link>
                {(() => {
                  const latest = [...allProjects].sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())[0]
                  return latest ? (
                    <Link
                      href={`/projects/${latest.id}`}
                      className="text-sm text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300 truncate"
                    >
                      Resume: {latest.name}
                    </Link>
                  ) : null
                })()}
              </div>
            </div>

            {/* Publish */}
            <div className="bg-white dark:bg-gray-900/50 rounded-lg border border-gray-200 dark:border-gray-700 p-4">
              <div className="flex items-center gap-2 mb-2">
                <svg className="w-5 h-5 text-purple-600 dark:text-purple-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" />
                </svg>
                <h3 className="font-display font-semibold text-gray-900 dark:text-gray-100">Publish</h3>
              </div>
              <div className="flex flex-col gap-1.5">
                <span className="text-sm text-gray-600 dark:text-gray-400">
                  {publishedCount} published project{publishedCount !== 1 ? 's' : ''}
                </span>
                <Link href="/publish" className="text-sm text-purple-600 dark:text-purple-400 hover:underline">
                  Publisher Dashboard
                </Link>
              </div>
            </div>

            {/* Read */}
            <div className="bg-white dark:bg-gray-900/50 rounded-lg border border-gray-200 dark:border-gray-700 p-4">
              <div className="flex items-center gap-2 mb-2">
                <svg className="w-5 h-5 text-green-600 dark:text-green-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                </svg>
                <h3 className="font-display font-semibold text-gray-900 dark:text-gray-100">Read</h3>
              </div>
              <div className="flex flex-col gap-1.5">
                <Link href="/library" className="text-sm text-green-600 dark:text-green-400 hover:underline">
                  My Library
                </Link>
                <Link href="/explore" className="text-sm text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300">
                  Explore Stories
                </Link>
              </div>
            </div>
          </div>

          {/* Marketplace banner */}
          <Link
            href="/marketplace"
            className="mt-6 flex items-center gap-4 p-4 bg-gradient-to-r from-blue-50 to-purple-50 dark:from-blue-950/20 dark:to-purple-950/20 rounded-lg border border-blue-100 dark:border-blue-900/30 hover:border-blue-300 dark:hover:border-blue-700 transition-colors group"
          >
            <div className="w-10 h-10 rounded-lg bg-blue-100 dark:bg-blue-900/40 flex items-center justify-center flex-shrink-0">
              <svg className="w-5 h-5 text-blue-600 dark:text-blue-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2V6zM14 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2V6zM4 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2v-2zM14 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2v-2z" />
              </svg>
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-gray-900 dark:text-gray-100">Enhance your workspace with Bobbins</p>
              <p className="text-xs text-gray-500 dark:text-gray-400">Browse the marketplace for writing tools, organizers, and more</p>
            </div>
            <svg className="w-5 h-5 text-gray-400 dark:text-gray-500 group-hover:text-blue-600 dark:group-hover:text-blue-400 transition-colors flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
            </svg>
          </Link>

          {/* Search and filters */}
          <div className="mt-6 flex items-center gap-4">
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
            <label className="flex items-center gap-2 text-sm text-gray-600 dark:text-gray-400 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={showArchived}
                onChange={(e) => setShowArchived(e.target.checked)}
                className="rounded border-gray-300 dark:border-gray-600 text-blue-600 focus:ring-blue-500"
              />
              Show archived
            </label>
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
                  onReorder={handleReorder}
                />
              )
            })}

            {/* Uncategorized projects */}
            {data?.uncategorized && filteredProjects(data.uncategorized).length > 0 && (
              <div className="bg-white dark:bg-gray-800 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700 p-6">
                <h2 className="font-display text-xl font-bold text-gray-900 dark:text-gray-100 mb-4">Projects</h2>
                <div className="grid gap-3">
                  {filteredProjects(data.uncategorized).map((project) => (
                    <ProjectCard key={project.id} project={project} />
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
                description={searchQuery ? `No projects matching "${searchQuery}"` : 'Create your first project and start writing'}
                {...(!searchQuery && { action: { label: 'Create Project', href: '/projects/new' } })}
              />
            )}
          </div>

          {/* Recent activity panel */}
          <div className="lg:col-span-1 animate-fade-in" style={{ animationDelay: '0.1s' }}>
            <RecentActivityPanel userId={user.id} />
          </div>
        </div>
      </div>
    </div>
  )
}
