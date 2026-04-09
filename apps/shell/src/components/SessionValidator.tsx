'use client'

import { useEffect } from 'react'
import { useSession, signOut } from 'next-auth/react'
import { config } from '@/lib/config'

/**
 * Validates the current session against the API on mount.
 * If the user no longer exists in the database (deleted, banned,
 * or DB switched), signs them out immediately instead of showing
 * stale session data.
 */
export function SessionValidator() {
  const { data: session, status } = useSession()

  useEffect(() => {
    if (status !== 'authenticated' || !session?.apiToken || !session?.user?.id) {
      return
    }

    const controller = new AbortController()

    fetch(`${config.apiUrl}/api/auth/session`, {
      headers: { 'Authorization': `Bearer ${session.apiToken}` },
      signal: controller.signal,
    })
      .then((res) => {
        if (res.status === 401) {
          signOut({ callbackUrl: '/login' })
        }
      })
      .catch((err: unknown) => {
        // Network error — don't sign out, could be offline. Still log it so
        // persistent failures show up in browser console / monitoring instead
        // of silently disappearing.
        if (err instanceof Error && err.name === 'AbortError') return
        console.warn('SessionValidator: failed to verify session', err)
      })

    return () => controller.abort()
  }, [status, session?.apiToken, session?.user?.id])

  return null
}
