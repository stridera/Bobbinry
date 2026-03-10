'use client'

import { useState, useEffect, useCallback, Suspense } from 'react'
import { useSession } from 'next-auth/react'
import { useSearchParams } from 'next/navigation'
import Link from 'next/link'
import { SiteNav } from '@/components/SiteNav'
import { SkeletonList } from '@/components/LoadingState'
import { EmptyState } from '@/components/EmptyState'
import { apiFetch } from '@/lib/api'

interface BackupProject {
  id: string
  name: string
  isBackedUp: boolean
  lastSyncedAt: string | null
  lastSyncStatus: string | null
  lastSyncError: string | null
  chapterCount: number
}

interface BackupStatus {
  connection: {
    connected: boolean
    provider?: string
    driveEmail?: string | null
    rootFolderName?: string | null
  }
  projects: BackupProject[]
}

export default function BackupsPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen bg-gray-50 dark:bg-gray-950">
          <SiteNav />
          <header className="bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700">
            <div className="max-w-5xl mx-auto px-4 sm:px-6 py-6 animate-pulse">
              <div className="h-7 bg-gray-100 dark:bg-gray-700 rounded w-32 mb-2" />
              <div className="h-4 bg-gray-100 dark:bg-gray-700 rounded w-64" />
            </div>
          </header>
          <div className="max-w-5xl mx-auto px-4 sm:px-6 py-8">
            <SkeletonList count={3} />
          </div>
        </div>
      }
    >
      <BackupsContent />
    </Suspense>
  )
}

