'use client'

import { useState, useEffect, Suspense } from 'react'
import { useSession } from 'next-auth/react'
import { useSearchParams } from 'next/navigation'
import { redirect } from 'next/navigation'
import Link from 'next/link'
import { apiFetch } from '@/lib/api'
import { SiteNav } from '@/components/SiteNav'
import { OptimizedImage } from '@/components/OptimizedImage'

interface SubscriptionData {
  subscription: {
    id: string
    subscriberId: string
    authorId: string
    tierId: string
    status: string
    currentPeriodStart: string
    currentPeriodEnd: string
    cancelAtPeriodEnd: boolean
    stripeSubscriptionId: string | null
  }
  tier: {
    id: string
    name: string
    priceMonthly: string | null
    priceYearly: string | null
  } | null
  author: {
    id: string
    name: string | null
    email: string | null
    image: string | null
  } | null
}

export default function SubscriptionsPage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen bg-gray-50 dark:bg-gray-950">
        <SiteNav />
        <div className="max-w-4xl mx-auto px-4 py-8">
          <div className="animate-pulse space-y-4">
            <div className="h-7 bg-gray-200 dark:bg-gray-800 rounded w-48" />
            <div className="h-32 bg-gray-200 dark:bg-gray-800 rounded-xl" />
            <div className="h-32 bg-gray-200 dark:bg-gray-800 rounded-xl" />
          </div>
        </div>
      </div>
    }>
      <SubscriptionsContent />
    </Suspense>
  )
}

