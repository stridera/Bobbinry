'use client'

import { ReactNode } from 'react'
import { SessionProvider } from 'next-auth/react'
import { AnalyticsProvider } from './AnalyticsProvider'
import { ExtensionProvider } from './ExtensionProvider'
import { OfflineProvider } from './OfflineProvider'
import { SessionValidator } from './SessionValidator'
import { ThemeProvider } from '@/contexts/ThemeContext'
import { ToastProvider } from '@/contexts/ToastContext'

interface ProvidersProps {
  children: ReactNode
}

export function Providers({ children }: ProvidersProps) {
  return (
    <SessionProvider>
      <SessionValidator />
      <AnalyticsProvider />
      <ThemeProvider>
        <ToastProvider>
          <ExtensionProvider>
            <OfflineProvider>
              {children}
            </OfflineProvider>
          </ExtensionProvider>
        </ToastProvider>
      </ThemeProvider>
    </SessionProvider>
  )
}