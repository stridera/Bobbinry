'use client'

/**
 * Dashboard Content Component
 *
 * Campfire-style dashboard with project cards and recent activity
 */

import { useState, useEffect } from 'react'
import { signOut } from 'next-auth/react'
import Link from 'next/link'
import { ProjectCard } from './ProjectCard'
import { RecentActivityPanel } from './RecentActivityPanel'
import { SortableCollection } from './SortableCollection'
import { DashboardLoadingState } from '@/components/LoadingState'
import { EmptyState } from '@/components/EmptyState'

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
        fetch(`${process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000'}/api/users/me/projects/grouped?userId=${user.id}`),
        fetch(`${process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000'}/api/dashboard/stats?userId=${user.id}`)
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
        `${process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000'}/api/collections/${collectionId}/projects/reorder`,
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
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <header className="bg-white border-b border-gray-200">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-2xl font-bold text-gray-900">Bobbinry</h1>
              <p className="text-sm text-gray-600 mt-1">Welcome back, {user.name || user.email}</p>
            </div>
            <div className="flex items-center gap-4">
              <Link
                href="/projects/new"
                className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 font-medium"
              >
                + New Project
              </Link>
              <button
                onClick={() => signOut({ callbackUrl: '/login' })}
                className="px-4 py-2 text-gray-600 hover:text-gray-900"
              >
                Sign Out
              </button>
            </div>
          </div>

          {/* Stats */}
          {stats && (
            <div className="mt-6 grid grid-cols-3 gap-4">
              <div className="bg-blue-50 rounded-lg p-4">
                <div className="text-2xl font-bold text-blue-600">{stats.projects.active}</div>
                <div className="text-sm text-gray-600">Active Projects</div>
              </div>
              <div className="bg-purple-50 rounded-lg p-4">
                <div className="text-2xl font-bold text-purple-600">{stats.collections.total}</div>
                <div className="text-sm text-gray-600">Collections</div>
              </div>
              <div className="bg-green-50 rounded-lg p-4">
                <div className="text-2xl font-bold text-green-600">{stats.entities.total}</div>
                <div className="text-sm text-gray-600">Total Items</div>
              </div>
            </div>
          )}

          {/* Search and filters */}
          <div className="mt-6 flex items-center gap-4">
            <div className="flex-1">
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search projects..."
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              />
            </div>
            <label className="flex items-center gap-2 text-sm text-gray-600">
              <input
                type="checkbox"
                checked={showArchived}
                onChange={(e) => setShowArchived(e.target.checked)}
                className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
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
          <div className="lg:col-span-2 space-y-8">
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
              <div className="bg-white rounded-lg shadow p-6">
                <h2 className="text-xl font-bold text-gray-900 mb-4">Uncategorized</h2>
                <div className="grid gap-4">
                  {filteredProjects(data.uncategorized).map((project) => (
                    <ProjectCard key={project.id} project={project} />
                  ))}
                </div>
              </div>
            )}

            {!loading && data && filteredProjects([...data.uncategorized, ...data.collections.flatMap(c => c.projects)]).length === 0 && (
              <EmptyState
                icon={
                  <svg className="w-16 h-16 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d={searchQuery ? "M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" : "M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"} />
                  </svg>
                }
                title={searchQuery ? 'No results found' : 'No projects yet'}
                description={searchQuery ? `We couldn't find any projects matching "${searchQuery}"` : 'Get started by creating your first project'}
                {...(!searchQuery && { action: { label: 'Create Project', href: '/projects/new' } })}
              />
            )}
          </div>

          {/* Recent activity panel */}
          <div className="lg:col-span-1">
            <RecentActivityPanel userId={user.id} />
          </div>
        </div>
      </div>
    </div>
  )
}