function SubscriptionsContent() {
  const { data: session, status } = useSession()
  const searchParams = useSearchParams()
  const [subscriptions, setSubscriptions] = useState<SubscriptionData[]>([])
  const [loading, setLoading] = useState(true)
  const [portalLoading, setPortalLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [justSubscribed, setJustSubscribed] = useState(false)

  const apiToken = (session as any)?.apiToken as string | undefined

  useEffect(() => {
    if (searchParams.get('subscribed') === 'true') {
      setJustSubscribed(true)
    }
  }, [searchParams])

  useEffect(() => {
    if (session?.user?.id && apiToken) {
      loadSubscriptions()
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session?.user?.id, apiToken])

  const loadSubscriptions = async () => {
    if (!session?.user?.id || !apiToken) return
    setLoading(true)
    try {
      const res = await apiFetch(`/api/users/${session.user.id}/subscriptions`, apiToken)
      if (res.ok) {
        const data = await res.json()
        setSubscriptions(data.subscriptions || [])
      }
    } catch {
      setError('Failed to load subscriptions')
    } finally {
      setLoading(false)
    }
  }

  const handleManageBilling = async (subscriptionId: string) => {
    if (!session?.user?.id || !apiToken) return
    setPortalLoading(true)
    setError(null)
    try {
      const res = await apiFetch('/api/subscribe/portal-session', apiToken, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId: session.user.id,
          subscriptionId,
          returnUrl: `${window.location.origin}/settings/subscriptions`
        })
      })
      if (res.ok) {
        const data = await res.json()
        if (data.url) {
          window.location.href = data.url
          return
        }
      } else {
        const data = await res.json()
        setError(data.error || 'Failed to open billing portal')
      }
    } catch {
      setError('Failed to open billing portal')
    } finally {
      setPortalLoading(false)
    }
  }

  if (status === 'loading' || loading) {
    return (
      <div className="min-h-screen bg-gray-50 dark:bg-gray-950">
        <SiteNav />
        <header className="bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700">
          <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-4">
            <div className="h-7 bg-gray-100 dark:bg-gray-700 rounded w-48 animate-pulse" />
          </div>
        </header>
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
          <div className="space-y-4">
            {[1, 2].map(i => (
              <div key={i} className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-6 animate-pulse">
                <div className="h-5 bg-gray-100 dark:bg-gray-700 rounded w-32 mb-3" />
                <div className="h-4 bg-gray-100 dark:bg-gray-700 rounded w-48" />
              </div>
            ))}
          </div>
        </div>
      </div>
    )
  }

  if (!session?.user) {
    redirect('/login')
  }

  const activeSubscriptions = subscriptions.filter(s => s.subscription.status === 'active' || s.subscription.status === 'past_due')
  const inactiveSubscriptions = subscriptions.filter(s => s.subscription.status !== 'active' && s.subscription.status !== 'past_due')

  const statusColors: Record<string, string> = {
    active: 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400',
    past_due: 'bg-yellow-100 dark:bg-yellow-900/30 text-yellow-700 dark:text-yellow-400',
    canceled: 'bg-gray-100 dark:bg-gray-700 text-gray-500 dark:text-gray-400',
    expired: 'bg-gray-100 dark:bg-gray-700 text-gray-500 dark:text-gray-400',
  }

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-950">
      <SiteNav />

      <header className="bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-4">
          <div className="flex items-center gap-2 text-sm text-gray-500 dark:text-gray-400 mb-1">
            <Link href="/settings" className="hover:text-gray-900 dark:hover:text-gray-100 transition-colors">Settings</Link>
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" /></svg>
            <span className="text-gray-900 dark:text-gray-100">Subscriptions</span>
          </div>
          <h1 className="font-display text-2xl font-bold text-gray-900 dark:text-gray-100">Your Subscriptions</h1>
        </div>
      </header>

      <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-6 animate-fade-in">
        {justSubscribed && (
          <div className="bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-lg p-4">
            <p className="text-sm text-green-700 dark:text-green-300 font-medium">
              Subscription activated! You now have access to subscriber content.
            </p>
          </div>
        )}

        {error && (
          <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-4">
            <p className="text-sm text-red-700 dark:text-red-300">{error}</p>
          </div>
        )}

        {subscriptions.length === 0 ? (
          <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-200 dark:border-gray-700 p-8 text-center">
            <svg className="w-12 h-12 text-gray-300 dark:text-gray-600 mx-auto mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4.318 6.318a4.5 4.5 0 000 6.364L12 20.364l7.682-7.682a4.5 4.5 0 00-6.364-6.364L12 7.636l-1.318-1.318a4.5 4.5 0 00-6.364 0z" />
            </svg>
            <h3 className="text-lg font-medium text-gray-900 dark:text-gray-100 mb-2">No subscriptions yet</h3>
            <p className="text-sm text-gray-500 dark:text-gray-400 mb-4">
              Subscribe to your favorite authors to support their work and get early access to new chapters.
            </p>
            <Link
              href="/explore"
              className="inline-flex px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors text-sm font-medium"
            >
              Discover Authors
            </Link>
          </div>
        ) : (
          <>
            {/* Active subscriptions */}
            {activeSubscriptions.length > 0 && (
              <div>
                <h2 className="text-sm font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-3">
                  Active ({activeSubscriptions.length})
                </h2>
                <div className="space-y-3">
                  {activeSubscriptions.map(({ subscription, tier, author }) => (
                    <div key={subscription.id} className="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-200 dark:border-gray-700 p-5">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-4">
                          {author?.image ? (
                            <OptimizedImage
                              src={author.image}
                              variant="thumb"
                              alt={author.name || 'Author'}
                              className="w-10 h-10 rounded-full object-cover"
                            />
                          ) : (
                            <div className="w-10 h-10 rounded-full bg-blue-600 flex items-center justify-center text-white font-bold">
                              {(author?.name || '?').charAt(0).toUpperCase()}
                            </div>
                          )}
                          <div>
                            <h3 className="font-medium text-gray-900 dark:text-gray-100">
                              {author?.name || 'Unknown Author'}
                            </h3>
                            <div className="flex items-center gap-2 mt-0.5">
                              <span className="text-sm text-gray-500 dark:text-gray-400">
                                {tier?.name || 'Tier'}
                              </span>
                              {tier?.priceMonthly && (
                                <>
                                  <span className="text-gray-300 dark:text-gray-600">·</span>
                                  <span className="text-sm font-medium text-gray-700 dark:text-gray-300">
                                    ${tier.priceMonthly}/mo
                                  </span>
                                </>
                              )}
                            </div>
                          </div>
                        </div>
                        <div className="flex items-center gap-3">
                          <span className={`text-xs px-2 py-1 rounded-full font-medium ${statusColors[subscription.status] || statusColors.expired}`}>
                            {subscription.status === 'active' ? 'Active' :
                             subscription.status === 'past_due' ? 'Past Due' :
                             subscription.status.charAt(0).toUpperCase() + subscription.status.slice(1)}
                          </span>
                        </div>
                      </div>
                      <div className="flex items-center justify-between mt-3 pt-3 border-t border-gray-100 dark:border-gray-700">
                        <p className="text-xs text-gray-500 dark:text-gray-400">
                          {subscription.cancelAtPeriodEnd
                            ? `Cancels ${new Date(subscription.currentPeriodEnd).toLocaleDateString()}`
                            : `Renews ${new Date(subscription.currentPeriodEnd).toLocaleDateString()}`}
                        </p>
                        {subscription.stripeSubscriptionId && (
                          <button
                            onClick={() => handleManageBilling(subscription.id)}
                            disabled={portalLoading}
                            className="text-sm text-blue-600 dark:text-blue-400 hover:underline disabled:opacity-50"
                          >
                            {portalLoading ? 'Opening...' : 'Manage Billing'}
                          </button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Inactive subscriptions */}
            {inactiveSubscriptions.length > 0 && (
              <div>
                <h2 className="text-sm font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-3">
                  Past ({inactiveSubscriptions.length})
                </h2>
                <div className="space-y-3">
                  {inactiveSubscriptions.map(({ subscription, tier, author }) => (
                    <div key={subscription.id} className="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-200 dark:border-gray-700 p-5 opacity-60">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-4">
                          <div className="w-10 h-10 rounded-full bg-gray-200 dark:bg-gray-700 flex items-center justify-center text-gray-500 dark:text-gray-400 font-bold">
                            {(author?.name || '?').charAt(0).toUpperCase()}
                          </div>
                          <div>
                            <h3 className="font-medium text-gray-900 dark:text-gray-100">
                              {author?.name || 'Unknown Author'}
                            </h3>
                            <span className="text-sm text-gray-500 dark:text-gray-400">
                              {tier?.name || 'Tier'}
                            </span>
                          </div>
                        </div>
                        <span className={`text-xs px-2 py-1 rounded-full font-medium ${statusColors[subscription.status] || statusColors.expired}`}>
                          {subscription.status.charAt(0).toUpperCase() + subscription.status.slice(1)}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}
