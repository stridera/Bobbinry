'use client'

/**
 * Registers reader bobbins (manifests with capabilities.readerBobbinType) on
 * the public reader so `reader.*` extension slots have something to render.
 *
 * Reader-type bobbins are on for everyone by default. A signed-in user can opt
 * out under Settings > Reader Bobbins, which stores a user_bobbins_installed
 * row with isEnabled = false; those are skipped here.
 */

import { useEffect } from 'react'
import { useManifestExtensions } from '@/components/ExtensionProvider'
import { apiFetch } from '@/lib/api'
import { config } from '@/lib/config'

export interface ReaderBobbinCatalogEntry {
  id: string
  name: string
  description: string
  version: string
  readerBobbinType: 'reader' | 'automation'
  manifest: Record<string, unknown>
}

interface ReaderBobbinInstallRow {
  bobbinId: string
  isEnabled: boolean
}

type SessionStatus = 'loading' | 'authenticated' | 'unauthenticated'

interface UseReaderBobbinsOptions {
  userId?: string | null | undefined
  apiToken?: string | null | undefined
  sessionStatus: SessionStatus
}

/**
 * Bobbin ids currently registered by this hook. Module-level because the
 * reader page remounts between chapters, and because the extension registry
 * caps registration attempts per extension: we only unregister on an explicit
 * opt-out, never on unmount.
 */
const registeredReaderBobbins = new Set<string>()

export async function fetchReaderBobbinCatalog(): Promise<ReaderBobbinCatalogEntry[]> {
  const res = await fetch(`${config.apiUrl}/api/public/reader-bobbins`)
  if (!res.ok) return []
  const data = await res.json()
  return Array.isArray(data?.bobbins) ? data.bobbins : []
}

async function fetchDisabledReaderBobbins(userId: string, apiToken: string): Promise<Set<string>> {
  const disabled = new Set<string>()
  try {
    const res = await apiFetch(`/api/users/${userId}/reader-bobbins`, apiToken)
    if (!res.ok) return disabled
    const data = await res.json()
    const rows: ReaderBobbinInstallRow[] = Array.isArray(data?.bobbins) ? data.bobbins : []
    for (const row of rows) {
      if (row.isEnabled === false) disabled.add(row.bobbinId)
    }
  } catch (err) {
    console.error('[useReaderBobbins] Failed to load reader bobbin opt-outs:', err)
  }
  return disabled
}

export function useReaderBobbins({ userId, apiToken, sessionStatus }: UseReaderBobbinsOptions): void {
  const { registerManifestExtensions, unregisterManifestExtensions } = useManifestExtensions()

  useEffect(() => {
    // Wait for the session so a user who opted out never sees the control flash in.
    if (sessionStatus === 'loading') return
    let cancelled = false

    ;(async () => {
      try {
        const catalog = await fetchReaderBobbinCatalog()
        const disabled = userId && apiToken
          ? await fetchDisabledReaderBobbins(userId, apiToken)
          : new Set<string>()
        if (cancelled) return

        const desired = catalog.filter(b => b.readerBobbinType === 'reader' && !disabled.has(b.id))
        const desiredIds = new Set(desired.map(b => b.id))

        for (const id of Array.from(registeredReaderBobbins)) {
          if (desiredIds.has(id)) continue
          unregisterManifestExtensions(id)
          registeredReaderBobbins.delete(id)
        }

        for (const bobbin of desired) {
          if (registeredReaderBobbins.has(bobbin.id)) continue
          try {
            registerManifestExtensions(bobbin.id, bobbin.manifest)
            registeredReaderBobbins.add(bobbin.id)
          } catch (err) {
            console.error(`[useReaderBobbins] Failed to register ${bobbin.id}:`, err)
          }
        }
      } catch (err) {
        console.error('[useReaderBobbins] Failed to load reader bobbins:', err)
      }
    })()

    return () => {
      cancelled = true
    }
  }, [sessionStatus, userId, apiToken, registerManifestExtensions, unregisterManifestExtensions])
}

/** Test-only: forget everything this hook registered. */
export function __resetReaderBobbinRegistrations(): void {
  registeredReaderBobbins.clear()
}
