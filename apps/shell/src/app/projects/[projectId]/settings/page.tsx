'use client'

import { useState, useEffect } from 'react'
import { useParams } from 'next/navigation'
import { useSession } from 'next-auth/react'
import Link from 'next/link'
import { apiFetch } from '@/lib/api'
import { DashboardHero } from './components/DashboardHero'
import { StatsCards } from './components/StatsCards'
import { TagsEditor } from './components/TagsEditor'
import { ChapterOverview } from './components/ChapterOverview'
import { ScheduledReleases } from './components/ScheduledReleases'
import { PublishingSettings } from './components/PublishingSettings'
import { ProjectManagement } from './components/ProjectManagement'

interface Tag {
  id: string
  tagCategory: string
  tagName: string
}

interface DashboardData {
  project: {
    id: string
    name: string
    description: string | null
    coverImage: string | null
    shortUrl: string | null
    isArchived: boolean
    createdAt: string
    updatedAt: string
  }
  authorUsername: string | null
  tags: Tag[]
  analytics: {
    totalChapters: number
    publishedChapters: number
    totalViews: number
    totalCompletions: number
    avgViewsPerChapter: number
  }
  chapters: Array<{
    id: string
    title: string
    order: number
    collectionName: string
    commentCount: number
    reactionCount: number
    publication: {
      publishStatus: string
      publishedAt: string | null
      viewCount: number
      uniqueViewCount: number
      completionCount: number
      avgReadTimeSeconds: number | null
    } | null
  }>
  scheduledReleases: Array<{
    chapterId: string
    chapterTitle: string
    scheduledDate: string | null
    publishStatus: string
  }>
  publishConfig: {
    projectId: string
    publishingMode: string
    defaultVisibility: string
    autoReleaseEnabled: boolean
    releaseFrequency: string
    releaseDay?: string
    releaseTime?: string
    slugPrefix?: string
    seoDescription?: string
    ogImageUrl?: string
    enableComments: boolean
    enableReactions: boolean
    moderationMode: string
  }
  bobbins: Array<{
    id: string
    bobbinId: string
    version: string
    manifest: { name: string; description: string }
  }>
}

export default function ProjectDashboardPage() {
  const params = useParams()
  const { data: session } = useSession()
  const projectId = params.projectId as string

  const [data, setData] = useState<DashboardData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (session?.apiToken) {
      loadDashboard()
    }
  }, [projectId, session?.apiToken])

  const loadDashboard = async () => {
    const token = session?.apiToken
    if (!token) return
    try {
      const response = await apiFetch(`/api/projects/${projectId}/dashboard`, token)
      if (response.ok) {
        const result = await response.json()
        setData(result)
      } else {
        setError('Failed to load dashboard')
      }
    } catch (err) {
      console.error('Failed to load dashboard:', err)
      setError('Failed to load dashboard')
    } finally {
      setLoading(false)
    }
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 dark:bg-gray-900">
        <header className="bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700">
          <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-4">
            <div className="animate-pulse">
              <div className="h-4 bg-gray-100 dark:bg-gray-700 rounded w-32 mb-2" />
              <div className="h-6 bg-gray-100 dark:bg-gray-700 rounded w-48" />
            </div>
          </div>
        </header>
        <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-6">
          <div className="animate-pulse h-60 bg-gray-200 dark:bg-gray-700 rounded-xl" />
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            {[1, 2, 3, 4].map(i => (
              <div key={i} className="animate-pulse h-20 bg-gray-200 dark:bg-gray-700 rounded-lg" />
            ))}
          </div>
        </div>
      </div>
    )
  }

  if (error || !data) {
    return (
      <div className="min-h-screen bg-gray-50 dark:bg-gray-900 flex items-center justify-center">
        <div className="text-center">
          <p className="text-red-600 dark:text-red-400 mb-4">{error || 'Something went wrong'}</p>
          <button
            onClick={() => { setError(null); setLoading(true); loadDashboard() }}
            className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors cursor-pointer"
          >
            Retry
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900">
      {/* Header */}
      <header className="bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-4">
          <div className="flex items-center gap-2 text-sm text-gray-500 dark:text-gray-400 mb-1">
            <Link href="/dashboard" className="hover:text-gray-900 dark:hover:text-gray-100 transition-colors">Dashboard</Link>
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
            </svg>
            <Link href={`/projects/${projectId}`} className="hover:text-gray-900 dark:hover:text-gray-100 transition-colors">{data.project.name}</Link>
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
            </svg>
            <span className="text-gray-900 dark:text-gray-100">Dashboard</span>
          </div>
          <h1 className="font-display text-2xl font-bold text-gray-900 dark:text-gray-100">Project Dashboard</h1>
        </div>
      </header>

      {/* Main content */}
      <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-6">
        <DashboardHero
          projectId={projectId}
          name={data.project.name}
          description={data.project.description}
          coverImage={data.project.coverImage}
          readerUrl={data.authorUsername && data.project.shortUrl
            ? `/read/${data.authorUsername}/${data.project.shortUrl}`
            : null}
          onUpdate={(updates) => {
            setData(prev => prev ? {
              ...prev,
              project: { ...prev.project, ...updates }
            } : prev)
          }}
        />

        <StatsCards analytics={data.analytics} />

        <TagsEditor
          projectId={projectId}
          tags={data.tags}
          onTagsChange={(tags) => {
            setData(prev => prev ? { ...prev, tags } : prev)
          }}
        />

        <ChapterOverview
          chapters={data.chapters}
          readerBaseUrl={data.authorUsername && data.project.shortUrl
            ? `/read/${data.authorUsername}/${data.project.shortUrl}`
            : null}
        />

        <ScheduledReleases releases={data.scheduledReleases} />

        <PublishingSettings
          projectId={projectId}
          config={data.publishConfig}
          onUpdate={(config) => {
            setData(prev => prev ? { ...prev, publishConfig: config } : prev)
          }}
        />

        <ProjectManagement
          projectId={projectId}
          isArchived={data.project.isArchived}
          bobbins={data.bobbins}
          onArchiveChange={(isArchived) => {
            setData(prev => prev ? {
              ...prev,
              project: { ...prev.project, isArchived }
            } : prev)
          }}
          onBobbinUninstall={(bobbinId) => {
            setData(prev => prev ? {
              ...prev,
              bobbins: prev.bobbins.filter(b => b.id !== bobbinId)
            } : prev)
          }}
        />
      </div>
    </div>
  )
}
