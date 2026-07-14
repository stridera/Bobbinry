'use client'

/**
 * Beta reader invite landing page.
 *
 * Authors share /beta-invite/<token> links (created on /settings/beta-readers).
 * Anyone opening the link sees who invited them and to what; signed-out
 * visitors are routed through login/signup with a callbackUrl pointing back
 * here, then accept to enroll as a beta reader.
 */

import { useState, useEffect, useCallback } from 'react'
import { useParams } from 'next/navigation'
import { useSession } from 'next-auth/react'
import Link from 'next/link'
import { config } from '@/lib/config'
import { apiFetch } from '@/lib/api'
import { SiteNav } from '@/components/SiteNav'

interface InvitePreview {
  status: 'valid' | 'revoked' | 'full'
  accessLevel: string
  author: {
    username: string | null
    displayName: string | null
  }
  project: {
    name: string | null
    coverImage: string | null
    shortUrl: string | null
  } | null
}

const ACCESS_LABELS: Record<string, string> = {
  beta: 'Beta Reader',
  arc: 'ARC Reader',
  early_access: 'Early Access'
}

export default function BetaInvitePage() {
  const params = useParams<{ token: string }>()
  const token = params.token
  const { data: session, status: sessionStatus } = useSession()

  const [preview, setPreview] = useState<InvitePreview | null>(null)
  const [notFound, setNotFound] = useState(false)
  const [loading, setLoading] = useState(true)
  const [redeeming, setRedeeming] = useState(false)
  const [redeemed, setRedeemed] = useState(false)
  const [alreadyMember, setAlreadyMember] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const apiToken = (session as any)?.apiToken as string | undefined

  useEffect(() => {
    if (!token) return
    ;(async () => {
      try {
        const res = await fetch(`${config.apiUrl}/api/public/beta-invites/${encodeURIComponent(token)}`)
        if (res.status === 404) {
          setNotFound(true)
        } else if (res.ok) {
          const data = await res.json()
          setPreview(data)
        } else {
          setError('Failed to load invite. Please try again.')
        }
      } catch {
        setError('Failed to load invite. Please try again.')
      } finally {
        setLoading(false)
      }
    })()
  }, [token])

  const acceptInvite = useCallback(async () => {
    if (!apiToken) return
    setRedeeming(true)
    setError(null)
    try {
      const res = await apiFetch(`/api/beta-invites/${encodeURIComponent(token)}/redeem`, apiToken, {
        method: 'POST'
      })
      if (res.ok) {
        const data = await res.json()
        setRedeemed(true)
        setAlreadyMember(!!data.alreadyMember)
      } else {
        const data = await res.json().catch(() => ({}))
        setError(data.error || 'Failed to accept the invitation.')
      }
    } catch {
      setError('Failed to accept the invitation.')
    } finally {
      setRedeeming(false)
    }
  }, [apiToken, token])

  const invitePath = `/beta-invite/${token}`
  const authorName = preview?.author.displayName
    || (preview?.author.username ? `@${preview.author.username}` : 'An author')
  const scopeText = preview?.project ? preview.project.name : 'all of their projects'
  const readerHref = preview?.project?.shortUrl && preview.author.username
    ? `/read/${preview.author.username}/${preview.project.shortUrl}`
    : null

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-950">
      <SiteNav />

      <div className="max-w-lg mx-auto px-4 py-16">
        <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-200 dark:border-gray-700 p-8 text-center">
          {(loading || sessionStatus === 'loading') && (
            <p className="text-gray-500 dark:text-gray-400">Loading invitation...</p>
          )}

          {!loading && sessionStatus !== 'loading' && notFound && (
            <>
              <h1 className="font-display text-xl font-bold text-gray-900 dark:text-gray-100 mb-2">
                Invite not found
              </h1>
              <p className="text-sm text-gray-500 dark:text-gray-400">
                This invite link doesn&rsquo;t exist. Double-check the URL or ask the author for a new link.
              </p>
            </>
          )}

          {!loading && sessionStatus !== 'loading' && preview && !redeemed && (
            <>
              {preview.project?.coverImage && (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={preview.project.coverImage}
                  alt=""
                  className="w-20 h-28 object-cover rounded-lg mx-auto mb-4 shadow"
                />
              )}
              <h1 className="font-display text-xl font-bold text-gray-900 dark:text-gray-100 mb-2">
                {authorName} invited you to beta read
              </h1>
              <p className="text-sm text-gray-500 dark:text-gray-400 mb-1">
                {preview.project
                  ? <>You&rsquo;re invited to read <strong className="text-gray-700 dark:text-gray-200">{preview.project.name}</strong></>
                  : <>You&rsquo;re invited to read <strong className="text-gray-700 dark:text-gray-200">all of {authorName}&rsquo;s projects</strong></>}
              </p>
              <p className="mb-6">
                <span className="inline-block px-2 py-0.5 bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 text-xs rounded">
                  {ACCESS_LABELS[preview.accessLevel] || preview.accessLevel}
                </span>
              </p>

              {preview.status === 'revoked' && (
                <p className="text-sm text-amber-600 dark:text-amber-400">
                  This invite link has been revoked by the author. Ask them for a new one.
                </p>
              )}

              {preview.status === 'full' && (
                <p className="text-sm text-amber-600 dark:text-amber-400">
                  This invite link has reached its maximum number of uses. Ask the author for a new one.
                </p>
              )}

              {preview.status === 'valid' && (
                <>
                  {error && (
                    <p className="text-sm text-red-600 dark:text-red-400 mb-4">{error}</p>
                  )}

                  {session?.user ? (
                    <button
                      onClick={acceptInvite}
                      disabled={redeeming}
                      className="px-6 py-2.5 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors text-sm font-medium disabled:opacity-50"
                    >
                      {redeeming ? 'Accepting...' : 'Accept Invitation'}
                    </button>
                  ) : (
                    <div className="space-y-3">
                      <p className="text-sm text-gray-500 dark:text-gray-400">
                        Sign in or create a free account to accept.
                      </p>
                      <div className="flex justify-center gap-3">
                        <Link
                          href={`/login?callbackUrl=${encodeURIComponent(invitePath)}`}
                          className="px-5 py-2.5 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors text-sm font-medium"
                        >
                          Log in
                        </Link>
                        <Link
                          href={`/signup?callbackUrl=${encodeURIComponent(invitePath)}`}
                          className="px-5 py-2.5 border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-200 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors text-sm font-medium"
                        >
                          Create account
                        </Link>
                      </div>
                    </div>
                  )}
                </>
              )}
            </>
          )}

          {redeemed && (
            <>
              <h1 className="font-display text-xl font-bold text-gray-900 dark:text-gray-100 mb-2">
                {alreadyMember ? 'You already have access!' : 'Welcome aboard!'}
              </h1>
              <p className="text-sm text-gray-500 dark:text-gray-400 mb-6">
                {preview?.project
                  ? <>You&rsquo;re a beta reader for <strong className="text-gray-700 dark:text-gray-200">{scopeText}</strong>.</>
                  : <>You&rsquo;re a beta reader for all of {authorName}&rsquo;s projects.</>}
                {' '}You&rsquo;ll find it under Beta Reading in your library.
              </p>
              <div className="flex justify-center gap-3">
                {readerHref && (
                  <Link
                    href={readerHref}
                    className="px-5 py-2.5 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors text-sm font-medium"
                  >
                    Start Reading
                  </Link>
                )}
                <Link
                  href="/library"
                  className={readerHref
                    ? 'px-5 py-2.5 border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-200 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors text-sm font-medium'
                    : 'px-5 py-2.5 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors text-sm font-medium'}
                >
                  Go to My Library
                </Link>
              </div>
            </>
          )}

          {!loading && sessionStatus !== 'loading' && !preview && !notFound && error && (
            <p className="text-sm text-red-600 dark:text-red-400">{error}</p>
          )}
        </div>
      </div>
    </div>
  )
}
