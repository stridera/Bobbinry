'use client'

import { useState, useEffect, useCallback } from 'react'
import { useSession } from 'next-auth/react'
import { apiFetch } from '@/lib/api'

export interface BackupStatus {
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

/**
 * Account-wide Google Drive backup status, fetched once per mount. Shared by
 * the settings page's Backup card and the dashboard rail's one-line summary.
 */
export function useBackupStatus() {
  const { data: session } = useSession()
  const apiToken = session?.apiToken as string | undefined

  const [status, setStatus] = useState<BackupStatus | null>(null)
  const [loading, setLoading] = useState(true)

  const reload = useCallback(async () => {
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
    if (apiToken) reload()
  }, [apiToken, reload])

  return { status, setStatus, loading, reload, apiToken }
}
