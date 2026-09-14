'use client'

import { useState, useEffect, useCallback } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { useSession } from 'next-auth/react'
import Link from 'next/link'
import { SiteNav } from '@/components/SiteNav'
import { apiFetch } from '@/lib/api'
import { ExportProject } from '../components/dashboard/ExportProject'
import { ProjectBackup } from '../components/dashboard/ProjectBackup'
import { ManuscriptDisplaySettings } from '../components/dashboard/ManuscriptDisplaySettings'
import { ProjectManagement } from '../components/dashboard/ProjectManagement'

interface SettingsData {
  project: {
    id: string
    name: string
    isArchived: boolean
  }
  chapters: Array<{ id: string; archivedAt: string | null }>
}

/**
 * Per-project settings and rarely-used tools: export, backup, manuscript
 * display overrides, archive, and trash. Moved off the dashboard so the
 * project home stays about the work.
 */
export default function ProjectSettingsPage() {
  const params = useParams()
  const router = useRouter()
  const { data: session } = useSession()
  const apiToken = session?.apiToken
  const projectId = params.projectId as string

  const [data, setData] = useState<SettingsData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    if (!apiToken) return
    try {
      const response = await apiFetch(`/api/projects/${projectId}/dashboard`, apiToken)
      if (response.ok) {
        setData(await response.json())
      } else {
        setError('Failed to load project')
      }
    } catch (err) {
      console.error('Failed to load project settings:', err)
      setError('Failed to load project')
    } finally {
      setLoading(false)
    }
  }, [projectId, apiToken])

  useEffect(() => {
    if (apiToken) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- initial fetch
      load()
    }
  }, [apiToken, load])

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-950">
      <SiteNav />
      <header className="bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-5">
          <div className="flex items-center gap-1.5 text-sm text-gray-500 dark:text-gray-400 mb-1">
            <Link href="/dashboard" className="hover:text-gray-900 dark:hover:text-gray-100 transition-colors">Projects</Link>
            <Chevron />
            {data ? (
              <Link href={`/projects/${projectId}`} className="truncate hover:text-gray-900 dark:hover:text-gray-100 transition-colors">{data.project.name}</Link>
            ) : (
              <span className="inline-block h-4 w-32 rounded bg-gray-100 dark:bg-gray-700 animate-pulse" />
            )}
            <Chevron />
            <span className="text-gray-700 dark:text-gray-200">Settings</span>
          </div>
          <h1 className="font-display text-2xl font-bold text-gray-900 dark:text-gray-100">Project settings</h1>
        </div>
      </header>

      <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-6">
        {loading && (
          <>
            {[1, 2, 3].map(i => (
              <div key={i} className="animate-pulse h-32 bg-gray-200 dark:bg-gray-700 rounded-lg" />
            ))}
          </>
        )}

        {!loading && (error || !data) && (
          <div className="text-center py-16">
            <p className="text-red-600 dark:text-red-400 mb-4">{error || 'Something went wrong'}</p>
            <button
              onClick={() => { setError(null); setLoading(true); load() }}
              className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors cursor-pointer"
            >
              Retry
            </button>
          </div>
        )}

        {!loading && data && (
          <>
            <ExportProject
              projectId={projectId}
              projectName={data.project.name}
              totalChapters={data.chapters.filter(ch => !ch.archivedAt).length}
            />
            <ProjectBackup projectId={projectId} />
            <ManuscriptDisplaySettings projectId={projectId} />
            <ProjectManagement
              projectId={projectId}
              isArchived={data.project.isArchived}
              onArchiveChange={(isArchived) => {
                setData(prev => prev ? { ...prev, project: { ...prev.project, isArchived } } : prev)
              }}
              onDelete={() => router.push('/dashboard')}
            />
          </>
        )}
      </div>
    </div>
  )
}

function Chevron() {
  return (
    <svg className="w-3.5 h-3.5 shrink-0 text-gray-400 dark:text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
    </svg>
  )
}