function BackupsContent() {
  const { data: session } = useSession()
  const searchParams = useSearchParams()
  const apiToken = (session as any)?.apiToken as string | undefined

  const [status, setStatus] = useState<BackupStatus | null>(null)
  const [loading, setLoading] = useState(true)
  const [actionInProgress, setActionInProgress] = useState<string | null>(null)
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null)
  const [disconnecting, setDisconnecting] = useState(false)

  // Show OAuth result message from URL params
  useEffect(() => {
    const driveParam = searchParams.get('drive')
    if (driveParam === 'connected') {
      setMessage({ type: 'success', text: 'Google Drive connected successfully! Your projects will now be backed up automatically.' })
    } else if (driveParam === 'denied') {
      setMessage({ type: 'error', text: 'Google Drive authorization was denied.' })
    } else if (driveParam === 'error') {
      setMessage({ type: 'error', text: 'Failed to connect Google Drive. Please try again.' })
    }
  }, [searchParams])

  const loadStatus = useCallback(async () => {
    if (!apiToken) return
    try {
      const res = await apiFetch('/api/backups/status', apiToken)
      if (res.ok) {
        setStatus(await res.json())
      }
    } catch (err) {
      console.error('Failed to load backup status:', err)
    } finally {
      setLoading(false)
    }
  }, [apiToken])

  useEffect(() => {
    if (apiToken) loadStatus()
  }, [apiToken, loadStatus])

  const handleConnect = async () => {
    if (!apiToken) return
    try {
      const res = await apiFetch('/api/backups/google-drive/authorize', apiToken)
      if (res.ok) {
        const { url } = await res.json()
        window.location.href = url
      } else {
        const data = await res.json().catch(() => ({}))
        setMessage({ type: 'error', text: data.error || 'Failed to start authorization' })
      }
    } catch {
      setMessage({ type: 'error', text: 'Failed to connect to server' })
    }
  }

  const handleDisconnect = async () => {
    if (!apiToken) return
    setDisconnecting(true)
    try {
      await apiFetch('/api/backups/google-drive/disconnect', apiToken, { method: 'DELETE' })
      setStatus({ connection: { connected: false }, projects: [] })
      setMessage({ type: 'success', text: 'Google Drive disconnected.' })
    } catch {
      setMessage({ type: 'error', text: 'Failed to disconnect' })
    } finally {
      setDisconnecting(false)
    }
  }

  const handleSyncAll = async () => {
    if (!apiToken) return
    setActionInProgress('sync-all')
    setMessage(null)
    try {
      const res = await apiFetch('/api/backups/sync', apiToken, { method: 'POST' })
      if (res.ok) {
        const data = await res.json()
        setMessage({
          type: 'success',
          text: `Synced ${data.succeeded} chapters across ${data.projects} projects.`,
        })
        await loadStatus()
      } else {
        const err = await res.json().catch(() => ({}))
        setMessage({ type: 'error', text: err.error || 'Sync failed' })
      }
    } catch {
      setMessage({ type: 'error', text: 'Failed to sync' })
    } finally {
      setActionInProgress(null)
    }
  }

  const handleSyncProject = async (projectId: string) => {
    if (!apiToken) return
    setActionInProgress(projectId)
    setMessage(null)
    try {
      const res = await apiFetch(`/api/backups/projects/${projectId}/sync`, apiToken, {
        method: 'POST',
      })
      if (res.ok) {
        const data = await res.json()
        setMessage({
          type: 'success',
          text: `Synced ${data.succeeded} of ${data.total} chapters.`,
        })
        await loadStatus()
      } else {
        const err = await res.json().catch(() => ({}))
        setMessage({ type: 'error', text: err.error || 'Sync failed' })
      }
    } catch {
      setMessage({ type: 'error', text: 'Failed to sync project' })
    } finally {
      setActionInProgress(null)
    }
  }

  const handleToggleProject = async (projectId: string, isActive: boolean) => {
    if (!apiToken) return
    setActionInProgress(`toggle-${projectId}`)
    try {
      await apiFetch(`/api/backups/projects/${projectId}`, apiToken, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ isActive }),
      })
      await loadStatus()
    } catch {
      setMessage({ type: 'error', text: 'Failed to update backup setting' })
    } finally {
      setActionInProgress(null)
    }
  }

  const connected = status?.connection?.connected

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 dark:bg-gray-950">
        <SiteNav />
        <header className="bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700">
          <div className="max-w-5xl mx-auto px-4 sm:px-6 py-6 animate-pulse">
            <div className="h-7 bg-gray-100 dark:bg-gray-700 rounded w-32 mb-2" />
            <div className="h-4 bg-gray-100 dark:bg-gray-700 rounded w-64" />
          </div>
        </header>
        <div className="max-w-5xl mx-auto px-4 sm:px-6 py-8">
          <SkeletonList count={3} />
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-950">
      <SiteNav />

      {/* Header */}
      <header className="bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 py-6">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="font-display text-2xl font-bold text-gray-900 dark:text-gray-100">
                Backups
              </h1>
              <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
                Manage cloud backup for all your projects
              </p>
            </div>
            {connected && (
              <button
                onClick={handleSyncAll}
                disabled={actionInProgress === 'sync-all'}
                className="px-4 py-2 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors disabled:opacity-50 font-medium flex items-center gap-2"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                </svg>
                {actionInProgress === 'sync-all' ? 'Syncing...' : 'Sync All'}
              </button>
            )}
          </div>
        </div>
      </header>

      <div className="max-w-5xl mx-auto px-4 sm:px-6 py-8 space-y-6">
        {/* Message */}
        {message && (
          <div
            className={`p-4 rounded-lg text-sm ${
              message.type === 'success'
                ? 'bg-green-50 dark:bg-green-900/20 text-green-800 dark:text-green-300 border border-green-200 dark:border-green-800'
                : 'bg-red-50 dark:bg-red-900/20 text-red-800 dark:text-red-300 border border-red-200 dark:border-red-800'
            }`}
          >
            {message.text}
          </div>
        )}

        {/* Connection Card */}
        <section className="bg-white dark:bg-gray-900 rounded-lg border border-gray-200 dark:border-gray-800 overflow-hidden">
          <div className="p-5">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                {/* Google Drive icon */}
                <div className="w-10 h-10 rounded-lg bg-yellow-50 dark:bg-yellow-900/20 flex items-center justify-center flex-shrink-0">
                  <svg className="w-5 h-5 text-yellow-600 dark:text-yellow-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
                  </svg>
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <h3 className="font-display font-semibold text-gray-900 dark:text-gray-100">
                      Google Drive
                    </h3>
                    {connected && (
                      <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400">
                        Connected
                      </span>
                    )}
                  </div>
                  {connected ? (
                    <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">
                      {status?.connection?.driveEmail && (
                        <span>{status.connection.driveEmail}</span>
                      )}
                      {status?.connection?.driveEmail && status?.connection?.rootFolderName && (
                        <span className="text-gray-300 dark:text-gray-600 mx-1.5">·</span>
                      )}
                      {status?.connection?.rootFolderName && (
                        <span>Folder: {status.connection.rootFolderName}</span>
                      )}
                    </p>
                  ) : (
                    <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">
                      Automatically sync all your projects to Google Drive
                    </p>
                  )}
                </div>
              </div>
              <div>
                {connected ? (
                  <button
                    onClick={handleDisconnect}
                    disabled={disconnecting}
                    className="px-3 py-1.5 text-sm text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/10 rounded-md transition-colors disabled:opacity-50"
                  >
                    {disconnecting ? 'Disconnecting...' : 'Disconnect'}
                  </button>
                ) : (
                  <button
                    onClick={handleConnect}
                    className="px-4 py-2 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors font-medium"
                  >
                    Connect Google Drive
                  </button>
                )}
              </div>
            </div>
          </div>
        </section>

        {/* Project List */}
        {!connected ? (
          <EmptyState
            icon={
              <svg className="w-12 h-12 text-gray-300 dark:text-gray-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
              </svg>
            }
            title="No backup service connected"
            description="Connect Google Drive to automatically back up all your projects. Set up once, and every project is covered."
            action={{ label: 'Connect Google Drive', onClick: handleConnect }}
          />
        ) : status?.projects && status.projects.length > 0 ? (
          <section>
            <h2 className="font-display text-lg font-semibold text-gray-900 dark:text-gray-100 mb-4 flex items-center gap-2">
              Projects ({status.projects.length})
            </h2>
            <div className="bg-white dark:bg-gray-900 rounded-lg border border-gray-200 dark:border-gray-800 overflow-hidden divide-y divide-gray-100 dark:divide-gray-800">
              {status.projects.map(project => {
                const isSyncing = actionInProgress === project.id
                const isToggling = actionInProgress === `toggle-${project.id}`

                return (
                  <div
                    key={project.id}
                    className="px-5 py-4 flex items-center justify-between gap-4"
                  >
                    <div className="flex items-center gap-3 min-w-0 flex-1">
                      {/* Status dot */}
                      <StatusDot status={project.lastSyncStatus} isActive={project.isBackedUp} />

                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <Link
                            href={`/projects/${project.id}`}
                            className="text-sm font-medium text-gray-900 dark:text-gray-100 truncate hover:text-blue-600 dark:hover:text-blue-400 transition-colors"
                          >
                            {project.name}
                          </Link>
                          <span className="text-xs text-gray-400 dark:text-gray-500 flex-shrink-0">
                            {project.chapterCount} chapter{project.chapterCount !== 1 ? 's' : ''}
                          </span>
                        </div>
                        {project.lastSyncedAt && (
                          <p className="text-xs text-gray-400 dark:text-gray-500 mt-0.5">
                            Last sync: {new Date(project.lastSyncedAt).toLocaleString()}
                          </p>
                        )}
                        {project.lastSyncError && project.lastSyncStatus === 'failed' && (
                          <p className="text-xs text-red-500 dark:text-red-400 mt-0.5">
                            {project.lastSyncError}
                          </p>
                        )}
                      </div>
                    </div>

                    <div className="flex items-center gap-2 flex-shrink-0">
                      {project.isBackedUp && (
                        <button
                          onClick={() => handleSyncProject(project.id)}
                          disabled={isSyncing || !!actionInProgress}
                          className="px-2.5 py-1 text-xs font-medium text-blue-700 dark:text-blue-400 bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded hover:bg-blue-100 dark:hover:bg-blue-900/30 transition-colors disabled:opacity-50"
                        >
                          {isSyncing ? 'Syncing...' : 'Sync Now'}
                        </button>
                      )}

                      {/* Toggle */}
                      <button
                        onClick={() => handleToggleProject(project.id, !project.isBackedUp)}
                        disabled={isToggling || !!actionInProgress}
                        className="relative w-9 h-5 rounded-full transition-colors disabled:opacity-50 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 dark:focus:ring-offset-gray-900"
                        style={{
                          backgroundColor: project.isBackedUp
                            ? 'rgb(34, 197, 94)'
                            : 'rgb(209, 213, 219)',
                        }}
                        title={project.isBackedUp ? 'Disable backup' : 'Enable backup'}
                      >
                        <span
                          className={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform ${
                            project.isBackedUp ? 'translate-x-4' : 'translate-x-0'
                          }`}
                        />
                      </button>
                    </div>
                  </div>
                )
              })}
            </div>
          </section>
        ) : (
          <EmptyState
            icon={
              <svg className="w-12 h-12 text-gray-300 dark:text-gray-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" />
              </svg>
            }
            title="No projects yet"
            description="Create a project first, then come back here to manage backups."
            action={{ label: 'Create Project', href: '/projects/new' }}
          />
        )}

        {/* Info section */}
        {connected && (
          <section className="bg-blue-50/50 dark:bg-blue-950/10 border border-blue-100 dark:border-blue-900/30 rounded-lg p-6">
            <h3 className="font-display font-semibold text-gray-900 dark:text-gray-100 mb-2">
              How backups work
            </h3>
            <ul className="space-y-2 text-sm text-gray-600 dark:text-gray-400">
              <li className="flex items-start gap-2">
                <span className="text-blue-500 mt-0.5">1.</span>
                <span><strong>Automatic sync</strong> — when you edit a chapter, it syncs to Drive after 5 minutes of inactivity.</span>
              </li>
              <li className="flex items-start gap-2">
                <span className="text-blue-500 mt-0.5">2.</span>
                <span><strong>Per-project folders</strong> — each project gets its own subfolder under "Bobbinry Backup" in your Drive.</span>
              </li>
              <li className="flex items-start gap-2">
                <span className="text-blue-500 mt-0.5">3.</span>
                <span><strong>Opt out</strong> any project by toggling its switch off. You can re-enable it at any time.</span>
              </li>
              <li className="flex items-start gap-2">
                <span className="text-blue-500 mt-0.5">4.</span>
                <span><strong>One-way sync</strong> — content flows from Bobbinry to Drive. Edits in Drive will be overwritten.</span>
              </li>
            </ul>
          </section>
        )}
      </div>
    </div>
  )
}

function StatusDot({ status, isActive }: { status: string | null; isActive: boolean }) {
  if (!isActive) {
    return (
      <span className="w-2 h-2 rounded-full bg-gray-300 dark:bg-gray-600 flex-shrink-0" title="Backup disabled" />
    )
  }
  switch (status) {
    case 'success':
      return <span className="w-2 h-2 rounded-full bg-green-500 flex-shrink-0" title="Last sync successful" />
    case 'failed':
      return <span className="w-2 h-2 rounded-full bg-red-500 flex-shrink-0" title="Last sync failed" />
    case 'partial':
      return <span className="w-2 h-2 rounded-full bg-yellow-500 flex-shrink-0" title="Partial sync" />
    case 'pending':
      return <span className="w-2 h-2 rounded-full bg-yellow-400 flex-shrink-0" title="Pending" />
    default:
      return <span className="w-2 h-2 rounded-full bg-gray-400 dark:bg-gray-500 flex-shrink-0" title="Never synced" />
  }
}
