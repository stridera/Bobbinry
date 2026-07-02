'use client'

import { useCallback, useRef, useState } from 'react'
import { apiFetch } from '@/lib/api'

export type SearchScope =
  | { type: 'project' }
  | { type: 'chapter'; chapterId: string }

/** One run of a match snippet: plain context (`match: false`) or a highlighted
 * occurrence of the query (`match: true`). */
export interface MatchSegment {
  text: string
  match: boolean
}

export interface SearchMatch {
  id: string
  entityId: string
  collection: string
  field: string
  /** Every underlying 0-based occurrence index this row coalesces — adjacent
   * occurrences whose context windows overlap are merged into one row. */
  indices: number[]
  contextBefore: string
  contextAfter: string
  segments: MatchSegment[]
}

/** Expand display matches into the per-occurrence `entityId:field:index` ids the
 * apply endpoint keys on. A merged row replaces every occurrence it covers. */
export function expandMatchIds(matches: SearchMatch[]): string[] {
  return matches.flatMap(m => m.indices.map(i => `${m.entityId}:${m.field}:${i}`))
}

export interface PreviewResponse {
  matches: SearchMatch[]
  entityVersions: Record<string, number>
  /** Display titles (chapter `title` / entity `name`) keyed by entityId. */
  entityTitles?: Record<string, string>
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
  /** Restrict the search to specific bobbins ('manuscript' | 'entities'). */
  bobbinIds?: string[]
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

  // Live search fires previews per (debounced) keystroke — abort the previous
  // request and let only the newest one touch state, so a slow early response
  // can't overwrite a fast later one.
  const abortRef = useRef<AbortController | null>(null)
  const seqRef = useRef(0)

  const runPreview = useCallback(async (opts: SearchOptions): Promise<PreviewResponse | null> => {
    abortRef.current?.abort()
    const controller = new AbortController()
    abortRef.current = controller
    const seq = ++seqRef.current
    const isCurrent = () => seq === seqRef.current

    setError(null)
    setLastApply(null)
    setPreviewing(true)
    try {
      const res = await apiFetch(`/api/projects/${projectId}/search-replace/preview`, apiToken, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: controller.signal,
        body: JSON.stringify({
          query: opts.query,
          caseSensitive: opts.caseSensitive,
          wholeWord: opts.wholeWord,
          scope: opts.scope,
          ...(opts.bobbinIds ? { bobbinIds: opts.bobbinIds } : {}),
        }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data.error || `Preview failed (${res.status})`)
      }
      const body = (await res.json()) as PreviewResponse
      if (!isCurrent()) return null
      setPreview(body)
      return body
    } catch (err) {
      // A superseded request aborting is the expected happy path — leave the
      // newer request's state alone.
      if (err instanceof DOMException && err.name === 'AbortError') return null
      if (!isCurrent()) return null
      setError(err instanceof Error ? err.message : 'Preview failed')
      setPreview(null)
      return null
    } finally {
      if (isCurrent()) setPreviewing(false)
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
