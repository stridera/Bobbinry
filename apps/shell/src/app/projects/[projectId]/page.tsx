'use client'

import { useState, useEffect } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { useSession } from 'next-auth/react'
import Link from 'next/link'
import { SiteNav } from '@/components/SiteNav'
import { apiFetch } from '@/lib/api'
import { DashboardHero } from './components/dashboard/DashboardHero'
import { TagsEditor } from './components/dashboard/TagsEditor'
import { ChapterOverview } from './components/dashboard/ChapterOverview'
import { ProjectManagement } from './components/dashboard/ProjectManagement'
import { ExportProject } from './components/dashboard/ExportProject'

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
    annotationCount: number
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
    enableAnnotations: boolean
    annotationAccess: string
    moderationMode: string
  }
  annotationStats?: {
    open: number
    acknowledged: number
    resolved: number
    dismissed: number
    total: number
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
  const router = useRouter()
  const { data: session } = useSession()
  const projectId = params.projectId as string

  const [data, setData] = useState<DashboardData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (session?.apiToken) {
      loadDashboard()
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
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
      <div className="min-h-screen bg-gray-50 dark:bg-gray-950">
        <SiteNav />
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
      <div className="min-h-screen bg-gray-50 dark:bg-gray-950">
        <SiteNav />
        <div className="flex items-center justify-center py-32">
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
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-950">
      <SiteNav />
      {/* Header */}
      <header className="bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-4">
          <div className="flex items-center gap-2 text-sm text-gray-500 dark:text-gray-400 mb-1">
            <Link href="/dashboard" className="hover:text-gray-900 dark:hover:text-gray-100 transition-colors">Dashboard</Link>
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
            </svg>
            <span className="text-gray-900 dark:text-gray-100">{data.project.name}</span>
          </div>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <h1 className="font-display text-2xl font-bold text-gray-900 dark:text-gray-100">Project Dashboard</h1>
              {data.publishConfig.publishingMode === 'live' && (
                <span className="inline-flex items-center rounded-full px-2.5 py-1 text-xs font-medium bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300">
                  Live
                </span>
              )}
            </div>
            <div className="flex items-center">
              <div className="flex items-center gap-2">
                {data.publishConfig.publishingMode === 'live' && data.authorUsername && data.project.shortUrl && (
                  <Link
                    href={`/read/${data.authorUsername}/${data.project.shortUrl}`}
                    className="inline-flex items-center gap-1.5 px-4 py-2 border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700 rounded-lg font-medium text-sm transition-colors"
                  >
                    Reader Page
                    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                    </svg>
                  </Link>
                )}
                <Link
                  href={`/publish/${projectId}`}
                  className="inline-flex items-center gap-2 px-4 py-2 border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700 rounded-lg font-medium text-sm transition-colors"
                >
                  Publisher
                </Link>
              </div>
              <Link
                href={`/projects/${projectId}/write`}
                className="inline-flex items-center gap-2 ml-4 px-4 py-2 bg-blue-600 hover:bg-blue-700 dark:bg-blue-700 dark:hover:bg-blue-600 text-white rounded-lg font-medium text-sm transition-colors"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                </svg>
                Write
              </Link>
            </div>
          </div>
        </div>
      </header>

      {/* Main content */}
      <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-6">
        <DashboardHero
          projectId={projectId}
          name={data.project.name}
          description={data.project.description}
          coverImage={data.project.coverImage}
          onUpdate={(updates) => {
            setData(prev => prev ? {
              ...prev,
              project: { ...prev.project, ...updates }
            } : prev)
          }}
        />

        <TagsEditor
          projectId={projectId}
          tags={data.tags}
          onTagsChange={(tags) => {
            setData(prev => prev ? { ...prev, tags } : prev)
          }}
        />

        <ChapterOverview
          chapters={data.chapters}
          projectId={projectId}
          readerBaseUrl={data.authorUsername && data.project.shortUrl
            ? `/read/${data.authorUsername}/${data.project.shortUrl}`
            : null}
          onStatusChange={() => loadDashboard()}
        />

        {/* Reader Engagement */}
        <div className="bg-white dark:bg-gray-800 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700 p-6 animate-fade-in">
          <h2 className="font-display text-lg font-semibold text-gray-900 dark:text-gray-100 mb-4">Reader Engagement</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {/* Comments */}
            <div className="border border-gray-200 dark:border-gray-700 rounded-lg p-4">
              <div className="flex items-center justify-between mb-2">
                <h3 className="text-sm font-medium text-gray-900 dark:text-gray-100">Comments</h3>
                <span className={`text-xs px-2 py-0.5 rounded-full ${data.publishConfig.enableComments ? 'bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300' : 'bg-gray-100 text-gray-500 dark:bg-gray-700 dark:text-gray-400'}`}>
                  {data.publishConfig.enableComments ? 'Enabled' : 'Disabled'}
                </span>
              </div>
              <div className="text-2xl font-bold text-gray-900 dark:text-gray-100 mb-1">
                {data.chapters.reduce((sum, ch) => sum + ch.commentCount, 0)}
              </div>
              <p className="text-xs text-gray-500 dark:text-gray-400">
                across {data.chapters.filter(ch => ch.commentCount > 0).length} chapters
              </p>
              {data.authorUsername && data.project.shortUrl && (
                <Link
                  href={`/read/${data.authorUsername}/${data.project.shortUrl}`}
                  className="text-xs text-blue-600 dark:text-blue-400 hover:underline mt-2 inline-block"
                >
                  View on reader page &rarr;
                </Link>
              )}
            </div>

            {/* Feedback / Annotations */}
            <div className="border border-gray-200 dark:border-gray-700 rounded-lg p-4">
              <div className="flex items-center justify-between mb-2">
                <h3 className="text-sm font-medium text-gray-900 dark:text-gray-100">Feedback</h3>
                <span className={`text-xs px-2 py-0.5 rounded-full ${data.publishConfig.enableAnnotations ? 'bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300' : 'bg-gray-100 text-gray-500 dark:bg-gray-700 dark:text-gray-400'}`}>
                  {data.publishConfig.enableAnnotations ? `On (${data.publishConfig.annotationAccess.replace('_', ' ')})` : 'Disabled'}
                </span>
              </div>
              {(data.annotationStats?.total ?? 0) > 0 ? (
                <>
                  <div className="text-2xl font-bold text-gray-900 dark:text-gray-100 mb-1">
                    {(data.annotationStats?.open ?? 0) + (data.annotationStats?.acknowledged ?? 0)}
                    <span className="text-sm font-normal text-gray-500 dark:text-gray-400 ml-1">open</span>
                  </div>
                  <p className="text-xs text-gray-500 dark:text-gray-400">
                    {data.annotationStats?.total ?? 0} total &middot; {data.annotationStats?.resolved ?? 0} resolved
                  </p>
                  <Link
                    href={`/projects/${projectId}/feedback`}
                    className="text-xs text-blue-600 dark:text-blue-400 hover:underline mt-2 inline-block"
                  >
                    View feedback dashboard &rarr;
                  </Link>
                </>
              ) : (
                <>
                  <p className="text-sm text-gray-500 dark:text-gray-400 mb-2">
                    {data.publishConfig.enableAnnotations
                      ? 'No feedback yet. Readers with access can select text and leave annotations.'
                      : 'Let readers mark errors, suggest changes, and leave notes on your chapters.'}
                  </p>
                  {!data.publishConfig.enableAnnotations && (
                    <Link
                      href={`/publish/${projectId}`}
                      className="text-xs text-blue-600 dark:text-blue-400 hover:underline inline-block mb-1"
                    >
                      Enable in Publisher &rarr;
                    </Link>
                  )}
                  {data.publishConfig.enableAnnotations && data.bobbins.some(b => b.bobbinId === 'feedback') && (
                    <Link
                      href={`/projects/${projectId}/feedback`}
                      className="text-xs text-blue-600 dark:text-blue-400 hover:underline inline-block"
                    >
                      View feedback dashboard &rarr;
                    </Link>
                  )}
                  {data.publishConfig.enableAnnotations && !data.bobbins.some(b => b.bobbinId === 'feedback') && (
                    <Link
                      href={`/projects/${projectId}/bobbins`}
                      className="text-xs text-blue-600 dark:text-blue-400 hover:underline inline-block"
                    >
                      Install feedback bobbin for editor integration &rarr;
                    </Link>
                  )}
                </>
              )}
            </div>
          </div>
        </div>

        <ExportProject
          projectId={projectId}
          projectName={data.project.name}
          totalChapters={data.chapters.length}
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
          onDelete={() => router.push('/dashboard')}
        />
      </div>
    </div>
  )
}
