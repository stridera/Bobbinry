'use client'

import { useEffect, useRef, Suspense } from 'react'
import { usePathname, useSearchParams } from 'next/navigation'
import { useSession } from 'next-auth/react'
import posthog from 'posthog-js'
import { setAnalyticsSink, trackEvent } from '@bobbinry/sdk'
import { config } from '@/lib/config'

/**
 * OAuth signups are only distinguishable from OAuth logins inside the NextAuth
 * signIn callback, which surfaces the fact as session.user.isNewUser. That flag
 * lives on the JWT for the token's lifetime, so it would re-fire on every load
 * — hence a durable per-user marker rather than an in-memory guard.
 */
function markSignupTracked(userId: string): boolean {
  const key = `bobbinry:signup-tracked:${userId}`
  try {
    if (window.localStorage.getItem(key)) return false
    window.localStorage.setItem(key, '1')
    return true
  } catch {
    // Private mode / storage disabled: skip rather than risk a duplicate.
    return false
  }
}

/**
 * Product analytics wiring.
 *
 * Owns the only PostHog import in the codebase — everywhere else reports via
 * the vendor-neutral trackEvent from @bobbinry/sdk, so swapping vendors means
 * editing this file and nothing else.
 *
 * Privacy posture: persistence is in-memory and person profiles are created
 * for identified users only. Anonymous visitors therefore get no cookies and
 * no stored identifier, which keeps us out of consent-banner territory, while
 * signed-in users still get the durable identity that retention cohorts need.
 * The cost is that we can't stitch one anonymous visitor across sessions.
 */

function AnalyticsInner() {
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const { data: session, status } = useSession()
  const identifiedRef = useRef<string | null>(null)

  // Init once, and register the SDK sink so bobbins can report events too.
  useEffect(() => {
    if (!config.posthogKey) return

    posthog.init(config.posthogKey, {
      api_host: config.posthogHost,
      persistence: 'memory',
      person_profiles: 'identified_only',
      // Pageviews are captured manually below — the App Router does client-side
      // navigation, which the automatic capture doesn't see.
      capture_pageview: false,
      capture_pageleave: true,
      // Off deliberately. Autocapture records the text of whatever the user
      // clicked, which on a reading site means story and chapter titles ending
      // up in an analytics vendor — exactly the content the explicit events
      // below are careful to send only as ids.
      autocapture: false,
    })

    setAnalyticsSink((name, props) => posthog.capture(name, props))

    return () => setAnalyticsSink(null)
  }, [])

  // Capture a pageview on every route change, including client-side ones.
  useEffect(() => {
    if (!config.posthogKey || !pathname) return

    const query = searchParams?.toString()
    posthog.capture('$pageview', {
      $current_url: `${window.location.origin}${pathname}${query ? `?${query}` : ''}`,
    })
  }, [pathname, searchParams])

  // Tie events to a stable person once signed in. We send the user id only —
  // never the email — so PostHog holds no directly identifying data.
  useEffect(() => {
    if (!config.posthogKey) return

    if (status === 'authenticated' && session?.user?.id) {
      if (identifiedRef.current !== session.user.id) {
        identifiedRef.current = session.user.id
        posthog.identify(session.user.id)
      }

      // Credentials signups fire this from the signup form directly; OAuth
      // redirects away before that can run, so it lands here instead. Kept
      // outside the identify guard so a late-arriving flag still counts.
      if (session.user.isNewUser && markSignupTracked(session.user.id)) {
        trackEvent('signup_completed', { method: 'oauth' })
      }
      return
    }

    // Signed out: drop the identity so the next user on this device doesn't
    // inherit the previous one's person profile.
    if (status === 'unauthenticated' && identifiedRef.current) {
      identifiedRef.current = null
      posthog.reset()
    }
  }, [status, session?.user?.id, session?.user?.isNewUser])

  return null
}

export function AnalyticsProvider() {
  // useSearchParams needs a Suspense boundary or it opts the whole tree into
  // client-side rendering.
  return (
    <Suspense fallback={null}>
      <AnalyticsInner />
    </Suspense>
  )
}
