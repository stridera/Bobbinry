'use client'

import { useState, useEffect, useCallback } from 'react'
import { useParams } from 'next/navigation'
import { useSession } from 'next-auth/react'
import { SiteNav } from '@/components/SiteNav'
import { apiFetch } from '@/lib/api'
import { ProjectMasthead } from './components/dashboard/ProjectMasthead'
import { ProjectTabs } from './components/dashboard/ProjectTabs'
import { DashboardRail } from './components/dashboard/DashboardRail'
import { ChapterOverview } from './components/dashboard/ChapterOverview'
import { ReaderActivity } from './components/dashboard/ReaderActivity'
import { countsTowardWordCount, type ContentType } from '@bobbinry/types'

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
    narrativeWordCount: number
    archivedCount: number
    trashedCount: number
  }
  chapters: Array<{
    id: string
    slug?: string | null
    title: string
    order: number
    /** Place in the writing tab's tree across the whole project. */
    manuscriptPosition: number
    /** Enclosing folder titles, e.g. "Part 2" or "Book One › Act I". */
    folderPath: string | null
    collectionName: string
    contentType: ContentType
    archivedAt: string | null
    wordCount: number
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
    projectVisibility?: string
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
    manifest: {
      name: string
      description: string
      icon?: string
      hasLeftPanel: boolean
      core?: boolean
      /** Declared via `capabilities.annotationInbox`; drives the feedback tab and inbox links. */
      annotationInbox?: boolean
    }
  }>
  bobbinStats: Record<string, number>
}

export default function ProjectDashboardPage() {
  const params = useParams()
  const { data: session } = useSession()
  const apiToken = session?.apiToken
  const projectId = params.projectId as string

  const [data, setData] = useState<DashboardData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const loadDashboard = useCallback(async () => {
    if (!apiToken) return
    try {
      // Fetch with includeArchived=all so ChapterOverview can render both the
      // active list and the archived filter view without a refetch.
      const response = await apiFetch(`/api/projects/${projectId}/dashboard?includeArchived=all`, apiToken)
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
  }, [projectId, apiToken])

  useEffect(() => {
    if (apiToken) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- initial fetch
      loadDashboard()
    }
  }, [apiToken, loadDashboard])

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 dark:bg-gray-950">
        <SiteNav />
        <header className="bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700">
          <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 pt-4 animate-pulse">
            <div className="h-4 w-40 rounded bg-gray-100 dark:bg-gray-700" />
            <div className="mt-3 flex items-start gap-5">
              <div className="w-20 h-[118px] rounded-md bg-gray-200 dark:bg-gray-700" />
              <div className="flex-1 space-y-3 pt-1">
                <div className="h-7 w-64 rounded bg-gray-200 dark:bg-gray-700" />
                <div className="h-4 w-96 max-w-full rounded bg-gray-100 dark:bg-gray-700" />
                <div className="h-5 w-72 rounded bg-gray-100 dark:bg-gray-700" />
              </div>
            </div>
            <div className="mt-6 h-10 w-80 rounded-t bg-gray-100 dark:bg-gray-700" />
          </div>
        </header>
        <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-8 grid gap-8 lg:grid-cols-[minmax(0,1fr)_18rem]">
          <div className="space-y-6">
            <div className="animate-pulse h-80 bg-gray-200 dark:bg-gray-700 rounded-lg" />
            <div className="animate-pulse h-40 bg-gray-200 dark:bg-gray-700 rounded-lg" />
          </div>
          <div className="space-y-4 animate-pulse">
            <div className="h-28 bg-gray-200 dark:bg-gray-700 rounded-lg" />
            <div className="h-20 bg-gray-200 dark:bg-gray-700 rounded-lg" />
            <div className="h-40 bg-gray-200 dark:bg-gray-700 rounded-lg" />
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

  // Whichever installed bobbin declares `capabilities.annotationInbox` owns the feedback inbox.
  const hasAnnotationInbox = data.bobbins.some(b => b.manifest.annotationInbox)
  const isLive = data.publishConfig.publishingMode === 'live'
  const readerHref = data.authorUsername && data.project.shortUrl
    ? `/read/${data.authorUsername}/${data.project.shortUrl}`
    : null
  const activeChapters = data.chapters.filter(c => !c.archivedAt)
  const openFeedback = (data.annotationStats?.open ?? 0) + (data.annotationStats?.acknowledged ?? 0)

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-950">
      <SiteNav />

      <ProjectMasthead
        projectId={projectId}
        name={data.project.name}
        description={data.project.description}
        coverImage={data.project.coverImage}
        publishingMode={data.publishConfig.publishingMode}
        projectVisibility={data.publishConfig.projectVisibility}
        readerHref={readerHref}
        stats={{
          words: data.analytics.narrativeWordCount,
          chapters: activeChapters.filter(c => countsTowardWordCount(c.contentType)).length,
          published: data.analytics.publishedChapters,
          reads: data.analytics.totalViews,
          comments: activeChapters.reduce((sum, ch) => sum + ch.commentCount, 0),
          openFeedback: data.publishConfig.enableAnnotations ? openFeedback : null,
        }}
        onUpdate={(updates) => {
          setData(prev => prev ? {
            ...prev,
            project: { ...prev.project, ...updates }
          } : prev)
        }}
      >
        <ProjectTabs
          projectId={projectId}
          bobbins={data.bobbins}
          bobbinStats={data.bobbinStats}
          openFeedback={data.publishConfig.enableAnnotations ? openFeedback : 0}
        />
      </ProjectMasthead>

      <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-8 grid gap-8 lg:grid-cols-[minmax(0,1fr)_18rem]">
        {/* Main column: the work */}
        <div className="min-w-0 space-y-6">
          <ChapterOverview
            chapters={data.chapters}
            trashedCount={data.analytics.trashedCount}
            projectId={projectId}
            readerBaseUrl={readerHref}
            showEngagement={isLive}
            onStatusChange={() => loadDashboard()}
          />

          <ReaderActivity
            projectId={projectId}
            chapters={data.chapters}
            isLive={isLive}
            enableAnnotations={data.publishConfig.enableAnnotations}
            hasAnnotationInbox={hasAnnotationInbox}
            annotationStats={data.annotationStats}
            readerBaseUrl={readerHref}
          />
        </div>

        {/* Rail: reference and tools */}
        <DashboardRail
          projectId={projectId}
          tags={data.tags}
          onTagsChange={(tags) => {
            setData(prev => prev ? { ...prev, tags } : prev)
          }}
          publishConfig={data.publishConfig}
          readerHref={readerHref}
          onImportComplete={() => loadDashboard()}
        />
      </div>
    </div>
  )
}
