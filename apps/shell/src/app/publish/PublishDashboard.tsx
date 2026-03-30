'use client'

import { useState, useEffect, useCallback } from 'react'
import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import { SiteNav } from '@/components/SiteNav'
import { SkeletonList } from '@/components/LoadingState'
import { EmptyState } from '@/components/EmptyState'
import { config } from '@/lib/config'
import { apiFetch } from '@/lib/api'
import { BobbinrySDK } from '@bobbinry/sdk'
import PublishManagerPanel from '@bobbinry/web-publisher/panels/publish-manager'
import ScheduledReleasesPanel from '@bobbinry/web-publisher/panels/scheduled-releases'
import ReleaseConfig from '@bobbinry/web-publisher/views/release-config'

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

interface Chapter {
  id: string
  title?: string
  order?: number
}

interface ChapterPublication {
  chapterId: string
  publishStatus: string
  publishedAt?: string
  viewCount?: number
}

function PublisherWorkspace({
  projectId,
  apiToken,
  selectedChapterId,
  onSelectChapter,
  refreshKey,
}: {
  projectId: string
  apiToken: string
  selectedChapterId: string | null
  onSelectChapter: (chapterId: string | null) => void
  refreshKey: number
}) {
  const [sdk] = useState(() => {
    const instance = new BobbinrySDK('web-publisher')
    instance.setProject(projectId)
    instance.api.setAuthToken(apiToken)
    return instance
  })

  useEffect(() => {
    sdk.setProject(projectId)
    sdk.api.setAuthToken(apiToken)
  }, [sdk, projectId, apiToken])

  return (
    <div className="grid gap-4 xl:grid-cols-[minmax(0,1.4fr)_360px]">
      <div className="space-y-4">
        <section className="overflow-hidden rounded-xl border border-gray-200 bg-white dark:border-gray-800 dark:bg-gray-900">
          <div className="border-b border-gray-100 px-5 py-4 dark:border-gray-800">
            <h4 className="font-display text-base font-semibold text-gray-900 dark:text-gray-100">
              Project publishing overview
            </h4>
            <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
              Project-wide reach, completion, and publishing progress at a glance.
            </p>
          </div>
          <PublishManagerPanel
            projectId={projectId}
            apiToken={apiToken}
            refreshKey={refreshKey}
            mode="overview"
          />
        </section>

        <section className="overflow-hidden rounded-xl border border-gray-200 bg-white dark:border-gray-800 dark:bg-gray-900">
          <div className="border-b border-gray-100 px-5 py-4 dark:border-gray-800">
            <h4 className="font-display text-base font-semibold text-gray-900 dark:text-gray-100">
              Published chapters
            </h4>
            <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
              Select a published chapter to inspect its audience, completion, and reading behavior.
            </p>
          </div>
          <PublishManagerPanel
            projectId={projectId}
            apiToken={apiToken}
            refreshKey={refreshKey}
            selectedChapterId={selectedChapterId}
            onSelectChapter={onSelectChapter}
            mode="chapters"
          />
        </section>

        <section className="overflow-hidden rounded-xl border border-gray-200 bg-white dark:border-gray-800 dark:bg-gray-900">
          <ScheduledReleasesPanel
            projectId={projectId}
            apiToken={apiToken}
            refreshKey={refreshKey}
          />
        </section>
      </div>

      <div className="space-y-4">
        <section className="overflow-hidden rounded-xl border border-gray-200 bg-white dark:border-gray-800 dark:bg-gray-900">
          <ReleaseConfig sdk={sdk} projectId={projectId} />
        </section>
      </div>
    </div>
  )
}

