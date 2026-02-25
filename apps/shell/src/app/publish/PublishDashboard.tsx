'use client'

import { useState, useEffect, useCallback } from 'react'
import Link from 'next/link'
import { SiteNav } from '@/components/SiteNav'
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

interface Chapter {
  id: string
  entityData: {
    title?: string
    type?: string
    order?: number
    status?: string
  }
}

interface ChapterPublication {
  chapterId: string
  publishStatus: string
  publishedAt?: string
  viewCount?: number
}

export function PublishDashboard({ user, apiToken }: { user: User; apiToken: string }) {
  const [projects, setProjects] = useState<Project[]>([])
  const [loading, setLoading] = useState(true)
  const [actionInProgress, setActionInProgress] = useState<string | null>(null)
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null)
  const [expandedProject, setExpandedProject] = useState<string | null>(null)
  const [chapters, setChapters] = useState<Record<string, Chapter[]>>({})
  const [publications, setPublications] = useState<Record<string, Record<string, ChapterPublication>>>({})
  const [slugInputs, setSlugInputs] = useState<Record<string, string>>({})
  const [slugAvailability, setSlugAvailability] = useState<Record<string, boolean | null>>({})
  const [slugChecking, setSlugChecking] = useState<Record<string, boolean>>({})
  const [username, setUsername] = useState<string>('')
  // Always have an author identifier for URLs — username if set, otherwise user ID
  const authorId = username || user.id

  const loadProjects = useCallback(async () => {
    try {
      const res = await fetch(`${config.apiUrl}/api/users/me/projects/grouped?userId=${user.id}`)
      if (res.ok) {
        const data = await res.json()
        const allProjects: Project[] = [
          ...(data.uncategorized || []),
          ...(data.collections || []).flatMap((c: any) => c.projects || []),
        ]
        setProjects(allProjects.filter(p => !p.isArchived))
      }
    } catch (err) {
      console.error('Failed to load projects:', err)
    } finally {
      setLoading(false)
    }
  }, [user.id])

  // Load user profile for default slug generation
  useEffect(() => {
    const loadProfile = async () => {
      try {
        const res = await apiFetch(`/api/users/${user.id}/profile`, apiToken)
        if (res.ok) {
          const data = await res.json()
          setUsername(data.profile?.username || '')
        }
      } catch {}
    }
    loadProfile()
  }, [user.id, apiToken])

  useEffect(() => {
    loadProjects()
  }, [loadProjects])

  const slugify = (text: string) =>
    text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')

  const generateDefaultSlug = (projectName: string) => {
    return slugify(projectName)
  }

  const checkSlugAvailability = async (slug: string) => {
    if (!slug || slug.length < 2) {
      setSlugAvailability(prev => ({ ...prev, [slug]: null }))
      return
    }
    setSlugChecking(prev => ({ ...prev, [slug]: true }))
    try {
      const res = await fetch(`${config.apiUrl}/api/short-urls/check`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ shortUrl: slug, type: 'project' }),
      })
      if (res.ok) {
        const data = await res.json()
        setSlugAvailability(prev => ({ ...prev, [slug]: data.available }))
      }
    } catch {} finally {
      setSlugChecking(prev => ({ ...prev, [slug]: false }))
    }
  }

  const loadChapters = async (projectId: string) => {
    try {
      const res = await apiFetch(
        `/api/collections/content/entities?projectId=${projectId}`,
        apiToken
      )
      if (res.ok) {
        const data = await res.json()
        const chapterList = (data.entities || [])
          .filter((e: Chapter) => e.entityData?.type === 'chapter' || !e.entityData?.type)
          .sort((a: Chapter, b: Chapter) => (a.entityData?.order ?? 0) - (b.entityData?.order ?? 0))
        setChapters(prev => ({ ...prev, [projectId]: chapterList }))
      }
    } catch (err) {
      console.error('Failed to load chapters:', err)
    }

    // Load publication statuses
    try {
      const res = await apiFetch(
        `/api/projects/${projectId}/publications?status=all`,
        apiToken
      )
      if (res.ok) {
        const data = await res.json()
        const pubMap: Record<string, ChapterPublication> = {}
        for (const pub of (data.publications || [])) {
          pubMap[pub.chapterId] = pub
        }
        setPublications(prev => ({ ...prev, [projectId]: pubMap }))
      }
    } catch {
      // Publications endpoint might return empty for new projects
      setPublications(prev => ({ ...prev, [projectId]: {} }))
    }
  }

  const toggleProjectExpansion = (projectId: string) => {
    if (expandedProject === projectId) {
      setExpandedProject(null)
    } else {
      setExpandedProject(projectId)
      if (!chapters[projectId]) {
        loadChapters(projectId)
      }
    }
  }

  const enablePublishing = async (projectId: string) => {
    const project = projects.find(p => p.id === projectId)
    if (!project) return

    setActionInProgress(projectId)
    setMessage(null)
    try {
      const customUrl = slugInputs[projectId] || generateDefaultSlug(project.name)

      // 1. Claim a short URL
      const urlRes = await apiFetch(`/api/projects/${projectId}/short-url`, apiToken, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ customUrl }),
      })

      if (!urlRes.ok) {
        const errData = await urlRes.json().catch(() => ({}))
        throw new Error(errData.error || 'Failed to claim publishing URL')
      }

      // 2. Set publishing mode to live
      await apiFetch(`/api/projects/${projectId}/publish-config`, apiToken, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ publishingMode: 'live', defaultVisibility: 'public' }),
      })

      setMessage({ type: 'success', text: 'Publishing enabled! Now publish your chapters below.' })
      await loadProjects()

      // Auto-expand to show chapters
      setExpandedProject(projectId)
      loadChapters(projectId)
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

  const publishAllChapters = async (projectId: string) => {
    const projectChapters = chapters[projectId]
    if (!projectChapters || projectChapters.length === 0) return

    setActionInProgress(`${projectId}-publish-all`)
    setMessage(null)
    try {
      let successCount = 0
      for (const chapter of projectChapters) {
        try {
          const res = await apiFetch(
            `/api/projects/${projectId}/chapters/${chapter.id}/publish`,
            apiToken,
            {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ publishStatus: 'published' }),
            }
          )
          if (res.ok) successCount++
        } catch {}
      }
      setMessage({
        type: 'success',
        text: `Published ${successCount} of ${projectChapters.length} chapters!`,
      })
      await loadChapters(projectId)
    } catch (err) {
      setMessage({ type: 'error', text: 'Failed to publish chapters' })
    } finally {
      setActionInProgress(null)
    }
  }

  const publishChapter = async (projectId: string, chapterId: string) => {
    setActionInProgress(`${projectId}-${chapterId}`)
    try {
      await apiFetch(
        `/api/projects/${projectId}/chapters/${chapterId}/publish`,
        apiToken,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ publishStatus: 'published' }),
        }
      )
      await loadChapters(projectId)
    } catch (err) {
      setMessage({ type: 'error', text: 'Failed to publish chapter' })
    } finally {
      setActionInProgress(null)
    }
  }

  const unpublishChapter = async (projectId: string, chapterId: string) => {
    setActionInProgress(`${projectId}-${chapterId}`)
    try {
      await apiFetch(
        `/api/projects/${projectId}/chapters/${chapterId}/unpublish`,
        apiToken,
        { method: 'POST' }
      )
      await loadChapters(projectId)
    } catch (err) {
      setMessage({ type: 'error', text: 'Failed to unpublish chapter' })
    } finally {
      setActionInProgress(null)
    }
  }

  const publishedProjects = projects.filter(p => p.shortUrl)
  const draftProjects = projects.filter(p => !p.shortUrl)

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 dark:bg-gray-950">
        <SiteNav />
        <div className="flex items-center justify-center py-32">
          <p className="text-gray-500 dark:text-gray-400">Loading your projects...</p>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-950">
      <SiteNav />

      {/* Header */}
      <header className="bg-white dark:bg-gray-900 border-b border-gray-200 dark:border-gray-800">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 py-6">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="font-display text-2xl font-bold text-gray-900 dark:text-gray-100">
                Publisher Dashboard
              </h1>
              <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
                Manage which projects and chapters are published
              </p>
            </div>
            <Link
              href="/settings/monetization"
              className="text-sm text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300 transition-colors flex items-center gap-1.5"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              Monetization
            </Link>
          </div>
        </div>
      </header>

      <div className="max-w-5xl mx-auto px-4 sm:px-6 py-8">
        {/* Message */}
        {message && (
          <div
            className={`mb-6 p-4 rounded-lg text-sm ${
              message.type === 'success'
                ? 'bg-green-50 dark:bg-green-900/20 text-green-800 dark:text-green-300 border border-green-200 dark:border-green-800'
                : 'bg-red-50 dark:bg-red-900/20 text-red-800 dark:text-red-300 border border-red-200 dark:border-red-800'
            }`}
          >
            {message.text}
          </div>
        )}

        {projects.length === 0 ? (
          <div className="text-center py-16">
            <svg className="w-12 h-12 text-gray-300 dark:text-gray-700 mx-auto mb-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" />
            </svg>
            <p className="text-gray-500 dark:text-gray-400 mb-2">No projects yet</p>
            <p className="text-sm text-gray-400 dark:text-gray-500 mb-4">
              Create a project first, then come back here to publish it.
            </p>
            <Link
              href="/projects/new"
              className="inline-flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 text-sm font-medium transition-colors"
            >
              Create Project
            </Link>
          </div>
        ) : (
          <div className="space-y-8">
            {/* Published Projects */}
            {publishedProjects.length > 0 && (
              <section>
                <h2 className="font-display text-lg font-semibold text-gray-900 dark:text-gray-100 mb-4 flex items-center gap-2">
                  <span className="w-2 h-2 rounded-full bg-green-500" />
                  Published ({publishedProjects.length})
                </h2>
                <div className="space-y-3">
                  {publishedProjects.map(project => {
                    const isExpanded = expandedProject === project.id
                    const projectChapters = chapters[project.id] || []
                    const projectPubs = publications[project.id] || {}
                    const publishedCount = Object.values(projectPubs).filter(
                      p => p.publishStatus === 'published'
                    ).length

                    return (
                      <div
                        key={project.id}
                        className="bg-white dark:bg-gray-900 rounded-lg border border-gray-200 dark:border-gray-800 overflow-hidden"
                      >
                        {/* Project header row */}
                        <div className="p-5">
                          <div className="flex items-start justify-between gap-4">
                            <div className="min-w-0 flex-1">
                              <div className="flex items-center gap-2 mb-1">
                                <h3 className="font-display font-semibold text-gray-900 dark:text-gray-100 truncate">
                                  {project.name}
                                </h3>
                                <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400 flex-shrink-0">
                                  Live
                                </span>
                              </div>
                              {project.description && (
                                <p className="text-sm text-gray-500 dark:text-gray-400 line-clamp-1 mb-2">
                                  {project.description}
                                </p>
                              )}
                              <div className="flex items-center gap-4 text-sm">
                                <div className="flex items-center gap-2">
                                  <span className="text-gray-400 dark:text-gray-500">URL:</span>
                                  <Link
                                    href={`/read/${authorId}/${project.shortUrl}`}
                                    className="text-blue-600 dark:text-blue-400 hover:underline font-mono text-xs"
                                  >
                                    /read/{authorId}/{project.shortUrl}
                                  </Link>
                                </div>
                                <span className="text-gray-300 dark:text-gray-700">|</span>
                                <span className="text-gray-500 dark:text-gray-400 text-xs">
                                  {publishedCount} chapter{publishedCount !== 1 ? 's' : ''} published
                                </span>
                              </div>
                            </div>
                            <div className="flex items-center gap-2 flex-shrink-0">
                              <button
                                onClick={() => toggleProjectExpansion(project.id)}
                                className="px-3 py-1.5 text-sm bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300 rounded-md hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors flex items-center gap-1.5"
                              >
                                <svg
                                  className={`w-3.5 h-3.5 transition-transform ${isExpanded ? 'rotate-180' : ''}`}
                                  fill="none" stroke="currentColor" viewBox="0 0 24 24"
                                >
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                                </svg>
                                Chapters
                              </button>
                              <Link
                                href={`/projects/${project.id}`}
                                className="px-3 py-1.5 text-sm bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300 rounded-md hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors"
                              >
                                Edit
                              </Link>
                              <button
                                onClick={() => disablePublishing(project.id)}
                                disabled={actionInProgress === project.id}
                                className="px-3 py-1.5 text-sm text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/10 rounded-md transition-colors disabled:opacity-50"
                              >
                                {actionInProgress === project.id ? 'Unpublishing...' : 'Unpublish'}
                              </button>
                            </div>
                          </div>
                        </div>

                        {/* Expanded chapter list */}
                        {isExpanded && (
                          <div className="border-t border-gray-100 dark:border-gray-800">
                            {/* Chapter controls */}
                            <div className="px-5 py-3 bg-gray-50 dark:bg-gray-800/50 flex items-center justify-between">
                              <span className="text-sm font-medium text-gray-700 dark:text-gray-300">
                                Chapters ({projectChapters.length})
                              </span>
                              <div className="flex items-center gap-2">
                                <button
                                  onClick={() => publishAllChapters(project.id)}
                                  disabled={actionInProgress?.startsWith(project.id) || projectChapters.length === 0}
                                  className="px-3 py-1.5 text-xs bg-green-600 text-white rounded-md hover:bg-green-700 transition-colors disabled:opacity-50 font-medium"
                                >
                                  {actionInProgress === `${project.id}-publish-all`
                                    ? 'Publishing...'
                                    : 'Publish All Chapters'}
                                </button>
                              </div>
                            </div>

                            {/* Chapter list */}
                            {projectChapters.length === 0 ? (
                              <div className="px-5 py-8 text-center">
                                <p className="text-sm text-gray-400 dark:text-gray-500">
                                  No chapters yet. Open the project editor to start writing.
                                </p>
                                <Link
                                  href={`/projects/${project.id}`}
                                  className="inline-block mt-2 text-sm text-blue-600 dark:text-blue-400 hover:underline"
                                >
                                  Open Editor
                                </Link>
                              </div>
                            ) : (
                              <div className="divide-y divide-gray-100 dark:divide-gray-800">
                                {projectChapters.map((chapter, idx) => {
                                  const pub = projectPubs[chapter.id]
                                  const isPublished = pub?.publishStatus === 'published'
                                  const chapterTitle = chapter.entityData?.title || `Chapter ${idx + 1}`
                                  const isChapterLoading = actionInProgress === `${project.id}-${chapter.id}`

                                  return (
                                    <div
                                      key={chapter.id}
                                      className="px-5 py-3 flex items-center justify-between gap-3"
                                    >
                                      <div className="flex items-center gap-3 min-w-0">
                                        <span className="text-xs text-gray-400 dark:text-gray-500 w-6 text-right flex-shrink-0">
                                          {idx + 1}
                                        </span>
                                        <span className="text-sm text-gray-900 dark:text-gray-100 truncate">
                                          {chapterTitle}
                                        </span>
                                        {isPublished && (
                                          <span className="flex-shrink-0 w-1.5 h-1.5 rounded-full bg-green-500" title="Published" />
                                        )}
                                      </div>
                                      <div className="flex items-center gap-2 flex-shrink-0">
                                        {pub?.publishedAt && (
                                          <span className="text-xs text-gray-400 dark:text-gray-500">
                                            {new Date(pub.publishedAt).toLocaleDateString()}
                                          </span>
                                        )}
                                        {isPublished ? (
                                          <button
                                            onClick={() => unpublishChapter(project.id, chapter.id)}
                                            disabled={isChapterLoading}
                                            className="px-2.5 py-1 text-xs text-amber-700 dark:text-amber-400 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded hover:bg-amber-100 dark:hover:bg-amber-900/30 transition-colors disabled:opacity-50"
                                          >
                                            {isChapterLoading ? '...' : 'Unpublish'}
                                          </button>
                                        ) : (
                                          <button
                                            onClick={() => publishChapter(project.id, chapter.id)}
                                            disabled={isChapterLoading}
                                            className="px-2.5 py-1 text-xs text-green-700 dark:text-green-400 bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded hover:bg-green-100 dark:hover:bg-green-900/30 transition-colors disabled:opacity-50"
                                          >
                                            {isChapterLoading ? '...' : 'Publish'}
                                          </button>
                                        )}
                                      </div>
                                    </div>
                                  )
                                })}
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    )
                  })}
                </div>
              </section>
            )}

            {/* Draft Projects */}
            {draftProjects.length > 0 && (
              <section>
                <h2 className="font-display text-lg font-semibold text-gray-900 dark:text-gray-100 mb-4 flex items-center gap-2">
                  <span className="w-2 h-2 rounded-full bg-gray-400 dark:bg-gray-600" />
                  Not Published ({draftProjects.length})
                </h2>
                <div className="space-y-3">
                  {draftProjects.map(project => {
                    const currentSlug = slugInputs[project.id] ?? generateDefaultSlug(project.name)
                    const availability = slugAvailability[currentSlug]
                    const checking = slugChecking[currentSlug]

                    return (
                      <div
                        key={project.id}
                        className="bg-white dark:bg-gray-900 rounded-lg border border-gray-200 dark:border-gray-800 p-5"
                      >
                        <div className="flex items-start justify-between gap-4">
                          <div className="min-w-0 flex-1">
                            <h3 className="font-display font-semibold text-gray-900 dark:text-gray-100 truncate mb-1">
                              {project.name}
                            </h3>
                            {project.description && (
                              <p className="text-sm text-gray-500 dark:text-gray-400 line-clamp-1 mb-3">
                                {project.description}
                              </p>
                            )}
                            {/* Slug picker */}
                            <div className="flex items-center gap-2">
                              <span className="text-xs text-gray-400 dark:text-gray-500 flex-shrink-0 font-mono">/read/{authorId}/</span>
                              <input
                                type="text"
                                value={currentSlug}
                                onChange={e => {
                                  const val = slugify(e.target.value)
                                  setSlugInputs(prev => ({ ...prev, [project.id]: val }))
                                }}
                                onBlur={() => checkSlugAvailability(currentSlug)}
                                placeholder={generateDefaultSlug(project.name)}
                                className="flex-1 max-w-xs px-2.5 py-1.5 text-xs font-mono border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 text-gray-900 dark:text-gray-100 rounded focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                              />
                              {checking && (
                                <span className="text-xs text-gray-400">checking...</span>
                              )}
                              {!checking && availability === true && (
                                <span className="text-xs text-green-600 dark:text-green-400">available</span>
                              )}
                              {!checking && availability === false && (
                                <span className="text-xs text-red-600 dark:text-red-400">taken</span>
                              )}
                            </div>
                          </div>
                          <div className="flex items-center gap-2 flex-shrink-0">
                            <Link
                              href={`/projects/${project.id}`}
                              className="px-3 py-1.5 text-sm bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300 rounded-md hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors"
                            >
                              Edit
                            </Link>
                            <button
                              onClick={() => enablePublishing(project.id)}
                              disabled={actionInProgress === project.id || availability === false}
                              className="px-3 py-1.5 text-sm bg-blue-600 text-white rounded-md hover:bg-blue-700 transition-colors disabled:opacity-50 font-medium"
                            >
                              {actionInProgress === project.id ? 'Publishing...' : 'Publish'}
                            </button>
                          </div>
                        </div>
                      </div>
                    )
                  })}
                </div>
              </section>
            )}

            {/* Help section */}
            <section className="bg-blue-50/50 dark:bg-blue-950/10 border border-blue-100 dark:border-blue-900/30 rounded-lg p-6">
              <h3 className="font-display font-semibold text-gray-900 dark:text-gray-100 mb-2">
                How publishing works
              </h3>
              <ul className="space-y-2 text-sm text-gray-600 dark:text-gray-400">
                <li className="flex items-start gap-2">
                  <span className="text-blue-500 mt-0.5">1.</span>
                  <span><strong>Choose a slug</strong> for your public URL (e.g. /read/your-name/my-story) and click Publish.</span>
                </li>
                <li className="flex items-start gap-2">
                  <span className="text-blue-500 mt-0.5">2.</span>
                  <span><strong>Publish your chapters</strong> using "Publish All Chapters" or toggle individual chapters on/off.</span>
                </li>
                <li className="flex items-start gap-2">
                  <span className="text-blue-500 mt-0.5">3.</span>
                  <span><strong>Exclude chapters</strong> like brainstorm notes by clicking "Do Not Publish" on any chapter.</span>
                </li>
                <li className="flex items-start gap-2">
                  <span className="text-blue-500 mt-0.5">4.</span>
                  <span><strong>Optionally set up monetization</strong> with subscription tiers if you want to offer paid content.</span>
                </li>
              </ul>
              <div className="mt-4 flex items-center gap-4">
                <Link
                  href="/settings/monetization"
                  className="text-sm text-blue-600 dark:text-blue-400 hover:underline"
                >
                  Set up monetization
                </Link>
              </div>
            </section>
          </div>
        )}
      </div>
    </div>
  )
}
