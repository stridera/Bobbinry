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
import { UserMenu } from '@/components/UserMenu'
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

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900">
      {/* Header */}
      <header className="bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="font-display text-3xl font-bold text-gray-900 dark:text-gray-100 tracking-tight">
                Bobbinry
              </h1>
              <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
                {getGreeting()}, {user.name || user.email}
              </p>
            </div>
            <div className="flex items-center gap-4">
              <Link
                href="/projects/new"
                className="inline-flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 dark:bg-blue-700 dark:hover:bg-blue-600 text-white rounded-lg font-medium transition-colors"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                </svg>
                New Project
              </Link>
              <UserMenu user={user} />
            </div>
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
