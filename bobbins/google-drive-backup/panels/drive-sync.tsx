'use client'

/**
 * Google Drive Backup Panel
 *
 * Shown on the project dashboard via shell.projectBackup slot.
 * Uses the user-scoped /backups API routes.
 * Three states:
 *   1. Not connected — "Connect Google Drive" button
 *   2. Connected — status, folder, sync controls, opt-out toggle
 *   3. Error — error message, retry button
 */

import { useState, useEffect, useCallback } from 'react'
import {
  PanelActionButton,
  PanelBody,
  PanelCard,
  PanelEmptyState,
  PanelFrame,
  PanelHeader,
  PanelLoadingState,
  PanelMessage,
  PanelPill,
  PanelSectionTitle,
} from '@bobbinry/sdk'

interface DriveSyncPanelProps {
  projectId: string
  apiToken?: string
  context?: {
    projectId: string
    apiToken?: string
  }
}

interface BackupStatus {
  connection: {
    connected: boolean
    provider?: string
    driveEmail?: string | null
    rootFolderName?: string | null
    rootFolderId?: string | null
  }
  projects: Array<{
    id: string
    name: string
    isBackedUp: boolean
    lastSyncedAt: string | null
    lastSyncStatus: string | null
    lastSyncError: string | null
    driveFolderId?: string | null
    chapterCount: number
  }>
}

const driveFolderUrl = (folderId?: string | null) =>
  folderId ? `https://drive.google.com/drive/folders/${folderId}` : null

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4100'

function authFetch(path: string, apiToken: string, init?: RequestInit) {
  return fetch(`${API_URL}${path}`, {
    ...init,
    headers: { ...init?.headers, Authorization: `Bearer ${apiToken}` },
  })
}

