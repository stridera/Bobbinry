'use client'

import { useState, useEffect, useCallback } from 'react'
import { useSession } from 'next-auth/react'
import { apiFetch } from '@/lib/api'

export interface ProjectSummaryBobbin {
  id: string
  bobbinId: string
  version: string
  manifest: {
    name: string
    description: string
    icon?: string
    hasLeftPanel: boolean
    core?: boolean
    annotationInbox?: boolean
  }
}

export interface ProjectSummary {
  project: {
    id: string
    name: string
    coverImage: string | null
    shortUrl: string | null
    isArchived: boolean
  }
  authorUsername: string | null
  publishConfig: {
    publishingMode: string
    projectVisibility?: string
    enableAnnotations: boolean
  }
  bobbins: ProjectSummaryBobbin[]
  bobbinStats: Record<string, number>
  annotationStats: {
    open: number
    acknowledged: number
    resolved: number
    dismissed: number
    total: number
  }
}

/**
 * The header slice of a project (identity, publish state, installed
 * bobbins, counts) for pages that aren't the dashboard. One request, no
 * chapter bodies.
 */
export function useProjectSummary(projectId: string) {
  const { data: session } = useSession()
  const apiToken = session?.apiToken
  const [summary, setSummary] = useState<ProjectSummary | null>(null)
  const [error, setError] = useState<'forbidden' | 'not-found' | 'other' | null>(null)

  const reload = useCallback(async () => {
    if (!apiToken) return
    try {
      const res = await apiFetch(`/api/projects/${projectId}/summary`, apiToken)
      if (res.ok) {
        setSummary(await res.json())
        setError(null)
      } else if (res.status === 403) {
        setError('forbidden')
      } else if (res.status === 404) {
        setError('not-found')
      } else {
        setError('other')
      }
    } catch (err) {
      console.error('Failed to load project summary:', err)
      setError('other')
    }
  }, [projectId, apiToken])

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- initial fetch
    if (apiToken) reload()
  }, [apiToken, reload])

  return { summary, error, reload }
}
