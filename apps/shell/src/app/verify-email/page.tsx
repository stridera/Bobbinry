'use client'

import { Suspense, useState, useEffect, useCallback } from 'react'
import { useSearchParams, useRouter } from 'next/navigation'
import { useSession } from 'next-auth/react'
import Link from 'next/link'
import { config } from '@/lib/config'

export default function VerifyEmailPage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-gray-50 via-gray-50 to-purple-50 dark:from-gray-950 dark:via-gray-900 dark:to-gray-900 px-4">
        <div className="animate-spin w-8 h-8 border-2 border-blue-600 border-t-transparent rounded-full" />
      </div>
    }>
      <VerifyEmailContent />
    </Suspense>
  )
}

function VerifyEmailContent() {
  const searchParams = useSearchParams()
  const router = useRouter()
  const { data: session, update: updateSession } = useSession()
  const token = searchParams.get('token')

  const [status, setStatus] = useState<'verifying' | 'success' | 'error' | 'check-email'>('check-email')
  const [error, setError] = useState('')
  const [resending, setResending] = useState(false)
  const [resendSuccess, setResendSuccess] = useState(false)

  const verifyToken = useCallback(async (t: string) => {
    setStatus('verifying')
    try {
      const res = await fetch(`${config.apiUrl}/api/auth/verify-email?token=${encodeURIComponent(t)}`)
      const data = await res.json()

      if (res.ok) {
        setStatus('success')
        // Refresh the session to pick up emailVerified
        await updateSession({ emailVerified: true })
        setTimeout(() => router.push('/dashboard'), 2000)
      } else {
        setStatus('error')
        setError(data.error || 'Verification failed')
      }
    } catch {
      setStatus('error')
      setError('Something went wrong. Please try again.')
    }
  }, [router, updateSession])

  useEffect(() => {
    if (token) {
      verifyToken(token)
    }
  }, [token, verifyToken])

  const handleResend = async () => {
    if (!session?.apiToken) return
    setResending(true)
    setResendSuccess(false)

    try {
      const res = await fetch(`${config.apiUrl}/api/auth/resend-verification`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${session.apiToken}`,
        },
      })

      if (res.ok) {
        setResendSuccess(true)
      } else {
        const data = await res.json()
        setError(data.error || 'Failed to resend')
      }
    } catch {
      setError('Failed to resend verification email')
    } finally {
      setResending(false)
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-gray-50 via-gray-50 to-purple-50 dark:from-gray-950 dark:via-gray-900 dark:to-gray-900 px-4">
      <div className="max-w-md w-full animate-fade-in">
        <div className="text-center mb-10">
          <h1 className="font-display text-5xl font-bold text-gray-900 dark:text-gray-100 tracking-tight">
            Bobbinry
          </h1>
        </div>

        <div className="bg-white dark:bg-gray-800 rounded-xl shadow-lg shadow-gray-300/30 dark:shadow-gray-950/50 overflow-hidden border border-gray-200 dark:border-gray-700">
          <div className="h-1 bg-gradient-to-r from-blue-600 via-purple-400 to-blue-600" />

          <div className="p-8">
            {status === 'verifying' && (
              <div className="text-center">
                <div className="animate-spin w-8 h-8 border-2 border-blue-600 border-t-transparent rounded-full mx-auto mb-4" />
                <h2 className="text-xl font-semibold text-gray-900 dark:text-gray-100 mb-2">
                  Verifying your email...
                </h2>
              </div>
            )}

            {status === 'success' && (
              <div className="text-center">
                <div className="w-12 h-12 bg-green-100 dark:bg-green-900/30 rounded-full flex items-center justify-center mx-auto mb-4">
                  <svg className="w-6 h-6 text-green-600 dark:text-green-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                  </svg>
                </div>
                <h2 className="text-xl font-semibold text-gray-900 dark:text-gray-100 mb-2">
                  Email verified!
                </h2>
                <p className="text-gray-500 dark:text-gray-400">
                  Redirecting to your dashboard...
                </p>
              </div>
            )}

            {status === 'error' && (
              <div className="text-center">
                <div className="w-12 h-12 bg-red-100 dark:bg-red-900/30 rounded-full flex items-center justify-center mx-auto mb-4">
                  <svg className="w-6 h-6 text-red-600 dark:text-red-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </div>
                <h2 className="text-xl font-semibold text-gray-900 dark:text-gray-100 mb-2">
                  Verification failed
                </h2>
                <p className="text-red-600 dark:text-red-400 mb-4">{error}</p>
                {session?.apiToken && (
                  <button
                    onClick={handleResend}
                    disabled={resending}
                    className="text-blue-600 dark:text-blue-400 hover:text-blue-700 dark:hover:text-blue-300 font-medium disabled:opacity-50"
                  >
                    {resending ? 'Sending...' : 'Resend verification email'}
                  </button>
                )}
                {resendSuccess && (
                  <p className="text-green-600 dark:text-green-400 mt-2 text-sm">Verification email sent!</p>
                )}
              </div>
            )}

            {status === 'check-email' && (
              <div className="text-center">
                <div className="w-12 h-12 bg-blue-100 dark:bg-blue-900/30 rounded-full flex items-center justify-center mx-auto mb-4">
                  <svg className="w-6 h-6 text-blue-600 dark:text-blue-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                  </svg>
                </div>
                <h2 className="text-xl font-semibold text-gray-900 dark:text-gray-100 mb-2">
                  Check your email
                </h2>
                <p className="text-gray-500 dark:text-gray-400 mb-6">
                  We sent a verification link to your email address.
                  Click the link to verify your account and unlock all features.
                </p>
                {session?.apiToken && (
                  <>
                    <button
                      onClick={handleResend}
                      disabled={resending}
                      className="text-blue-600 dark:text-blue-400 hover:text-blue-700 dark:hover:text-blue-300 font-medium disabled:opacity-50"
                    >
                      {resending ? 'Sending...' : 'Resend verification email'}
                    </button>
                    {resendSuccess && (
                      <p className="text-green-600 dark:text-green-400 mt-2 text-sm">Verification email sent!</p>
                    )}
                  </>
                )}
                <div className="mt-6">
                  <Link
                    href="/dashboard"
                    className="text-sm text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-300"
                  >
                    Continue to dashboard
                  </Link>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