export default function DriveSyncPanel(props: DriveSyncPanelProps) {
  const projectId = props.projectId || props.context?.projectId
  const apiToken = props.apiToken || props.context?.apiToken

  const [status, setStatus] = useState<BackupStatus | null>(null)
  const [loading, setLoading] = useState(true)
  const [syncing, setSyncing] = useState(false)
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null)

  const loadStatus = useCallback(async () => {
    if (!apiToken) return
    try {
      const res = await authFetch('/api/backups/status', apiToken)
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
    loadStatus()
  }, [loadStatus])

  const handleConnect = async () => {
    if (!apiToken) return
    try {
      const res = await authFetch('/api/backups/google-drive/authorize', apiToken)
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

  // Poll /backups/status until this project leaves the 'syncing' state (or we
  // give up). Returns the terminal status, refreshing the panel as it goes.
  const pollUntilSynced = useCallback(async (): Promise<string> => {
    if (!apiToken) return 'timeout'
    for (let i = 0; i < 60; i++) {
      await new Promise(r => setTimeout(r, 3000))
      let data: BackupStatus | null = null
      try {
        const res = await authFetch('/api/backups/status', apiToken)
        if (res.ok) {
          data = await res.json()
          setStatus(data)
        }
      } catch {
        // transient — keep polling
      }
      const proj = data?.projects?.find(p => p.id === projectId)
      const s = proj?.lastSyncStatus
      if (s === 'success' || s === 'partial' || s === 'failed') return s
    }
    return 'timeout'
  }, [apiToken, projectId])

  const handleSyncNow = async () => {
    if (!projectId || !apiToken) return
    setSyncing(true)
    setMessage(null)
    try {
      const res = await authFetch(
        `/api/backups/projects/${projectId}/sync`,
        apiToken,
        { method: 'POST' }
      )
      // 202 Accepted — sync runs in the background; poll for the outcome
      if (res.ok || res.status === 202) {
        const result = await pollUntilSynced()
        if (result === 'success') {
          setMessage({ type: 'success', text: 'Backup synced to Google Drive' })
        } else if (result === 'partial') {
          setMessage({ type: 'error', text: 'Some items failed to sync — see status above' })
        } else if (result === 'failed') {
          setMessage({ type: 'error', text: 'Sync failed' })
        } else {
          setMessage({ type: 'error', text: 'Sync is taking a while — check back shortly' })
        }
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

  const handleToggle = async (isActive: boolean) => {
    if (!projectId || !apiToken) return
    try {
      await authFetch(`/api/backups/projects/${projectId}`, apiToken, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ isActive }),
      })
      await loadStatus()
    } catch {
      setMessage({ type: 'error', text: 'Failed to update backup setting' })
    }
  }

  if (loading) {
    return <PanelLoadingState label="Loading backup status…" />
  }

  const connected = status?.connection?.connected
  const projectData = status?.projects?.find(p => p.id === projectId)

  // Not connected — show connect button
  if (!connected) {
    return (
      <PanelFrame>
        <Header />
        <PanelBody className="space-y-3">
          {message ? <PanelMessage tone="error">{message.text}</PanelMessage> : null}
          <PanelEmptyState
            title="Google Drive not connected"
            description="Connect once to back up every project, then opt individual projects in or out."
            action={
              <PanelActionButton tone="primary" onClick={handleConnect}>
                Connect Google Drive
              </PanelActionButton>
            }
          />
        </PanelBody>
      </PanelFrame>
    )
  }

  // Connected — show project-specific status
  const isBackedUp = projectData?.isBackedUp ?? true
  const lastSyncError = projectData?.lastSyncError

  // Error state
  if (lastSyncError && projectData?.lastSyncStatus === 'failed') {
    return (
      <PanelFrame>
        <Header />
        <PanelBody className="space-y-3">
          <PanelMessage tone="error">{lastSyncError}</PanelMessage>
          <PanelActionButton tone="primary" onClick={handleSyncNow} disabled={syncing} className="w-full">
            {syncing ? 'Syncing…' : 'Retry Sync'}
          </PanelActionButton>
        </PanelBody>
      </PanelFrame>
    )
  }

  return (
    <PanelFrame>
      <Header />
      <PanelBody className="space-y-3">
        {message ? (
          <PanelMessage tone={message.type === 'success' ? 'success' : 'error'}>
            {message.text}
          </PanelMessage>
        ) : null}

        {projectData?.lastSyncStatus === 'partial' && projectData?.lastSyncError ? (
          <PanelMessage tone="error">{projectData.lastSyncError}</PanelMessage>
        ) : null}

        <PanelCard className="space-y-3">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <PanelPill className={isBackedUp ? 'bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300' : ''}>
                  {isBackedUp ? 'Backup Active' : 'Backup Disabled'}
                </PanelPill>
                {status?.connection?.driveEmail ? (
                  <span className="truncate text-xs text-gray-500 dark:text-gray-400">{status.connection.driveEmail}</span>
                ) : null}
              </div>
              {status?.connection?.rootFolderName ? (
                <p className="mt-2 text-xs text-gray-500 dark:text-gray-400">
                  Folder: <span className="font-medium text-gray-700 dark:text-gray-300">{status.connection.rootFolderName}</span>
                </p>
              ) : null}
              {driveFolderUrl(projectData?.driveFolderId || status?.connection?.rootFolderId) ? (
                <p className="mt-1 text-xs">
                  <a
                    href={driveFolderUrl(projectData?.driveFolderId || status?.connection?.rootFolderId)!}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="font-medium text-blue-600 hover:underline dark:text-blue-400"
                  >
                    Open in Google Drive ↗
                  </a>
                </p>
              ) : null}
              {projectData?.lastSyncedAt ? (
                <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                  Last sync {new Date(projectData.lastSyncedAt).toLocaleString()}
                </p>
              ) : null}
            </div>
            <div className="flex flex-col gap-2">
              {isBackedUp ? (
                <PanelActionButton tone="primary" onClick={handleSyncNow} disabled={syncing}>
                  {syncing ? 'Syncing…' : 'Sync now'}
                </PanelActionButton>
              ) : null}
              <PanelActionButton onClick={() => handleToggle(!isBackedUp)}>
                {isBackedUp ? 'Disable' : 'Enable'}
              </PanelActionButton>
            </div>
          </div>
        </PanelCard>

        <div className="space-y-2">
          <PanelSectionTitle>Backup Snapshot</PanelSectionTitle>
          <div className="grid grid-cols-2 gap-3">
            <PanelCard>
              <div className="text-lg font-semibold text-gray-900 dark:text-gray-100">{projectData?.chapterCount || 0}</div>
              <div className="mt-0.5 text-xs text-gray-500 dark:text-gray-400">Chapters</div>
            </PanelCard>
            <PanelCard>
              <div className="text-lg font-semibold text-gray-900 dark:text-gray-100">
                {status?.projects?.filter(p => p.isBackedUp).length || 0}
              </div>
              <div className="mt-0.5 text-xs text-gray-500 dark:text-gray-400">Active projects</div>
            </PanelCard>
          </div>
        </div>

        <p className="text-[10px] leading-tight text-gray-400 dark:text-gray-500">
          One-way backup sync. Content in Drive is auto-updated, and edits made in Drive will be overwritten.
        </p>
      </PanelBody>
    </PanelFrame>
  )
}

function Header() {
  return (
    <PanelHeader
      title="Google Drive Backup"
      description="Automatic project backup with per-project opt-in control."
      badge={
        <span className="inline-flex h-8 w-8 items-center justify-center rounded-lg bg-blue-100 text-blue-600 dark:bg-blue-900/30 dark:text-blue-300">
          <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
          </svg>
        </span>
      }
    />
  )
}
