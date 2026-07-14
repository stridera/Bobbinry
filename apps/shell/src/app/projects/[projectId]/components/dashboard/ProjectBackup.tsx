'use client'

import { useState, useEffect, useCallback } from 'react'
import { useSession } from 'next-auth/react'
import Link from 'next/link'
import { apiFetch } from '@/lib/api'
import { CollapsibleCard } from './CollapsibleCard'

interface ProjectBackupProps {
  projectId: string
}

interface BackupStatus {
  connection: {
    connected: boolean
    driveEmail?: string | null
    rootFolderName?: string | null
    rootFolderId?: string | null
  }
  projects: Array<{
    id: string
    isBackedUp: boolean
    lastSyncedAt: string | null
    lastSyncStatus: string | null
    lastSyncError: string | null
    driveFolderId?: string | null
  }>
}

const driveFolderUrl = (folderId?: string | null) =>
  folderId ? `https://drive.google.com/drive/folders/${folderId}` : null

export function ProjectBackup({ projectId }: ProjectBackupProps) {
  const { data: session } = useSession()
  const apiToken = session?.apiToken as string | undefined

  const [status, setStatus] = useState<BackupStatus | null>(null)
  const [loading, setLoading] = useState(true)
  const [syncing, setSyncing] = useState(false)
  const [toggling, setToggling] = useState(false)
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null)

  const loadStatus = useCallback(async () => {
    if (!apiToken) return
    try {
      const res = await apiFetch('/api/backups/status', apiToken)
      if (res.ok) setStatus(await res.json())
    } catch (err) {
      console.error('Failed to load backup status:', err)
    } finally {
      setLoading(false)
    }
  }, [apiToken])

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- initial fetch
    if (apiToken) loadStatus()
  }, [apiToken, loadStatus])

  const connection = status?.connection
  const project = status?.projects?.find(p => p.id === projectId)
  const isBackedUp = project?.isBackedUp ?? true

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

  // Poll status until this project leaves the 'syncing' state (or we give up).
  const pollUntilSynced = useCallback(async (): Promise<string> => {
    if (!apiToken) return 'timeout'
    for (let i = 0; i < 60; i++) {
      await new Promise(r => setTimeout(r, 3000))
      let data: BackupStatus | null = null
      try {
        const res = await apiFetch('/api/backups/status', apiToken)
        if (res.ok) {
          data = await res.json()
          setStatus(data)
        }
      } catch {
        // transient — keep polling
      }
      const s = data?.projects?.find(p => p.id === projectId)?.lastSyncStatus
      if (s === 'success' || s === 'partial' || s === 'failed') return s
    }
    return 'timeout'
  }, [apiToken, projectId])

  const handleSyncNow = async () => {
    if (!apiToken || syncing) return
    setSyncing(true)
    setMessage(null)
    try {
      const res = await apiFetch(`/api/backups/projects/${projectId}/sync`, apiToken, { method: 'POST' })
      if (res.ok || res.status === 202) {
        const result = await pollUntilSynced()
        if (result === 'success') setMessage({ type: 'success', text: 'Backup synced to Google Drive.' })
        else if (result === 'partial') setMessage({ type: 'error', text: 'Some items failed to sync.' })
        else if (result === 'failed') setMessage({ type: 'error', text: 'Sync failed.' })
        else setMessage({ type: 'error', text: 'Sync is taking a while — check back shortly.' })
        await loadStatus()
      } else {
        const err = await res.json().catch(() => ({}))
        setMessage({ type: 'error', text: err.error || 'Sync failed' })
      }
    } catch {
      setMessage({ type: 'error', text: 'Failed to start sync' })
    } finally {
      setSyncing(false)
    }
  }

  const handleToggle = async () => {
    if (!apiToken || toggling) return
    setToggling(true)
    try {
      await apiFetch(`/api/backups/projects/${projectId}`, apiToken, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ isActive: !isBackedUp }),
      })
      await loadStatus()
    } catch {
      setMessage({ type: 'error', text: 'Failed to update backup setting' })
    } finally {
      setToggling(false)
    }
  }

  // Hide entirely while loading so the dashboard doesn't flash an empty card.
  if (loading) return null

  const folderUrl = driveFolderUrl(project?.driveFolderId || connection?.rootFolderId)

  return (
    <CollapsibleCard
      title="Backup"
      headerAccessory={
        connection?.connected ? (
          <span
            className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${
              isBackedUp
                ? 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400'
                : 'bg-gray-100 dark:bg-gray-700 text-gray-500 dark:text-gray-400'
            }`}
          >
            {isBackedUp ? 'Active' : 'Disabled'}
          </span>
        ) : undefined
      }
    >
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-sm text-gray-500 dark:text-gray-400">
            {connection?.connected
              ? 'This project is backed up to Google Drive.'
              : 'Connect Google Drive to automatically back up this project.'}
          </p>
        </div>
        {connection?.connected && isBackedUp && (
          <button
            onClick={handleSyncNow}
            disabled={syncing}
            className="px-3 py-1.5 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors disabled:opacity-50 font-medium flex-shrink-0"
          >
            {syncing ? 'Syncing…' : 'Sync now'}
          </button>
        )}
      </div>

      {message && (
          <div
            className={`mt-4 p-3 rounded-lg text-sm ${
              message.type === 'success'
                ? 'bg-green-50 dark:bg-green-900/20 text-green-800 dark:text-green-300'
                : 'bg-red-50 dark:bg-red-900/20 text-red-800 dark:text-red-300'
            }`}
          >
            {message.text}
          </div>
        )}

        {!connection?.connected ? (
          <div className="mt-5 flex items-center gap-3">
            <button
              onClick={handleConnect}
              className="px-4 py-2 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors font-medium"
            >
              Connect Google Drive
            </button>
            <Link href="/backups" className="text-sm font-medium text-blue-600 dark:text-blue-400 hover:underline">
              Manage backups →
            </Link>
          </div>
        ) : (
          <>
            {project?.lastSyncError && (project.lastSyncStatus === 'failed' || project.lastSyncStatus === 'partial') && (
              <p className={`mt-3 text-sm ${project.lastSyncStatus === 'partial' ? 'text-amber-600 dark:text-amber-400' : 'text-red-500 dark:text-red-400'}`}>
                {project.lastSyncError}
              </p>
            )}

            <dl className="mt-4 grid grid-cols-2 gap-4 text-sm">
              <div>
                <dt className="text-gray-400 dark:text-gray-500">Drive account</dt>
                <dd className="mt-0.5 text-gray-700 dark:text-gray-300 truncate">{connection.driveEmail || '—'}</dd>
              </div>
              <div>
                <dt className="text-gray-400 dark:text-gray-500">Last sync</dt>
                <dd className="mt-0.5 text-gray-700 dark:text-gray-300">
                  {project?.lastSyncedAt ? new Date(project.lastSyncedAt).toLocaleString() : 'Never'}
                </dd>
              </div>
            </dl>

            <div className="mt-5 flex flex-wrap items-center gap-x-4 gap-y-2">
              {folderUrl && (
                <a
                  href={folderUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-sm font-medium text-blue-600 dark:text-blue-400 hover:underline"
                >
                  Open in Google Drive ↗
                </a>
              )}
              <button
                onClick={handleToggle}
                disabled={toggling}
                className="text-sm font-medium text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 disabled:opacity-50"
              >
                {isBackedUp ? 'Disable backup' : 'Enable backup'}
              </button>
              <Link href="/backups" className="text-sm font-medium text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200">
                Manage all backups →
              </Link>
            </div>

            <p className="mt-4 text-xs text-gray-400 dark:text-gray-500">
              One-way backup. Content flows from Bobbinry to Drive; edits made in Drive are overwritten.
            </p>
          </>
        )}
    </CollapsibleCard>
  )
}
