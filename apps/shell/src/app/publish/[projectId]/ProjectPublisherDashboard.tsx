'use client'

import { useState, useEffect, useCallback } from 'react'
import Link from 'next/link'
import { SiteNav } from '@/components/SiteNav'
import { SkeletonList } from '@/components/LoadingState'
import { apiFetch } from '@/lib/api'
import { BobbinrySDK } from '@bobbinry/sdk'
import PublishManagerPanel from '@bobbinry/web-publisher/panels/publish-manager'
import ReleaseConfig from '@bobbinry/web-publisher/views/release-config'
import { ChapterReleaseTable } from './components/ChapterReleaseTable'

interface User {
  id: string
  email: string
  name?: string | null
}

interface ProjectInfo {
  id: string
  name: string
  description: string | null
  shortUrl: string | null
  isArchived: boolean
}

interface PublishConfig {
  autoReleaseEnabled: boolean
  releaseFrequency: string
  defaultVisibility: string
  enableComments: boolean
  enableReactions: boolean
  enableAnnotations: boolean
  annotationAccess: string
}

export function ProjectPublisherDashboard({
  user,
  apiToken,
  projectId,
}: {
  user: User
  apiToken: string
  projectId: string
}) {
  const [project, setProject] = useState<ProjectInfo | null>(null)
  const [username, setUsername] = useState('')
  const [publishConfig, setPublishConfig] = useState<PublishConfig | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [refreshKey, setRefreshKey] = useState(0)
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null)

  const [sdk] = useState(() => {
    const instance = new BobbinrySDK('web-publisher')
    instance.setProject(projectId)
    instance.api.setAuthToken(apiToken)
    return instance
  })

  const authorId = username || user.id
  const readerBaseUrl = project?.shortUrl ? `/read/${authorId}/${project.shortUrl}` : null
  const isLive = !!project?.shortUrl

  const loadData = useCallback(async () => {
    try {
      setError(null)
      const [projectRes, profileRes, configRes] = await Promise.all([
        apiFetch(`/api/projects/${projectId}`, apiToken),
        apiFetch(`/api/users/${user.id}/profile`, apiToken),
        apiFetch(`/api/projects/${projectId}/publish-config`, apiToken),
      ])

      if (!projectRes.ok) {
        setError('Project not found or you do not have access.')
        setLoading(false)
        return
      }

      const projectData = await projectRes.json()
      setProject(projectData.project)

      if (profileRes.ok) {
        const profileData = await profileRes.json()
        setUsername(profileData.profile?.username || '')
      }

      if (configRes.ok) {
        const configData = await configRes.json()
        setPublishConfig(configData.config || null)
      }
    } catch (err) {
      console.error('Failed to load publisher data:', err)
      setError('Failed to load publisher data.')
    } finally {
      setLoading(false)
    }
  }, [projectId, apiToken, user.id])

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- initial fetch
    void loadData()
  }, [loadData])

  const triggerRefresh = () => {
    setRefreshKey((k) => k + 1)
    void loadData()
  }

  const updateVisibility = async (visibility: string) => {
    try {
      await apiFetch(`/api/projects/${projectId}/publish-config`, apiToken, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ defaultVisibility: visibility }),
      })
      setPublishConfig((c) => c ? { ...c, defaultVisibility: visibility } : c)
    } catch {
      setMessage({ type: 'error', text: 'Failed to update visibility.' })
    }
  }

  const updateReaderExperience = async (field: string, value: boolean | string) => {
    try {
      await apiFetch(`/api/projects/${projectId}/publish-config`, apiToken, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ [field]: value }),
      })
      setPublishConfig((c) => c ? { ...c, [field]: value } as PublishConfig : c)
    } catch {
      setMessage({ type: 'error', text: 'Failed to update reader experience.' })
    }
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 dark:bg-gray-950">
        <SiteNav />
        <header className="border-b border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-800">
          <div className="mx-auto max-w-6xl px-4 py-6 sm:px-6 animate-pulse">
            <div className="mb-2 h-4 w-32 rounded bg-gray-100 dark:bg-gray-700" />
            <div className="h-7 w-48 rounded bg-gray-100 dark:bg-gray-700" />
          </div>
        </header>
        <div className="mx-auto max-w-6xl px-4 py-8 sm:px-6">
          <SkeletonList count={3} />
        </div>
      </div>
    )
  }

  if (error || !project) {
    return (
      <div className="min-h-screen bg-gray-50 dark:bg-gray-950">
        <SiteNav />
        <div className="mx-auto max-w-6xl px-4 py-16 sm:px-6 text-center">
          <p className="text-gray-600 dark:text-gray-400 mb-4">{error || 'Project not found.'}</p>
          <Link href="/publish" className="text-blue-600 hover:underline dark:text-blue-400">
            Back to Publisher
          </Link>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-950">
      <SiteNav />

      {/* Header */}
      <header className="border-b border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-800">
        <div className="mx-auto max-w-6xl px-4 py-6 sm:px-6">
          <div className="flex items-center gap-2 text-sm text-gray-500 dark:text-gray-400 mb-2">
            <Link href="/publish" className="hover:text-gray-700 dark:hover:text-gray-300 transition-colors">
              Publisher
            </Link>
            <span>/</span>
            <span className="text-gray-900 dark:text-gray-100">{project.name}</span>
          </div>
          <div className="flex items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <h1 className="font-display text-2xl font-bold text-gray-900 dark:text-gray-100">
                {project.name}
              </h1>
              {isLive ? (
                <span className="inline-flex items-center rounded-full bg-green-100 px-2.5 py-1 text-xs font-medium text-green-700 dark:bg-green-900/30 dark:text-green-400">
                  Live
                </span>
              ) : (
                <span className="inline-flex items-center rounded-full bg-gray-100 px-2.5 py-1 text-xs font-medium text-gray-600 dark:bg-gray-700 dark:text-gray-300">
                  Not live
                </span>
              )}
            </div>
            <div className="flex items-center gap-3">
              {readerBaseUrl && (
                <Link
                  href={readerBaseUrl}
                  target="_blank"
                  className="flex items-center gap-1.5 text-sm text-gray-500 transition-colors hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-300"
                >
                  <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                  </svg>
                  View Reader
                </Link>
              )}
              <Link
                href={`/projects/${projectId}`}
                className="flex items-center gap-1.5 text-sm text-gray-500 transition-colors hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-300"
              >
                <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                </svg>
                Project Dashboard
              </Link>
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
          {readerBaseUrl && (
            <p className="mt-2 font-mono text-xs text-gray-400 dark:text-gray-500">
              {readerBaseUrl}
            </p>
          )}
        </div>
      </header>

      <div className="mx-auto max-w-6xl px-4 py-8 sm:px-6">
        {message && (
          <div className={`mb-6 rounded-lg border p-4 text-sm ${
            message.type === 'success'
              ? 'border-green-200 bg-green-50 text-green-800 dark:border-green-800 dark:bg-green-900/20 dark:text-green-300'
              : 'border-red-200 bg-red-50 text-red-800 dark:border-red-800 dark:bg-red-900/20 dark:text-red-300'
          }`}>
            {message.text}
          </div>
        )}

        {!isLive ? (
          <SetupPublishing
            projectId={projectId}
            projectName={project.name}
            apiToken={apiToken}
            authorId={authorId}
            onEnabled={() => {
              void loadData()
            }}
          />
        ) : (
          <div className="grid gap-6 xl:grid-cols-[minmax(0,1.4fr)_360px]">
            {/* Left column: stats + chapters */}
            <div className="space-y-6">
              <section className="overflow-hidden rounded-xl border border-gray-200 bg-white dark:border-gray-800 dark:bg-gray-900">
                <div className="border-b border-gray-100 px-5 py-4 dark:border-gray-800">
                  <h3 className="font-display text-base font-semibold text-gray-900 dark:text-gray-100">
                    Publishing overview
                  </h3>
                </div>
                <PublishManagerPanel
                  projectId={projectId}
                  apiToken={apiToken}
                  refreshKey={refreshKey}
                  mode="overview"
                />
              </section>

              <section className="overflow-hidden rounded-xl border border-gray-200 bg-white dark:border-gray-800 dark:bg-gray-900">
                <ChapterReleaseTable
                  projectId={projectId}
                  apiToken={apiToken}
                  readerBaseUrl={readerBaseUrl}
                  autoReleaseEnabled={publishConfig?.autoReleaseEnabled ?? false}
                  refreshKey={refreshKey}
                  onRefresh={triggerRefresh}
                />
              </section>
            </div>

            {/* Right column: settings */}
            <div className="space-y-6">
              <section className="overflow-hidden rounded-xl border border-gray-200 bg-white dark:border-gray-800 dark:bg-gray-900">
                <ReleaseConfig sdk={sdk} projectId={projectId} />
              </section>

              <section className="overflow-hidden rounded-xl border border-gray-200 bg-white dark:border-gray-800 dark:bg-gray-900 p-5">
                <h3 className="font-display text-sm font-semibold text-gray-900 dark:text-gray-100 mb-4">
                  Reader Experience
                </h3>
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-gray-700 dark:text-gray-300">Visibility</span>
                    <select
                      value={publishConfig?.defaultVisibility || 'public'}
                      onChange={(e) => void updateVisibility(e.target.value)}
                      className="rounded-md border border-gray-200 bg-white px-2.5 py-1.5 text-xs text-gray-700 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-300"
                    >
                      <option value="public">Public</option>
                      <option value="subscribers_only">Subscribers Only</option>
                    </select>
                  </div>
                  <label className="flex items-center justify-between cursor-pointer">
                    <span className="text-sm text-gray-700 dark:text-gray-300">Comments</span>
                    <input
                      type="checkbox"
                      checked={publishConfig?.enableComments ?? true}
                      onChange={(e) => void updateReaderExperience('enableComments', e.target.checked)}
                      className="rounded border-gray-300 dark:border-gray-600"
                    />
                  </label>
                  <label className="flex items-center justify-between cursor-pointer">
                    <span className="text-sm text-gray-700 dark:text-gray-300">Reactions</span>
                    <input
                      type="checkbox"
                      checked={publishConfig?.enableReactions ?? true}
                      onChange={(e) => void updateReaderExperience('enableReactions', e.target.checked)}
                      className="rounded border-gray-300 dark:border-gray-600"
                    />
                  </label>
                  <label className="flex items-center justify-between cursor-pointer">
                    <span className="text-sm text-gray-700 dark:text-gray-300">Feedback</span>
                    <input
                      type="checkbox"
                      checked={publishConfig?.enableAnnotations ?? false}
                      onChange={(e) => void updateReaderExperience('enableAnnotations', e.target.checked)}
                      className="rounded border-gray-300 dark:border-gray-600"
                    />
                  </label>
                  {publishConfig?.enableAnnotations && (
                    <div className="flex items-center justify-between pl-4">
                      <span className="text-xs text-gray-500 dark:text-gray-400">Who can give feedback</span>
                      <select
                        value={publishConfig?.annotationAccess || 'beta_only'}
                        onChange={(e) => void updateReaderExperience('annotationAccess', e.target.value)}
                        className="rounded-md border border-gray-200 bg-white px-2.5 py-1.5 text-xs text-gray-700 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-300"
                      >
                        <option value="beta_only">Beta readers only</option>
                        <option value="subscribers">Subscribers</option>
                        <option value="all_authenticated">All signed-in readers</option>
                      </select>
                    </div>
                  )}
                </div>
              </section>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

/* ── Setup Publishing (for projects not yet live) ── */

function SetupPublishing({
  projectId,
  projectName,
  apiToken,
  authorId,
  onEnabled,
}: {
  projectId: string
  projectName: string
  apiToken: string
  authorId: string
  onEnabled: () => void
}) {
  const [slug, setSlug] = useState(() =>
    projectName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
  )
  const [availability, setAvailability] = useState<boolean | null>(null)
  const [checking, setChecking] = useState(false)
  const [enabling, setEnabling] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const slugify = (text: string) =>
    text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')

  const checkAvailability = async (s: string) => {
    if (!s || s.length < 2) {
      setAvailability(null)
      return
    }
    setChecking(true)
    try {
      const res = await apiFetch('/api/short-urls/check', '', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ shortUrl: s, type: 'project' }),
      })
      if (res.ok) {
        const data = await res.json()
        setAvailability(data.available)
      }
    } catch {
      // ignore
    } finally {
      setChecking(false)
    }
  }

  const enable = async () => {
    setEnabling(true)
    setError(null)
    try {
      const urlRes = await apiFetch(`/api/projects/${projectId}/short-url`, apiToken, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ customUrl: slug }),
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
      onEnabled()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to enable publishing')
    } finally {
      setEnabling(false)
    }
  }

  return (
    <div className="mx-auto max-w-lg">
      <div className="rounded-xl border border-gray-200 bg-white p-8 dark:border-gray-800 dark:bg-gray-900">
        <h2 className="font-display text-xl font-semibold text-gray-900 dark:text-gray-100 mb-2">
          Set up publishing
        </h2>
        <p className="text-sm text-gray-500 dark:text-gray-400 mb-6">
          Claim a reader URL to start publishing chapters from this project.
        </p>

        {error && (
          <div className="mb-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800 dark:border-red-800 dark:bg-red-900/20 dark:text-red-300">
            {error}
          </div>
        )}

        <div className="mb-6">
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
            Reader URL
          </label>
          <div className="flex items-center gap-2">
            <span className="flex-shrink-0 font-mono text-xs text-gray-400 dark:text-gray-500">
              /read/{authorId}/
            </span>
            <input
              type="text"
              value={slug}
              onChange={(e) => {
                const next = slugify(e.target.value)
                setSlug(next)
              }}
              onBlur={() => void checkAvailability(slug)}
              className="max-w-xs flex-1 rounded border border-gray-200 bg-gray-50 px-2.5 py-1.5 font-mono text-xs text-gray-900 focus:border-transparent focus:ring-2 focus:ring-blue-500 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100"
            />
            {checking && <span className="text-xs text-gray-400">checking...</span>}
            {!checking && availability === true && (
              <span className="text-xs text-green-600 dark:text-green-400">available</span>
            )}
            {!checking && availability === false && (
              <span className="text-xs text-red-600 dark:text-red-400">taken</span>
            )}
          </div>
        </div>

        <button
          onClick={() => void enable()}
          disabled={enabling || availability === false}
          className="rounded-lg bg-blue-600 px-5 py-2.5 text-sm font-medium text-white transition-colors hover:bg-blue-700 disabled:opacity-50"
        >
          {enabling ? 'Enabling...' : 'Enable publishing'}
        </button>
      </div>
    </div>
  )
}
