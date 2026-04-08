'use client'

import { useState, useEffect, useCallback } from 'react'
import Link from 'next/link'
import { useSearchParams, useRouter } from 'next/navigation'
import { SiteNav } from '@/components/SiteNav'
import { SkeletonList } from '@/components/LoadingState'
import { EmptyState } from '@/components/EmptyState'
import { config } from '@/lib/config'
import { apiFetch } from '@/lib/api'

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

interface ChapterPublication {
  chapterId: string
  publishStatus: string
  viewCount?: number
}

export function PublishDashboard({ user, apiToken }: { user: User; apiToken: string }) {
  const searchParams = useSearchParams()
  const router = useRouter()
  const [projects, setProjects] = useState<Project[]>([])
  const [loading, setLoading] = useState(true)
  const [actionInProgress, setActionInProgress] = useState<string | null>(null)
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null)
  const [publications, setPublications] = useState<Record<string, Record<string, ChapterPublication>>>({})
  const [slugInputs, setSlugInputs] = useState<Record<string, string>>({})
  const [slugAvailability, setSlugAvailability] = useState<Record<string, boolean | null>>({})
  const [slugChecking, setSlugChecking] = useState<Record<string, boolean>>({})
  const [username, setUsername] = useState<string>('')

  const authorId = username || user.id

  const slugify = (text: string) =>
    text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')

  const generateDefaultSlug = (projectName: string) => slugify(projectName)

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

        // Load publication counts for live projects
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
        setPublications(pubMap)
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

  // Backward compat: redirect ?project=X to /publish/X
  useEffect(() => {
    if (loading) return
    const projectId = searchParams.get('project')
    if (projectId) {
      router.replace(`/publish/${projectId}`)
    }
  }, [loading, searchParams, router])

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

      router.push(`/publish/${projectId}`)
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
                Select a project to manage its publishing workflow.
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
                <div className="space-y-3">
                  {publishedProjects.map((project) => {
                    const projectPublications = publications[project.id] || {}
                    const publishedCount = Object.values(projectPublications).filter(
                      (p) => p.publishStatus === 'published'
                    ).length
                    const totalViews = Object.values(projectPublications).reduce(
                      (sum, p) => sum + Number(p.viewCount || 0), 0
                    )

                    return (
                      <Link
                        key={project.id}
                        href={`/publish/${project.id}`}
                        className="group block overflow-hidden rounded-xl border border-gray-200 bg-white p-5 transition-colors hover:border-blue-300 hover:bg-blue-50/30 dark:border-gray-800 dark:bg-gray-900 dark:hover:border-blue-700 dark:hover:bg-blue-950/10"
                      >
                        <div className="flex items-start justify-between gap-4">
                          <div className="min-w-0 flex-1">
                            <div className="mb-1 flex items-center gap-2">
                              <h3 className="truncate font-display text-lg font-semibold text-gray-900 dark:text-gray-100">
                                {project.name}
                              </h3>
                              <span className="inline-flex items-center rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-700 dark:bg-green-900/30 dark:text-green-400">
                                Live
                              </span>
                            </div>
                            {project.description ? (
                              <p className="mb-2 text-sm text-gray-500 dark:text-gray-400 line-clamp-1">
                                {project.description}
                              </p>
                            ) : null}
                            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-gray-500 dark:text-gray-400">
                              <span className="font-mono">/read/{authorId}/{project.shortUrl}</span>
                              <span>{publishedCount} published</span>
                              {totalViews > 0 && <span>{totalViews.toLocaleString()} views</span>}
                            </div>
                          </div>
                          <div className="flex items-center gap-2 flex-shrink-0" onClick={(e) => e.preventDefault()}>
                            <button
                              onClick={() => void disablePublishing(project.id)}
                              disabled={actionInProgress === project.id}
                              className="rounded-md px-3 py-1.5 text-sm text-red-600 transition-colors hover:bg-red-50 disabled:opacity-50 dark:text-red-400 dark:hover:bg-red-900/10"
                            >
                              {actionInProgress === project.id ? 'Disabling...' : 'Disable'}
                            </button>
                          </div>
                        </div>
                      </Link>
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
                              onClick={() => void enablePublishing(project.id)}
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
          </div>
        )}
      </div>
    </div>
  )
}
