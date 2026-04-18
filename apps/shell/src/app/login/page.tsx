'use client'

import { useState, Suspense } from 'react'
import { signIn } from 'next-auth/react'
import { useRouter, useSearchParams } from 'next/navigation'
import Link from 'next/link'
import { config } from '@/lib/config'
import { GoogleOAuthButton } from '@/components/GoogleOAuthButton'

function LoginForm() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const callbackUrl = searchParams.get('callbackUrl') || '/dashboard'

  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [error, setError] = useState(searchParams.get('error') || '')
  const [loading, setLoading] = useState(false)

  // 2FA state
  const [twoFactorUserId, setTwoFactorUserId] = useState<string | null>(null)
  const [challengeToken, setChallengeToken] = useState<string | null>(null)
  const [totpCode, setTotpCode] = useState('')

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    setLoading(true)

    try {
      // Call API directly to check credentials and detect 2FA
      // (NextAuth v5 doesn't propagate custom error messages from authorize())
      const apiRes = await fetch(`${config.apiUrl}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      })

      if (!apiRes.ok) {
        if (apiRes.status === 429) {
          setError('Too many login attempts. Please try again later.')
        } else {
          setError('Invalid email or password')
        }
        return
      }

      const data = await apiRes.json()

      if (data.requiresTwoFactor) {
        setTwoFactorUserId(data.userId)
        setChallengeToken(data.challengeToken)
        return
      }

      // Credentials valid, no 2FA — create NextAuth session
      const result = await signIn('credentials', {
        email,
        password,
        redirect: false,
      })

      if (result?.error) {
        setError('Login failed. Please try again.')
      } else if (result?.ok) {
        router.push(callbackUrl)
        router.refresh()
      }
    } catch {
      setError('An error occurred. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  const handleTotpSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    setLoading(true)

    try {
      // Verify TOTP code directly with API first
      const verifyRes = await fetch(`${config.apiUrl}/api/auth/totp/verify`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: twoFactorUserId, code: totpCode, challengeToken }),
      })

      if (!verifyRes.ok) {
        setError('Invalid verification code')
        return
      }

      // TOTP verified — create NextAuth session
      const result = await signIn('credentials', {
        email,
        password,
        totpCode,
        userId: twoFactorUserId,
        challengeToken,
        redirect: false,
      })

      if (result?.error) {
        setError('Verification failed. Please try again.')
      } else if (result?.ok) {
        router.push(callbackUrl)
        router.refresh()
      }
    } catch {
      setError('An error occurred. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  // 2FA verification step
  if (twoFactorUserId) {
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
              <div className="text-center mb-6">
                <div className="w-12 h-12 bg-blue-100 dark:bg-blue-900/30 rounded-full flex items-center justify-center mx-auto mb-4">
                  <svg className="w-6 h-6 text-blue-600 dark:text-blue-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
                  </svg>
                </div>
                <h2 className="text-xl font-semibold text-gray-900 dark:text-gray-100">
                  Two-factor authentication
                </h2>
                <p className="text-gray-500 dark:text-gray-400 text-sm mt-1">
                  Enter the code from your authenticator app, or use a backup code.
                </p>
              </div>

              <form onSubmit={handleTotpSubmit} className="space-y-5">
                {error && (
                  <div className="bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-900 text-red-700 dark:text-red-300 px-4 py-3 rounded-lg text-sm">
                    {error}
                  </div>
                )}

                <div>
                  <label htmlFor="totpCode" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">
                    Verification Code
                  </label>
                  <input
                    id="totpCode"
                    type="text"
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    value={totpCode}
                    onChange={(e) => setTotpCode(e.target.value)}
                    required
                    className="w-full px-4 py-2.5 border border-gray-200 dark:border-gray-600 bg-gray-50/50 dark:bg-gray-900/50 rounded-lg text-gray-900 dark:text-gray-100 placeholder-gray-400 dark:placeholder-gray-500 focus:ring-2 focus:ring-blue-500/40 focus:border-blue-500 dark:focus:border-blue-400 transition-colors text-center text-lg tracking-widest font-mono"
                    placeholder="000000"
                    autoFocus
                  />
                </div>

                <button
                  type="submit"
                  disabled={loading}
                  className="w-full bg-blue-600 hover:bg-blue-700 dark:bg-blue-700 dark:hover:bg-blue-600 text-white py-2.5 rounded-lg font-medium disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                >
                  {loading ? 'Verifying...' : 'Verify'}
                </button>
              </form>

              <p className="mt-5 text-center text-sm text-gray-500 dark:text-gray-400">
                <button
                  type="button"
                  onClick={() => {
                    setTwoFactorUserId(null)
                    setChallengeToken(null)
                    setTotpCode('')
                    setError('')
                  }}
                  className="text-blue-600 dark:text-blue-400 hover:text-blue-700 dark:hover:text-blue-300 font-medium"
                >
                  Back to sign in
                </button>
              </p>
            </div>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-gray-50 via-gray-50 to-purple-50 dark:from-gray-950 dark:via-gray-900 dark:to-gray-900 px-4">
      <div className="max-w-md w-full animate-fade-in">
        {/* Branding */}
        <div className="text-center mb-10">
          <h1 className="font-display text-5xl font-bold text-gray-900 dark:text-gray-100 tracking-tight">
            Bobbinry
          </h1>
          <p className="text-gray-500 dark:text-gray-400 mt-3 text-lg italic">
            Where stories take shape
          </p>
        </div>

        {/* Card */}
        <div className="bg-white dark:bg-gray-800 rounded-xl shadow-lg shadow-gray-300/30 dark:shadow-gray-950/50 overflow-hidden border border-gray-200 dark:border-gray-700">
          {/* Decorative top band */}
          <div className="h-1 bg-gradient-to-r from-blue-600 via-purple-400 to-blue-600" />

          <div className="p-8">
            <form onSubmit={handleSubmit} className="space-y-5">
              {error && (
                <div className="bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-900 text-red-700 dark:text-red-300 px-4 py-3 rounded-lg text-sm">
                  {error}
                </div>
              )}

              <div>
                <label htmlFor="email" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">
                  Email
                </label>
                <input
                  id="email"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                  className="w-full px-4 py-2.5 border border-gray-200 dark:border-gray-600 bg-gray-50/50 dark:bg-gray-900/50 rounded-lg text-gray-900 dark:text-gray-100 placeholder-gray-400 dark:placeholder-gray-500 focus:ring-2 focus:ring-blue-500/40 focus:border-blue-500 dark:focus:border-blue-400 transition-colors"
                  placeholder="you@example.com"
                />
              </div>

              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <label htmlFor="password" className="block text-sm font-medium text-gray-700 dark:text-gray-300">
                    Password
                  </label>
                  <Link
                    href="/forgot-password"
                    className="text-xs text-blue-600 dark:text-blue-400 hover:text-blue-700 dark:hover:text-blue-300"
                  >
                    Forgot password?
                  </Link>
                </div>
                <div className="relative">
                  <input
                    id="password"
                    type={showPassword ? 'text' : 'password'}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    required
                    className="w-full px-4 py-2.5 pr-11 border border-gray-200 dark:border-gray-600 bg-gray-50/50 dark:bg-gray-900/50 rounded-lg text-gray-900 dark:text-gray-100 placeholder-gray-400 dark:placeholder-gray-500 focus:ring-2 focus:ring-blue-500/40 focus:border-blue-500 dark:focus:border-blue-400 transition-colors"
                    placeholder="••••••••"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 transition-colors"
                    aria-label={showPassword ? 'Hide password' : 'Show password'}
                  >
                    {showPassword ? (
                      <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M3.98 8.223A10.477 10.477 0 0 0 1.934 12c1.292 4.338 5.31 7.5 10.066 7.5.993 0 1.953-.138 2.863-.395M6.228 6.228A10.451 10.451 0 0 1 12 4.5c4.756 0 8.773 3.162 10.065 7.498a10.522 10.522 0 0 1-4.293 5.774M6.228 6.228 3 3m3.228 3.228 3.65 3.65m7.894 7.894L21 21m-3.228-3.228-3.65-3.65m0 0a3 3 0 1 0-4.243-4.243m4.242 4.242L9.88 9.88" />
                      </svg>
                    ) : (
                      <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M2.036 12.322a1.012 1.012 0 0 1 0-.639C3.423 7.51 7.36 4.5 12 4.5c4.638 0 8.573 3.007 9.963 7.178.07.207.07.431 0 .639C20.577 16.49 16.64 19.5 12 19.5c-4.638 0-8.573-3.007-9.963-7.178Z" />
                        <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z" />
                      </svg>
                    )}
                  </button>
                </div>
              </div>

              <button
                type="submit"
                disabled={loading}
                className="w-full bg-blue-600 hover:bg-blue-700 dark:bg-blue-700 dark:hover:bg-blue-600 text-white py-2.5 rounded-lg font-medium disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                {loading ? 'Signing in...' : 'Sign In'}
              </button>
            </form>

            <p className="mt-5 text-center text-sm text-gray-500 dark:text-gray-400">
              Don&apos;t have an account?{' '}
              <Link href="/signup" className="text-blue-600 dark:text-blue-400 hover:text-blue-700 dark:hover:text-blue-300 font-medium">
                Create one
              </Link>
            </p>

            <GoogleOAuthButton callbackUrl={callbackUrl} />
          </div>
        </div>
      </div>
    </div>
  )
}

export default function LoginPage() {
  return (
    <Suspense>
      <LoginForm />
    </Suspense>
  )
}
