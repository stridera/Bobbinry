/**
 * Upload Context
 *
 * Provides SDK upload capability to deeply nested field renderers
 * without threading props through every layout component.
 */

import { createContext, useContext } from 'react'
import type { BobbinrySDK, UploadResult } from '@bobbinry/sdk'

interface UploadContextValue {
  sdk: BobbinrySDK
  projectId: string
}

const UploadContext = createContext<UploadContextValue | null>(null)

export function UploadProvider({
  sdk,
  projectId,
  children,
}: {
  sdk: BobbinrySDK
  projectId: string
  children: React.ReactNode
}) {
  return (
    <UploadContext.Provider value={{ sdk, projectId }}>
      {children}
    </UploadContext.Provider>
  )
}

export function useUpload(): UploadContextValue | null {
  return useContext(UploadContext)
}
