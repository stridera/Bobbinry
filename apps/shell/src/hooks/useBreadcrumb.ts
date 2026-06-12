'use client'

import { useEffect, useState } from 'react'
import type { BobbinrySDK } from '@bobbinry/sdk'

export interface Crumb {
  id: string
  label: string
  /** Dispatched via bobbinry:navigate when the crumb is clicked; leaf crumbs have none. */
  navDetail?: {
    entityType: string
    entityId: string
    bobbinId: string
    metadata?: Record<string, any>
  }
}

interface NavigationState {
  entityType: string
  entityId: string
  bobbinId: string
  metadata?: Record<string, any>
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const CACHE_TTL_MS = 60_000

interface ContainerRecord {
  id: string
  title: string
  parentId: string | null
}

// Module-level cache of the project's container hierarchy. The manuscript
// nav panel may be unmounted (icon rail shows another panel), so the shell
// resolves ancestors itself from the same containers collection the panel
// uses. Invalidated by TTL and by container/content change events.
const containersCache = new Map<string, { at: number; map: Map<string, ContainerRecord> }>()

if (typeof window !== 'undefined') {
  window.addEventListener('bobbinry:entities-changed', (event: Event) => {
    const detail = (event as CustomEvent).detail
    if (detail?.collection === 'containers' || detail?.collection === 'content') {
      containersCache.clear()
    }
  })
}

async function getContainersMap(sdk: BobbinrySDK, projectId: string): Promise<Map<string, ContainerRecord>> {
  const cached = containersCache.get(projectId)
  if (cached && Date.now() - cached.at < CACHE_TTL_MS) return cached.map

  const result = await sdk.entities.query({ collection: 'containers', limit: 1000 }) as { data?: any[] }
  const map = new Map<string, ContainerRecord>()
  for (const c of result.data ?? []) {
    if (!c?.id) continue
    map.set(c.id, {
      id: c.id,
      title: c.title || 'Untitled',
      parentId: c.parent_id || c.parentId || null,
    })
  }
  containersCache.set(projectId, { at: Date.now(), map })
  return map
}

function projectCrumb(projectName: string | undefined, isLeaf: boolean): Crumb {
  const crumb: Crumb = { id: 'ROOT', label: projectName || 'Project' }
  if (!isLeaf) {
    crumb.navDetail = {
      entityType: 'container',
      entityId: 'ROOT',
      bobbinId: 'manuscript',
      metadata: { type: 'root' },
    }
  }
  return crumb
}

function containerChain(map: Map<string, ContainerRecord>, startId: string | null): Crumb[] {
  const chain: Crumb[] = []
  let cursor = startId
  // Bounded walk guards against parent_id cycles in bad data
  for (let i = 0; cursor && i < 32; i++) {
    const record = map.get(cursor)
    if (!record) break
    chain.unshift({
      id: record.id,
      label: record.title,
      navDetail: {
        entityType: 'container',
        entityId: record.id,
        bobbinId: 'manuscript',
        metadata: { type: 'container' },
      },
    })
    cursor = record.parentId
  }
  return chain
}

export function useBreadcrumb(
  currentNav: NavigationState | null,
  sdk: BobbinrySDK | null,
  projectId: string,
  projectName?: string
): Crumb[] {
  const [crumbs, setCrumbs] = useState<Crumb[]>([])

  const navKey = currentNav
    ? `${currentNav.bobbinId}:${currentNav.entityType}:${currentNav.entityId}`
    : ''

  useEffect(() => {
    let cancelled = false

    async function build(): Promise<Crumb[]> {
      if (!currentNav || !sdk) return []

      const { entityType, entityId, bobbinId, metadata } = currentNav
      const isUUID = UUID_RE.test(entityId)

      if (!isUUID) {
        // Sentinel route (ROOT, dashboard, matrix, new, …) — just the project crumb
        return [projectCrumb(projectName, true)]
      }

      if (bobbinId === 'manuscript') {
        const map = await getContainersMap(sdk, projectId)
        if (entityType === 'container') {
          const chain = containerChain(map, entityId)
          if (chain.length > 0) {
            const leaf = chain[chain.length - 1]!
            delete leaf.navDetail
          }
          return [projectCrumb(projectName, false), ...chain]
        }
        // content — leaf title + containerId come from the record itself;
        // metadata.parentId from the nav event is a fallback
        let title = 'Untitled'
        let containerId: string | null = metadata?.parentId ?? null
        try {
          const record = await sdk.entities.get('content', entityId) as any
          title = record?.title || title
          containerId = record?.containerId || record?.container_id || containerId
        } catch {
          // record fetch failed — render with what the nav event gave us
        }
        return [
          projectCrumb(projectName, false),
          ...containerChain(map, containerId),
          { id: entityId, label: title },
        ]
      }

      if (bobbinId === 'entities') {
        let name = 'Untitled'
        try {
          const record = await sdk.entities.get(entityType, entityId) as any
          name = record?.name || record?.title || name
        } catch {
          // tolerate — type label still orients the user
        }
        return [
          projectCrumb(projectName, false),
          { id: entityType, label: metadata?.typeLabel || entityType },
          { id: entityId, label: name },
        ]
      }

      if (bobbinId === 'notes') {
        let title = 'Untitled'
        try {
          const record = await sdk.entities.get('notes', entityId) as any
          title = record?.title || title
        } catch {
          // tolerate missing note record
        }
        return [
          projectCrumb(projectName, false),
          { id: 'notes', label: 'Notes' },
          { id: entityId, label: title },
        ]
      }

      // Unknown bobbin — project crumb only, clickable back to ROOT
      return [projectCrumb(projectName, false)]
    }

    build()
      .then(result => {
        if (!cancelled) setCrumbs(result)
      })
      .catch(() => {
        if (!cancelled) setCrumbs(currentNav ? [projectCrumb(projectName, true)] : [])
      })

    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [navKey, sdk, projectId, projectName])

  return crumbs
}

export default useBreadcrumb
