'use client'

import { ReactNode } from 'react'
import { ExtensionProvider } from './ExtensionProvider'
import { OfflineProvider } from './OfflineProvider'

interface ProvidersProps {
  children: ReactNode
}

export function Providers({ children }: ProvidersProps) {
  return (
    <ExtensionProvider>
      <OfflineProvider>
        {children}
      </OfflineProvider>
    </ExtensionProvider>
  )
}