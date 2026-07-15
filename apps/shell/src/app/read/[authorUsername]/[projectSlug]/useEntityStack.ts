'use client'

/**
 * Navigation stack for the reader's entity modal / sidebar. Clicking a
 * relation pill inside an open entity pushes the target onto the stack so
 * the reader can browse the codex without leaving their place; a back
 * arrow pops. Targets missing from the local codex payload (tier-locked
 * entities are stripped server-side) are fetched by id, and a 403 surfaces
 * as a locked teaser instead of a broken navigation.
 */

import { useCallback, useMemo, useRef, useState } from 'react'
import { config } from '@/lib/config'
import type { PublishedEntity, PublishedType } from './entities-data'

export type EntityStackEntry =
  | { kind: 'entity'; type: PublishedType; entity: PublishedEntity }
  | { kind: 'locked'; tierLevel: number }
  | { kind: 'missing' }

interface UseEntityStackOptions {
  projectId: string
  apiToken?: string | undefined
  /** Resolve an entity id from already-loaded data before falling back to a fetch. */
  resolveLocal?: (entityId: string) => { type: PublishedType; entity: PublishedEntity } | null
}

export function useEntityStack({ projectId, apiToken, resolveLocal }: UseEntityStackOptions) {
  const [stack, setStack] = useState<EntityStackEntry[]>([])
  const [fetching, setFetching] = useState(false)
  const cacheRef = useRef(new Map<string, EntityStackEntry>())

  const open = useCallback((type: PublishedType, entity: PublishedEntity) => {
    setStack([{ kind: 'entity', type, entity }])
  }, [])

  const close = useCallback(() => setStack([]), [])

  const back = useCallback(() => setStack(s => s.slice(0, -1)), [])

  const navigate = useCallback(
    async (entityId: string, { reset = false }: { reset?: boolean } = {}) => {
      const push = (entry: EntityStackEntry) =>
        setStack(s => (reset ? [entry] : [...s, entry]))

      const local = resolveLocal?.(entityId)
      if (local) {
        push({ kind: 'entity', ...local })
        return
      }
      const cached = cacheRef.current.get(entityId)
      if (cached) {
        push(cached)
        return
      }

      setFetching(true)
      try {
        const headers: Record<string, string> = {}
        if (apiToken) headers['Authorization'] = `Bearer ${apiToken}`
        const res = await fetch(
          `${config.apiUrl}/api/public/projects/${projectId}/entities/${encodeURIComponent(entityId)}`,
          { headers }
        )
        let entry: EntityStackEntry
        if (res.status === 403) {
          const body = await res.json().catch(() => ({}))
          entry = { kind: 'locked', tierLevel: body.minimumTierLevel ?? 1 }
        } else if (!res.ok) {
          entry = { kind: 'missing' }
        } else {
          const data = await res.json()
          entry = { kind: 'entity', type: data.type, entity: data.entity }
        }
        cacheRef.current.set(entityId, entry)
        push(entry)
      } catch {
        // Network hiccup — leave the current view in place rather than erroring.
      } finally {
        setFetching(false)
      }
    },
    [projectId, apiToken, resolveLocal]
  )

  const current = stack.length > 0 ? stack[stack.length - 1]! : null
  const canGoBack = stack.length > 1

  return useMemo(
    () => ({ current, canGoBack, fetching, open, close, back, navigate }),
    [current, canGoBack, fetching, open, close, back, navigate]
  )
}
