'use client'

import { useEffect, useRef } from 'react'
import { useSession } from 'next-auth/react'
import { BobbinryAPI } from '@bobbinry/sdk'
import { config } from '@/lib/config'
import {
  getTokenExpiry,
  redirectToLogin,
  registerSessionRefresher,
  requestSessionRefresh,
} from '@/lib/session-refresh'

/**
 * Re-mint the API token when it has less than this long left. The server
 * already renews on any session fetch once the token is a day old, so this
 * only matters for a tab that has been open for days without focus changes
 * or a session restored right at the end of its life.
 */
const RENEW_WHEN_REMAINING_MS = 60 * 60 * 1000

/**
 * Keeps the session usable for as long as the user keeps using the app.
 *
 * - Validates the session against the API on mount and when the token
 *   changes. A 401 that survives a refresh means the user no longer exists
 *   (deleted, banned, DB switched) → sign out.
 * - Registers the session refresher used by `apiFetch` and the SDK so any
 *   401 anywhere triggers a single deduplicated renewal.
 * - Watches the API token's `exp` claim and proactively renews it an hour
 *   before expiry, including when the tab regains visibility — so a writing
 *   session started an hour before expiry never silently stops saving.
 */
export function SessionValidator() {
  const { data: session, status, update } = useSession()
  const apiToken = session?.apiToken
  const userId = session?.user?.id

  // Keep a ref to the latest `update` so the registered refresher is stable.
  const updateRef = useRef(update)
  useEffect(() => {
    updateRef.current = update
  }, [update])

  // Register the refresher + SDK default 401 handler once.
  useEffect(() => {
    registerSessionRefresher(async () => {
      const next = await updateRef.current({ renewApiToken: true })
      return next?.apiToken ?? null
    })
    BobbinryAPI.setDefaultUnauthorizedHandler(() => {
      requestSessionRefresh()
    })
    return () => {
      registerSessionRefresher(null)
      BobbinryAPI.setDefaultUnauthorizedHandler(null)
    }
  }, [])

  // Validate against the API whenever the token changes (incl. mount).
  useEffect(() => {
    if (status !== 'authenticated' || !apiToken || !userId) return

    const controller = new AbortController()
    let cancelled = false

    fetch(`${config.apiUrl}/api/auth/session`, {
      headers: { 'Authorization': `Bearer ${apiToken}` },
      signal: controller.signal,
    })
      .then(async (res) => {
        if (res.status !== 401 || cancelled) return
        // Token rejected. Try to renew from the cookie once; the refresh
        // helper signs out if the server hands back the same dead token.
        const renewed = await requestSessionRefresh(apiToken)
        if (!renewed || cancelled) return
        const recheck = await fetch(`${config.apiUrl}/api/auth/session`, {
          headers: { 'Authorization': `Bearer ${renewed}` },
        }).catch(() => null)
        if (recheck?.status === 401) redirectToLogin()
      })
      .catch((err: unknown) => {
        // Network error — don't sign out, could be offline. Still log it so
        // persistent failures show up in browser console / monitoring instead
        // of silently disappearing.
        if (err instanceof Error && err.name === 'AbortError') return
        console.warn('SessionValidator: failed to verify session', err)
      })

    return () => {
      cancelled = true
      controller.abort()
    }
  }, [status, apiToken, userId])

  // Expiry watchdog: renew shortly before the token runs out, and re-check
  // whenever the tab comes back into view (laptop lid reopened, etc.).
  useEffect(() => {
    if (status !== 'authenticated' || !apiToken) return

    const expiresAt = session?.apiTokenExpiresAt ?? getTokenExpiry(apiToken)
    if (!expiresAt) return

    let timer: ReturnType<typeof setTimeout> | null = null

    const renewIfNeeded = () => {
      if (expiresAt - Date.now() <= RENEW_WHEN_REMAINING_MS) {
        requestSessionRefresh(apiToken)
      }
    }

    const schedule = () => {
      if (timer) clearTimeout(timer)
      // setTimeout overflows past ~24.8 days; clamp and re-evaluate on fire.
      const delay = Math.min(
        Math.max(expiresAt - RENEW_WHEN_REMAINING_MS - Date.now(), 0),
        2 ** 31 - 1
      )
      timer = setTimeout(() => {
        renewIfNeeded()
        if (expiresAt - Date.now() > RENEW_WHEN_REMAINING_MS) schedule()
      }, delay)
    }

    const onVisible = () => {
      if (document.visibilityState === 'visible') renewIfNeeded()
    }

    renewIfNeeded()
    schedule()
    document.addEventListener('visibilitychange', onVisible)
    window.addEventListener('online', renewIfNeeded)
    return () => {
      if (timer) clearTimeout(timer)
      document.removeEventListener('visibilitychange', onVisible)
      window.removeEventListener('online', renewIfNeeded)
    }
  }, [status, apiToken, session?.apiTokenExpiresAt])

  return null
}
