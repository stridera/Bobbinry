'use client'

import { useCallback, useState } from 'react'
import { apiFetch } from '@/lib/api'

export type SearchScope =
  | { type: 'project' }
  | { type: 'chapter'; chapterId: string }

export interface SearchMatch {
  id: string
  entityId: string
  collection: string
  field: string
  index: number
  matchText: string
  contextBefore: string
  contextAfter: string
}

export interface PreviewResponse {
  matches: SearchMatch[]
  entityVersions: Record<string, number>
  truncated?: boolean
}

export interface ApplyResponse {
  applied: string[]
  appliedMatchIds: string[]
  stale: string[]
  notFound: string[]
  malformed: string[]
}

export interface SearchOptions {
  query: string
  replacement: string
  caseSensitive: boolean
  wholeWord: boolean
  scope: SearchScope
}

interface UseSearchReplaceArgs {
  projectId: string
  apiToken: string
}

export function useSearchReplace({ projectId, apiToken }: UseSearchReplaceArgs) {
  const [preview, setPreview] = useState<PreviewResponse | null>(null)
  const [previewing, setPreviewing] = useState(false)
  const [applying, setApplying] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [lastApply, setLastApply] = useState<ApplyResponse | null>(null)

  const runPreview = useCallback(async (opts: SearchOptions): Promise<PreviewResponse | null> => {
    setError(null)
    setLastApply(null)
    setPreviewing(true)
    try {
      const res = await apiFetch(`/api/projects/${projectId}/search-replace/preview`, apiToken, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          query: opts.query,
          caseSensitive: opts.caseSensitive,
          wholeWord: opts.wholeWord,
          scope: opts.scope,
        }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data.error || `Preview failed (${res.status})`)
      }
      const body = (await res.json()) as PreviewResponse
      setPreview(body)
      return body
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Preview failed')
      setPreview(null)
      return null
    } finally {
      setPreviewing(false)
    }
  }, [projectId, apiToken])

  const runApply = useCallback(async (
    opts: SearchOptions,
    selectedMatchIds: string[],
    entityVersions: Record<string, number>,
  ): Promise<ApplyResponse | null> => {
    if (selectedMatchIds.length === 0) return null
    setError(null)
    setApplying(true)
    try {
      const res = await apiFetch(`/api/projects/${projectId}/search-replace/apply`, apiToken, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          query: opts.query,
          replacement: opts.replacement,
          caseSensitive: opts.caseSensitive,
          wholeWord: opts.wholeWord,
          scope: opts.scope,
          selectedMatchIds,
          entityVersions,
        }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data.error || `Apply failed (${res.status})`)
      }
      const body = (await res.json()) as ApplyResponse
      setLastApply(body)
      if (body.applied.length > 0) {
        window.dispatchEvent(new CustomEvent('bobbinry:entities-bulk-updated', {
          detail: { entityIds: body.applied },
        }))
      }
      return body
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Apply failed')
      return null
    } finally {
      setApplying(false)
    }
  }, [projectId, apiToken])

  const reset = useCallback(() => {
    setPreview(null)
    setLastApply(null)
    setError(null)
  }, [])

  return {
    preview,
    previewing,
    apply: runApply,
    runPreview,
    applying,
    error,
    lastApply,
    reset,
  }
}
