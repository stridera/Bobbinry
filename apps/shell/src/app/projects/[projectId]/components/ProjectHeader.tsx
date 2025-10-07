'use client'

import Link from 'next/link'
import { useParams } from 'next/navigation'
import { useState, useEffect } from 'react'
import { useSession } from 'next-auth/react'
import { UserMenu } from '@/components/UserMenu'

interface Project {
  id: string
  name: string
  description: string | null
}

export function ProjectHeader() {
  const params = useParams()
  const { data: session } = useSession()
  const projectId = params.projectId as string
  const [project, setProject] = useState<Project | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const loadProject = async () => {
      try {
        const response = await fetch(`${process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000'}/api/projects/${projectId}`)
        if (response.ok) {
          const data = await response.json()
          setProject(data.project)
        }
      } catch (error) {
        console.error('Failed to load project:', error)
      } finally {
        setLoading(false)
      }
    }

    if (projectId) {
      loadProject()
    }
  }, [projectId])

  if (loading) {
    return (
      <header className="bg-white border-b border-gray-200">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4">
          <div className="animate-pulse">
            <div className="h-4 bg-gray-200 rounded w-32 mb-2" />
            <div className="h-6 bg-gray-200 rounded w-48" />
          </div>
        </div>
      </header>
    )
  }

  return (
    <header className="bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4">
        <div className="flex items-center justify-between">
          <div className="flex-1">
            <div className="flex items-center gap-2 text-sm text-gray-600 dark:text-gray-400 mb-1">
              <Link href="/dashboard" className="hover:text-gray-900 dark:hover:text-gray-100">
                Dashboard
              </Link>
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
              </svg>
              <span className="text-gray-900 dark:text-gray-100">{project?.name || 'Project'}</span>
            </div>
            <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">{project?.name || 'Untitled Project'}</h1>
            {project?.description && (
              <p className="text-sm text-gray-600 dark:text-gray-400 mt-1">{project.description}</p>
            )}
          </div>

          <div className="flex items-center gap-3">
            <Link
              href={`/projects/${projectId}/settings`}
              className="px-4 py-2 text-gray-700 dark:text-gray-300 hover:text-gray-900 dark:hover:text-gray-100 border border-gray-300 dark:border-gray-600 rounded-lg hover:border-gray-400 dark:hover:border-gray-500"
            >
              Settings
            </Link>
            {session?.user && <UserMenu user={session.user} />}
          </div>
        </div>
      </div>
    </header>
  )
}
