'use client'

import { useState, useEffect } from 'react'
import { useSession } from 'next-auth/react'
import { useSearchParams, redirect } from 'next/navigation'
import { apiFetch } from '@/lib/api'
import { SiteNav } from '@/components/SiteNav'
import { UserBadges } from '@/components/UserBadges'

interface MembershipData {
  tier: 'free' | 'supporter'
  badges: string[]
  membership: {
    tier: string
    status: string
    currentPeriodEnd: string | null
    cancelAtPeriodEnd: boolean
  } | null
}

export default function MembershipPage() {
  const { data: session, status, update: updateSession } = useSession()
  const searchParams = useSearchParams()
  const [membershipData, setMembershipData] = useState<MembershipData | null>(null)
  const [loading, setLoading] = useState(true)
  const [billingPeriod, setBillingPeriod] = useState<'monthly' | 'yearly'>('monthly')
  const [checkoutLoading, setCheckoutLoading] = useState(false)
  const [portalLoading, setPortalLoading] = useState(false)
  const [successMessage, setSuccessMessage] = useState<string | null>(null)

  const upgraded = searchParams.get('upgraded')

  useEffect(() => {
    if (upgraded === 'true') {
      setSuccessMessage('Welcome to Supporter! Your membership is now active.')
      // Refresh session to pick up new tier
      updateSession({ membershipTier: 'supporter' })
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [upgraded])

  useEffect(() => {
    if (session?.apiToken) {
      loadMembership()
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session?.apiToken])

  const loadMembership = async () => {
    if (!session?.apiToken) return
    try {
      const res = await apiFetch('/api/membership', session.apiToken)
      if (res.ok) {
        const data = await res.json()
        setMembershipData(data)
      }
    } catch (err) {
      console.error('Failed to load membership:', err)
    } finally {
      setLoading(false)
    }
  }

  const handleUpgrade = async () => {
    if (!session?.apiToken) return
    setCheckoutLoading(true)
    try {
      const res = await apiFetch('/api/membership/checkout', session.apiToken, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ billingPeriod }),
      })
      if (res.ok) {
        const { checkoutUrl } = await res.json()
        if (checkoutUrl) window.location.href = checkoutUrl
      } else {
        const data = await res.json().catch(() => ({}))
        alert(data.error || 'Failed to start checkout')
      }
    } catch {
      alert('Failed to start checkout')
    } finally {
      setCheckoutLoading(false)
    }
  }

  const handleManage = async () => {
    if (!session?.apiToken) return
    setPortalLoading(true)
    try {
      const res = await apiFetch('/api/membership/portal', session.apiToken, {
        method: 'POST',
      })
      if (res.ok) {
        const { url } = await res.json()
        if (url) window.location.href = url
      } else {
        const data = await res.json().catch(() => ({}))
        alert(data.error || 'Failed to open billing portal')
      }
    } catch {
      alert('Failed to open billing portal')
    } finally {
      setPortalLoading(false)
    }
  }

  if (status === 'loading' || loading) {
    return (
      <div className="min-h-screen bg-gray-50 dark:bg-gray-950">
        <SiteNav />
        <div className="max-w-4xl mx-auto px-4 py-12">
          <div className="animate-pulse space-y-6">
            <div className="h-8 bg-gray-200 dark:bg-gray-800 rounded w-48" />
            <div className="h-64 bg-gray-200 dark:bg-gray-800 rounded-xl" />
          </div>
        </div>
      </div>
    )
  }

  if (!session?.user) {
    redirect('/login')
  }

  const isSupporter = membershipData?.tier === 'supporter'

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-950">
      <SiteNav />

      <div className="max-w-4xl mx-auto px-4 py-8 animate-fade-in">
        <h1 className="font-display text-3xl font-bold text-gray-900 dark:text-gray-100 mb-2">
          Membership
        </h1>
        <p className="text-gray-500 dark:text-gray-400 mb-8">
          Support Bobbinry and unlock higher limits
        </p>

        {successMessage && (
          <div className="bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-lg p-4 mb-6">
            <p className="text-sm text-green-700 dark:text-green-300">{successMessage}</p>
          </div>
        )}

        {/* Current status for supporters */}
        {isSupporter && membershipData?.membership && (
          <div className="bg-purple-50 dark:bg-purple-900/20 border border-purple-200 dark:border-purple-800 rounded-xl p-6 mb-8">
            <div className="flex items-center justify-between">
              <div>
                <div className="flex items-center gap-2 mb-1">
                  <h2 className="font-display text-lg font-semibold text-purple-900 dark:text-purple-100">
                    Supporter
                  </h2>
                  <UserBadges badges={membershipData.badges} size="md" />
                </div>
                <p className="text-sm text-purple-700 dark:text-purple-300">
                  {membershipData.membership.cancelAtPeriodEnd
                    ? `Access until ${new Date(membershipData.membership.currentPeriodEnd!).toLocaleDateString()}`
                    : `Renews ${new Date(membershipData.membership.currentPeriodEnd!).toLocaleDateString()}`
                  }
                </p>
              </div>
              <button
                onClick={handleManage}
                disabled={portalLoading}
                className="px-4 py-2 text-sm font-medium bg-purple-600 text-white rounded-lg hover:bg-purple-700 disabled:opacity-50 transition-colors"
              >
                {portalLoading ? 'Loading...' : 'Manage Billing'}
              </button>
            </div>
          </div>
        )}

        {/* Comparison table */}
        <div className="grid md:grid-cols-2 gap-6 mb-8">
          {/* Free */}
          <div className={`bg-white dark:bg-gray-900 rounded-xl border-2 p-6 ${
            !isSupporter
              ? 'border-gray-300 dark:border-gray-600'
              : 'border-gray-200 dark:border-gray-800'
          }`}>
            <h3 className="font-display text-xl font-bold text-gray-900 dark:text-gray-100 mb-1">Free</h3>
            <p className="text-sm text-gray-500 dark:text-gray-400 mb-6">Get started writing</p>

            <ul className="space-y-3 text-sm text-gray-700 dark:text-gray-300">
              <li className="flex items-center gap-2">
                <CheckIcon />
                Up to 3 projects
              </li>
              <li className="flex items-center gap-2">
                <CheckIcon />
                Standard upload limits
              </li>
              <li className="flex items-center gap-2">
                <CheckIcon />
                Public profile & explore listing
              </li>
              <li className="flex items-center gap-2">
                <CheckIcon />
                All bobbins & features
              </li>
            </ul>

            {!isSupporter && (
              <div className="mt-6 text-center">
                <span className="inline-block px-4 py-2 text-sm font-medium text-gray-500 dark:text-gray-400 bg-gray-100 dark:bg-gray-800 rounded-lg">
                  Current Plan
                </span>
              </div>
            )}
          </div>

          {/* Supporter */}
          <div className={`bg-white dark:bg-gray-900 rounded-xl border-2 p-6 ${
            isSupporter
              ? 'border-purple-400 dark:border-purple-600'
              : 'border-purple-300 dark:border-purple-700'
          }`}>
            <div className="flex items-center gap-2 mb-1">
              <h3 className="font-display text-xl font-bold text-gray-900 dark:text-gray-100">Supporter</h3>
              <span className="text-[10px] px-1.5 py-0.5 rounded-full font-medium bg-purple-100 dark:bg-purple-900/40 text-purple-800 dark:text-purple-300">
                Supporter
              </span>
            </div>
            <p className="text-sm text-gray-500 dark:text-gray-400 mb-6">For serious writers & worldbuilders</p>

            <ul className="space-y-3 text-sm text-gray-700 dark:text-gray-300">
              <li className="flex items-center gap-2">
                <CheckIcon className="text-purple-500" />
                <strong>Up to 25 projects</strong>
              </li>
              <li className="flex items-center gap-2">
                <CheckIcon className="text-purple-500" />
                <strong>2x upload size limits</strong>
              </li>
              <li className="flex items-center gap-2">
                <CheckIcon className="text-purple-500" />
                Boosted explore ranking
              </li>
              <li className="flex items-center gap-2">
                <CheckIcon className="text-purple-500" />
                Supporter badge on profile
              </li>
            </ul>

            {!isSupporter && (
              <div className="mt-6 space-y-3">
                {/* Billing toggle */}
                <div className="flex items-center justify-center gap-3 text-sm">
                  <button
                    onClick={() => setBillingPeriod('monthly')}
                    className={`px-3 py-1.5 rounded-lg transition-colors ${
                      billingPeriod === 'monthly'
                        ? 'bg-purple-100 dark:bg-purple-900/40 text-purple-700 dark:text-purple-300 font-medium'
                        : 'text-gray-500 dark:text-gray-400 hover:text-gray-700'
                    }`}
                  >
                    Monthly
                  </button>
                  <button
                    onClick={() => setBillingPeriod('yearly')}
                    className={`px-3 py-1.5 rounded-lg transition-colors ${
                      billingPeriod === 'yearly'
                        ? 'bg-purple-100 dark:bg-purple-900/40 text-purple-700 dark:text-purple-300 font-medium'
                        : 'text-gray-500 dark:text-gray-400 hover:text-gray-700'
                    }`}
                  >
                    Yearly
                  </button>
                </div>

                <button
                  onClick={handleUpgrade}
                  disabled={checkoutLoading}
                  className="w-full px-4 py-2.5 text-sm font-medium bg-purple-600 text-white rounded-lg hover:bg-purple-700 disabled:opacity-50 transition-colors"
                >
                  {checkoutLoading ? 'Redirecting...' : 'Upgrade Now'}
                </button>
              </div>
            )}

            {isSupporter && (
              <div className="mt-6 text-center">
                <span className="inline-block px-4 py-2 text-sm font-medium text-purple-700 dark:text-purple-300 bg-purple-100 dark:bg-purple-900/40 rounded-lg">
                  Current Plan
                </span>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

function CheckIcon({ className = 'text-green-500' }: { className?: string }) {
  return (
    <svg className={`w-4 h-4 flex-shrink-0 ${className}`} fill="currentColor" viewBox="0 0 20 20">
      <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
    </svg>
  )
}
