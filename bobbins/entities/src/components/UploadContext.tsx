/**
 * SDK Context
 *
 * Provides SDK and project context to deeply nested field renderers
 * (image uploads, relation field resolution, etc.) without threading
 * props through every layout component.
 */

import { createContext, useContext } from 'react'
import type { BobbinrySDK } from '@bobbinry/sdk'

interface SdkContextValue {
  sdk: BobbinrySDK
  projectId: string
}

const SdkContext = createContext<SdkContextValue | null>(null)

export function SdkProvider({
  sdk,
  projectId,
  children,
}: {
  sdk: BobbinrySDK
  projectId: string
  children: React.ReactNode
}) {
  return (
    <SdkContext.Provider value={{ sdk, projectId }}>
      {children}
    </SdkContext.Provider>
  )
}

export function useSdkContext(): SdkContextValue | null {
  return useContext(SdkContext)
}

// Backwards-compatible aliases
export const UploadProvider = SdkProvider
export const useUpload = useSdkContext
export const EntityProvider = SdkProvider
export const useEntityContext = useSdkContext

/**
 * Synchronous map of entity ID → display name, for consumers that pre-fetch
 * a names table (e.g. the public reader) and don't have an SDK available
 * for per-ID lookups.
 */
const ResolvedEntityNamesContext = createContext<Map<string, string> | null>(null)

export function ResolvedEntityNamesProvider({
  names,
  children,
}: {
  names: Map<string, string>
  children: React.ReactNode
}) {
  return (
    <ResolvedEntityNamesContext.Provider value={names}>
      {children}
    </ResolvedEntityNamesContext.Provider>
  )
}

export function useResolvedEntityNamesContext(): Map<string, string> | null {
  return useContext(ResolvedEntityNamesContext)
}