export function PublishDashboard({ user, apiToken }: { user: User; apiToken: string }) {
  const searchParams = useSearchParams()
  const [projects, setProjects] = useState<Project[]>([])
  const [loading, setLoading] = useState(true)
  const [actionInProgress, setActionInProgress] = useState<string | null>(null)
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null)
  const [expandedProject, setExpandedProject] = useState<string | null>(null)
  const [chapters, setChapters] = useState<Record<string, Chapter[]>>({})
  const [publications, setPublications] = useState<Record<string, Record<string, ChapterPublication>>>({})
  const [slugInputs, setSlugInputs] = useState<Record<string, string>>({})
  const [slugAvailability, setSlugAvailability] = useState<Record<string, boolean | null>>({})
  const [publishRefreshKey] = useState(0)
  const [selectedChapterId, setSelectedChapterId] = useState<string | null>(null)
  const [slugChecking, setSlugChecking] = useState<Record<string, boolean>>({})
  const [username, setUsername] = useState<string>('')
  const [projectVisibility, setProjectVisibility] = useState<Record<string, string>>({})

  const authorId = username || user.id

  const slugify = (text: string) =>
    text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')

  const generateDefaultSlug = (projectName: string) => {
    return slugify(projectName)
  }

  const loadProjects = useCallback(async () => {
    try {
      const res = await apiFetch('/api/users/me/projects/grouped', apiToken)
      if (res.ok) {
        const data = await res.json()
        const allProjects: Project[] = [
          ...(data.uncategorized || []),
          ...(data.collections || []).flatMap((collection: any) => collection.projects || []),
        ]
        const activeProjects = allProjects.filter((project) => !project.isArchived)
        setProjects(activeProjects)

        const published = activeProjects.filter((project) => project.shortUrl)
        const pubResults = await Promise.allSettled(
          published.map((project) =>
            apiFetch(`/api/projects/${project.id}/publications?status=all`, apiToken)
              .then((response) => response.json())
              .then((data) => ({ projectId: project.id, publications: data.publications || [] }))
          )
        )

        const pubMap: Record<string, Record<string, ChapterPublication>> = {}
        for (const result of pubResults) {
          if (result.status === 'fulfilled') {
            const { projectId, publications: projectPublications } = result.value
            pubMap[projectId] = {}
            for (const publication of projectPublications) {
              pubMap[projectId][publication.chapterId] = publication
            }
          }
        }

        setPublications((current) => ({ ...current, ...pubMap }))

        // Load visibility settings for published projects
        const visResults = await Promise.allSettled(
          published.map((project) =>
            apiFetch(`/api/projects/${project.id}/publish-config`, apiToken)
              .then((response) => response.json())
              .then((data) => ({ projectId: project.id, visibility: data.config?.defaultVisibility || 'public' }))
          )
        )
        const visMap: Record<string, string> = {}
        for (const result of visResults) {
          if (result.status === 'fulfilled') {
            visMap[result.value.projectId] = result.value.visibility
          }
        }
        setProjectVisibility((current) => ({ ...current, ...visMap }))
      }
    } catch (err) {
      console.error('Failed to load projects:', err)
    } finally {
      setLoading(false)
    }
  }, [apiToken])

  useEffect(() => {
    const loadProfile = async () => {
      try {
        const response = await apiFetch(`/api/users/${user.id}/profile`, apiToken)
        if (response.ok) {
          const data = await response.json()
          setUsername(data.profile?.username || '')
        }
      } catch {
        // ignore
      }
    }

    void loadProfile()
  }, [user.id, apiToken])

  useEffect(() => {
    void loadProjects()
  }, [loadProjects])

  const loadProjectChapters = useCallback(async (projectId: string) => {
    try {
      const [chaptersRes, publicationsRes] = await Promise.all([
        apiFetch(`/api/collections/content/entities?projectId=${projectId}`, apiToken),
        apiFetch(`/api/projects/${projectId}/publications?status=all`, apiToken),
      ])

      let chapterList: Chapter[] = []
      if (chaptersRes.ok) {
        const data = await chaptersRes.json()
        chapterList = (data.entities || []).sort(
          (a: Chapter, b: Chapter) => (a.order ?? 0) - (b.order ?? 0)
        )
        setChapters((current) => ({ ...current, [projectId]: chapterList }))
      }

      if (publicationsRes.ok) {
        const data = await publicationsRes.json()
        const projectPublications: Record<string, ChapterPublication> = {}
        for (const publication of data.publications || []) {
          projectPublications[publication.chapterId] = publication
        }
        setPublications((current) => ({ ...current, [projectId]: projectPublications }))
      }

      return chapterList
    } catch (err) {
      console.error('Failed to load project publishing data:', err)
      return []
    }
  }, [apiToken])

  const expandProject = useCallback(async (projectId: string, preferredChapterId?: string | null) => {
    setExpandedProject(projectId)
    const chapterList = await loadProjectChapters(projectId)
    const nextSelected = preferredChapterId || chapterList[0]?.id || null
    setSelectedChapterId(nextSelected)
  }, [loadProjectChapters])

  useEffect(() => {
    if (loading) return

    const projectId = searchParams.get('project')
    if (!projectId) return
    if (!projects.some((project) => project.id === projectId)) return
    if (expandedProject === projectId) return

    void expandProject(projectId, searchParams.get('chapter'))
  }, [loading, projects, expandedProject, searchParams, expandProject])

  const toggleProjectExpansion = async (projectId: string) => {
    if (expandedProject === projectId) {
      setExpandedProject(null)
      setSelectedChapterId(null)
      return
    }

    await expandProject(projectId)
  }

  const checkSlugAvailability = async (slug: string) => {
    if (!slug || slug.length < 2) {
      setSlugAvailability((current) => ({ ...current, [slug]: null }))
      return
    }

    setSlugChecking((current) => ({ ...current, [slug]: true }))
    try {
      const response = await fetch(`${config.apiUrl}/api/short-urls/check`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ shortUrl: slug, type: 'project' }),
      })

      if (response.ok) {
        const data = await response.json()
        setSlugAvailability((current) => ({ ...current, [slug]: data.available }))
      }
    } catch {
      // ignore
    } finally {
      setSlugChecking((current) => ({ ...current, [slug]: false }))
    }
  }

  const enablePublishing = async (projectId: string) => {
    const project = projects.find((item) => item.id === projectId)
    if (!project) return

    setActionInProgress(projectId)
    setMessage(null)

    try {
      const customUrl = slugInputs[projectId] || generateDefaultSlug(project.name)

      const urlRes = await apiFetch(`/api/projects/${projectId}/short-url`, apiToken, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ customUrl }),
      })

      if (!urlRes.ok) {
        const errData = await urlRes.json().catch(() => ({}))
        throw new Error(errData.error || 'Failed to claim publishing URL')
      }

      await apiFetch(`/api/projects/${projectId}/publish-config`, apiToken, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ publishingMode: 'live', defaultVisibility: 'public' }),
      })

      setMessage({
        type: 'success',
        text: 'Publishing enabled. Set your release cadence and select a chapter to manage publishing.',
      })
      await loadProjects()
      await expandProject(projectId)
    } catch (err) {
      setMessage({
        type: 'error',
        text: err instanceof Error ? err.message : 'Failed to enable publishing',
      })
    } finally {
      setActionInProgress(null)
    }
  }

  const disablePublishing = async (projectId: string) => {
    setActionInProgress(projectId)
    setMessage(null)

    try {
      await apiFetch(`/api/projects/${projectId}/publish-config`, apiToken, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ publishingMode: 'draft' }),
      })

      await apiFetch(`/api/projects/${projectId}/short-url`, apiToken, {
        method: 'DELETE',
      })

      setMessage({ type: 'success', text: 'Publishing disabled.' })
      setExpandedProject(null)
      setSelectedChapterId(null)
      await loadProjects()
    } catch (err) {
      setMessage({
        type: 'error',
        text: err instanceof Error ? err.message : 'Failed to disable publishing',
      })
    } finally {
      setActionInProgress(null)
    }
  }

  const updateProjectVisibility = async (projectId: string, visibility: string) => {
    try {
      await apiFetch(`/api/projects/${projectId}/publish-config`, apiToken, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ defaultVisibility: visibility }),
      })
      setProjectVisibility((current) => ({ ...current, [projectId]: visibility }))
    } catch (err) {
      setMessage({
        type: 'error',
        text: err instanceof Error ? err.message : 'Failed to update visibility',
      })
    }
  }

  const publishedProjects = projects.filter((project) => project.shortUrl)
  const draftProjects = projects.filter((project) => !project.shortUrl)

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 dark:bg-gray-950">
        <SiteNav />
        <header className="border-b border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-800">
          <div className="mx-auto max-w-6xl px-4 py-6 sm:px-6 animate-pulse">
            <div className="mb-2 h-7 w-48 rounded bg-gray-100 dark:bg-gray-700" />
            <div className="h-4 w-72 rounded bg-gray-100 dark:bg-gray-700" />
          </div>
        </header>
        <div className="mx-auto max-w-6xl px-4 py-8 sm:px-6">
          <SkeletonList count={3} />
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-950">
      <SiteNav />

      <header className="border-b border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-800">
        <div className="mx-auto max-w-6xl px-4 py-6 sm:px-6">
          <div className="flex items-center justify-between gap-4">
            <div>
              <h1 className="font-display text-2xl font-bold text-gray-900 dark:text-gray-100">
                Publisher
              </h1>
              <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
                Set project cadence, manage release order, and handle chapter publishing from one workspace.
              </p>
            </div>
            <Link
              href="/settings/monetization"
              className="flex items-center gap-1.5 text-sm text-gray-500 transition-colors hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-300"
            >
              <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              Monetization
            </Link>
          </div>
        </div>
      </header>

      <div className="mx-auto max-w-6xl px-4 py-8 sm:px-6">
        {message ? (
          <div
            className={`mb-6 rounded-lg border p-4 text-sm ${
              message.type === 'success'
                ? 'border-green-200 bg-green-50 text-green-800 dark:border-green-800 dark:bg-green-900/20 dark:text-green-300'
                : 'border-red-200 bg-red-50 text-red-800 dark:border-red-800 dark:bg-red-900/20 dark:text-red-300'
            }`}
          >
            {message.text}
          </div>
        ) : null}

        {projects.length === 0 ? (
          <EmptyState
            icon={
              <svg className="h-12 w-12 text-gray-300 dark:text-gray-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" />
              </svg>
            }
            title="No projects yet"
            description="Create a project first, then come back here to publish it."
            action={{ label: 'Create Project', href: '/projects/new' }}
          />
        ) : (
          <div className="space-y-8">
            {publishedProjects.length > 0 ? (
              <section>
                <h2 className="mb-4 flex items-center gap-2 font-display text-lg font-semibold text-gray-900 dark:text-gray-100">
                  <span className="h-2 w-2 rounded-full bg-green-500" />
                  Live projects ({publishedProjects.length})
                </h2>
                <div className="space-y-4">
                  {publishedProjects.map((project) => {
                    const isExpanded = expandedProject === project.id
                    const projectChapters = chapters[project.id] || []
                    const projectPublications = publications[project.id] || {}
                    const publishedCount = Object.values(projectPublications).filter(
                      (publication) => publication.publishStatus === 'published'
                    ).length

                    return (
                      <div
                        key={project.id}
                        className="overflow-hidden rounded-xl border border-gray-200 bg-white dark:border-gray-800 dark:bg-gray-900"
                      >
                        <div className="p-5">
                          <div className="flex items-start justify-between gap-4">
                            <div className="min-w-0 flex-1">
                              <div className="mb-2 flex items-center gap-2">
                                <h3 className="truncate font-display text-lg font-semibold text-gray-900 dark:text-gray-100">
                                  {project.name}
                                </h3>
                                <span className="inline-flex items-center rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-700 dark:bg-green-900/30 dark:text-green-400">
                                  Live
                                </span>
                              </div>
                              {project.description ? (
                                <p className="mb-3 text-sm text-gray-500 dark:text-gray-400">
                                  {project.description}
                                </p>
                              ) : null}

                              <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm">
                                <div className="flex items-center gap-2">
                                  <span className="text-gray-400 dark:text-gray-500">URL</span>
                                  <Link
                                    href={`/read/${authorId}/${project.shortUrl}`}
                                    className="font-mono text-xs text-blue-600 hover:underline dark:text-blue-400"
                                  >
                                    /read/{authorId}/{project.shortUrl}
                                  </Link>
                                </div>
                                <span className="text-xs text-gray-500 dark:text-gray-400">
                                  {publishedCount} published
                                  {projectChapters.length > 0 ? ` · ${projectChapters.length} total chapters` : ''}
                                </span>
                                <div className="flex items-center gap-2">
                                  <span className="text-gray-400 dark:text-gray-500">Visibility</span>
                                  <select
                                    value={projectVisibility[project.id] || 'public'}
                                    onChange={(e) => void updateProjectVisibility(project.id, e.target.value)}
                                    className="rounded-md border border-gray-200 bg-white px-2 py-1 text-xs text-gray-700 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-300"
                                  >
                                    <option value="public">Public</option>
                                    <option value="subscribers_only">Subscribers Only</option>
                                  </select>
                                </div>
                              </div>
                            </div>

                            <div className="flex flex-wrap items-center justify-end gap-2">
                              <button
                                onClick={() => void toggleProjectExpansion(project.id)}
                                className="rounded-md bg-blue-600 px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-blue-700"
                              >
                                {isExpanded ? 'Hide workspace' : 'Manage publishing'}
                              </button>
                              <Link
                                href={`/projects/${project.id}`}
                                className="rounded-md bg-gray-100 px-3 py-1.5 text-sm text-gray-700 transition-colors hover:bg-gray-200 dark:bg-gray-800 dark:text-gray-300 dark:hover:bg-gray-700"
                              >
                                Project dashboard
                              </Link>
                              <button
                                onClick={() => disablePublishing(project.id)}
                                disabled={actionInProgress === project.id}
                                className="rounded-md px-3 py-1.5 text-sm text-red-600 transition-colors hover:bg-red-50 disabled:opacity-50 dark:text-red-400 dark:hover:bg-red-900/10"
                              >
                                {actionInProgress === project.id ? 'Disabling...' : 'Disable'}
                              </button>
                            </div>
                          </div>
                        </div>

                        {isExpanded ? (
                          <div className="border-t border-gray-100 bg-gray-50/60 px-5 py-5 dark:border-gray-800 dark:bg-gray-950/30">
                            <PublisherWorkspace
                              projectId={project.id}
                              apiToken={apiToken}
                              selectedChapterId={selectedChapterId}
                              onSelectChapter={setSelectedChapterId}
                              refreshKey={publishRefreshKey}
                            />
                          </div>
                        ) : null}
                      </div>
                    )
                  })}
                </div>
              </section>
            ) : null}

            {draftProjects.length > 0 ? (
              <section>
                <h2 className="mb-4 flex items-center gap-2 font-display text-lg font-semibold text-gray-900 dark:text-gray-100">
                  <span className="h-2 w-2 rounded-full bg-gray-400 dark:bg-gray-600" />
                  Not yet published ({draftProjects.length})
                </h2>
                <div className="space-y-3">
                  {draftProjects.map((project) => {
                    const currentSlug = slugInputs[project.id] ?? generateDefaultSlug(project.name)
                    const availability = slugAvailability[currentSlug]
                    const checking = slugChecking[currentSlug]

                    return (
                      <div
                        key={project.id}
                        className="rounded-xl border border-gray-200 bg-white p-5 dark:border-gray-800 dark:bg-gray-900"
                      >
                        <div className="flex items-start justify-between gap-4">
                          <div className="min-w-0 flex-1">
                            <h3 className="mb-1 truncate font-display font-semibold text-gray-900 dark:text-gray-100">
                              {project.name}
                            </h3>
                            {project.description ? (
                              <p className="mb-3 text-sm text-gray-500 dark:text-gray-400">
                                {project.description}
                              </p>
                            ) : null}
                            <div className="flex items-center gap-2">
                              <span className="flex-shrink-0 font-mono text-xs text-gray-400 dark:text-gray-500">
                                /read/{authorId}/
                              </span>
                              <input
                                type="text"
                                value={currentSlug}
                                onChange={(event) => {
                                  const nextValue = slugify(event.target.value)
                                  setSlugInputs((current) => ({ ...current, [project.id]: nextValue }))
                                }}
                                onBlur={() => void checkSlugAvailability(currentSlug)}
                                placeholder={generateDefaultSlug(project.name)}
                                className="max-w-xs flex-1 rounded border border-gray-200 bg-gray-50 px-2.5 py-1.5 font-mono text-xs text-gray-900 focus:border-transparent focus:ring-2 focus:ring-blue-500 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100"
                              />
                              {checking ? (
                                <span className="text-xs text-gray-400">checking...</span>
                              ) : null}
                              {!checking && availability === true ? (
                                <span className="text-xs text-green-600 dark:text-green-400">available</span>
                              ) : null}
                              {!checking && availability === false ? (
                                <span className="text-xs text-red-600 dark:text-red-400">taken</span>
                              ) : null}
                            </div>
                          </div>

                          <div className="flex items-center gap-2">
                            <Link
                              href={`/projects/${project.id}`}
                              className="rounded-md bg-gray-100 px-3 py-1.5 text-sm text-gray-700 transition-colors hover:bg-gray-200 dark:bg-gray-800 dark:text-gray-300 dark:hover:bg-gray-700"
                            >
                              Project dashboard
                            </Link>
                            <button
                              onClick={() => enablePublishing(project.id)}
                              disabled={actionInProgress === project.id || availability === false}
                              className="rounded-md bg-blue-600 px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-blue-700 disabled:opacity-50"
                            >
                              {actionInProgress === project.id ? 'Enabling...' : 'Set up publishing'}
                            </button>
                          </div>
                        </div>
                      </div>
                    )
                  })}
                </div>
              </section>
            ) : null}

            <section className="rounded-xl border border-blue-100 bg-blue-50/60 p-6 dark:border-blue-900/30 dark:bg-blue-950/10">
              <h3 className="font-display font-semibold text-gray-900 dark:text-gray-100">
                Publishing model
              </h3>
              <ul className="mt-3 space-y-2 text-sm text-gray-600 dark:text-gray-400">
                <li>Set project cadence here. This is the only place to control automatic release timing.</li>
                <li>Select a chapter from the performance list to open chapter-specific publish and schedule controls.</li>
                <li>Use the project dashboard for writing and metadata. Use the Publisher for release workflow.</li>
              </ul>
            </section>
          </div>
        )}
      </div>
    </div>
  )
}
