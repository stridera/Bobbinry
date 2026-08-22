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
    // Refetch every 10 minutes so the server-side `jwt` callback keeps the
    // API token rolling during long writing sessions (see auth.ts).
    <SessionProvider refetchInterval={10 * 60} refetchOnWindowFocus>
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