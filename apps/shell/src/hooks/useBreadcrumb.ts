'use client'

import { useEffect, useState } from 'react'
import type { BobbinrySDK } from '@bobbinry/sdk'
import { extensionRegistry, recordDeclarations } from '@/lib/extensions'
import { resolveCrumbs, type Crumb, type NavigationState } from '@/lib/breadcrumbs'

export type { Crumb } from '@/lib/breadcrumbs'

/**
 * Breadcrumbs for the shell top bar, resolved from the bobbins' manifest
 * `records` declarations (see lib/breadcrumbs.ts). Re-resolves when the
 * target changes and when bobbins register their left panels, which happens
 * after first paint.
 */
export function useBreadcrumb(
  currentNav: NavigationState | null,
  sdk: BobbinrySDK | null,
  projectId: string,
  projectName?: string
): Crumb[] {
  const [crumbs, setCrumbs] = useState<Crumb[]>([])
  const [registryVersion, setRegistryVersion] = useState(0)
  useEffect(() => extensionRegistry.onSlotChange('shell.leftPanel', () => setRegistryVersion(v => v + 1)), [])

  const navKey = currentNav
    ? `${currentNav.bobbinId}:${currentNav.entityType}:${currentNav.entityId}`
    : ''

  useEffect(() => {
    let cancelled = false
    resolveCrumbs(currentNav, sdk?.entities ?? null, projectId, projectName, recordDeclarations())
      .then(result => { if (!cancelled) setCrumbs(result) })
      .catch(() => { if (!cancelled) setCrumbs([]) })
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- navKey stands in for currentNav
  }, [navKey, sdk, projectId, projectName, registryVersion])

  return crumbs
}

export default useBreadcrumb
