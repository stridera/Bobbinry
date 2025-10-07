'use client'

import { ReactNode } from 'react'
import { SessionProvider } from 'next-auth/react'
import { ExtensionProvider } from './ExtensionProvider'
import { OfflineProvider } from './OfflineProvider'
import { ThemeProvider } from '@/contexts/ThemeContext'

interface ProvidersProps {
  children: ReactNode
}

export function Providers({ children }: ProvidersProps) {
  return (
    <SessionProvider>
      <ThemeProvider>
        <ExtensionProvider>
          <OfflineProvider>
            {children}
          </OfflineProvider>
        </ExtensionProvider>
      </ThemeProvider>
    </SessionProvider>
  )
}