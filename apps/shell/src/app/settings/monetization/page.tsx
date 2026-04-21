'use client'

import { useState, useEffect, useCallback, Suspense } from 'react'
import { useSession } from 'next-auth/react'
import { useSearchParams } from 'next/navigation'
import { redirect } from 'next/navigation'
import Link from 'next/link'
import { apiFetch } from '@/lib/api'
import { SiteNav } from '@/components/SiteNav'
import { ConfirmModal } from '@bobbinry/sdk'

interface SubscriptionTier {
  id: string
  name: string
  description: string | null
  priceMonthly: string | null
  priceYearly: string | null
  benefits: string[] | null
  earlyAccessDays: number
  tierLevel: number
  isActive: boolean
}

interface DiscountCode {
  id: string
  code: string
  discountType: string
  discountValue: string
  maxUses: number | null
  currentUses: number
  expiresAt: string | null
  isActive: boolean
  projectId: string | null
}

interface AuthorProject {
  id: string
  title: string
}

interface PaymentConfig {
  stripeAccountId: string | null
  stripeAccountType: string | null
  stripeOnboardingComplete: boolean
  paymentProvider: string
}

const emptyTier = {
  name: '',
  description: '',
  priceMonthly: '',
  priceYearly: '',
  benefits: [] as string[],
  earlyAccessDays: 0,
  tierLevel: 1
}

export default function MonetizationPage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen bg-gray-50 dark:bg-gray-950">
        <SiteNav />
        <div className="max-w-4xl mx-auto px-4 py-12">
          <div className="animate-pulse space-y-6">
            <div className="h-8 bg-gray-200 dark:bg-gray-800 rounded w-48" />
            <div className="h-64 bg-gray-200 dark:bg-gray-800 rounded-xl" />
          </div>
        </div>
      </div>
    }>
      <MonetizationContent />
    </Suspense>
  )
}

function MonetizationContent() {
  const { data: session, status } = useSession()
  const apiToken = session?.apiToken
  const sessionUserId = session?.user?.id
  const searchParams = useSearchParams()
  const [tiers, setTiers] = useState<SubscriptionTier[]>([])
  const [tierUnlocks, setTierUnlocks] = useState<Record<number, { entityCount: number; variantCount: number; sample: string[] }>>({})
  const [discountCodes, setDiscountCodes] = useState<DiscountCode[]>([])
  const [authorProjects, setAuthorProjects] = useState<AuthorProject[]>([])
  const [paymentConfig, setPaymentConfig] = useState<PaymentConfig | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [success, setSuccess] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  // Tier editing
  const [editingTier, setEditingTier] = useState<(typeof emptyTier & { id?: string }) | null>(null)
  const [benefitInput, setBenefitInput] = useState('')

  // Tier deletion
  const [deletingTier, setDeletingTier] = useState<SubscriptionTier | null>(null)

  // Discount code editing
  const [showCodeForm, setShowCodeForm] = useState(false)
  const [codeForm, setCodeForm] = useState({
    code: '',
    discountType: 'percent' as 'percent' | 'fixed_amount' | 'free_trial',
    discountValue: '',
    maxUses: '',
    expiresAt: '',
    projectId: ''
  })

  const loadData = useCallback(async () => {
    if (!apiToken || !sessionUserId) return
    setLoading(true)
    try {
      const [tiersRes, unlocksRes, configRes, codesRes, projectsRes] = await Promise.all([
        apiFetch(`/api/users/${sessionUserId}/subscription-tiers`, apiToken),
        apiFetch(`/api/users/${sessionUserId}/tier-unlocks`, apiToken),
        apiFetch(`/api/users/${sessionUserId}/payment-config`, apiToken),
        apiFetch(`/api/authors/${sessionUserId}/discount-codes`, apiToken),
        apiFetch(`/api/users/me/projects`, apiToken)
      ])

      if (tiersRes.ok) {
        const data = await tiersRes.json()
        setTiers(data.tiers || [])
      }
      if (unlocksRes.ok) {
        const data = await unlocksRes.json()
        const map: Record<number, { entityCount: number; variantCount: number; sample: string[] }> = {}
        for (const row of data.tiers || []) {
          map[row.tierLevel] = {
            entityCount: row.entityCount,
            variantCount: row.variantCount,
            sample: row.sample,
          }
        }
        setTierUnlocks(map)
      }
      if (configRes.ok) {
        const data = await configRes.json()
        setPaymentConfig(data.paymentConfig)
      }
      if (codesRes.ok) {
        const data = await codesRes.json()
        setDiscountCodes(data.discountCodes || [])
      }
      if (projectsRes.ok) {
        const data = await projectsRes.json()
        const projs = (data.projects || []).map((p: any) => ({
          id: p.project.id,
          title: p.project.name
        }))
        setAuthorProjects(projs)
      }
    } catch (err) {
      console.error('Failed to load monetization data:', err)
    } finally {
      setLoading(false)
    }
  }, [apiToken, sessionUserId])

  const verifyOnboarding = useCallback(async () => {
    if (!apiToken || !sessionUserId) return
    try {
      const res = await apiFetch(
        `/api/users/${sessionUserId}/stripe/verify-onboarding`,
        apiToken,
        { method: 'POST' }
      )
      if (res.ok) {
        const data = await res.json()
        if (data.onboardingComplete) {
          setSuccess('Stripe account connected successfully!')
          setTimeout(() => setSuccess(null), 5000)
          await loadData() // Reload to reflect updated payment config
        } else if (data.detailsSubmitted) {
          setSuccess('Stripe onboarding complete! Your account is pending verification by Stripe. This usually takes 1-2 business days.')
          setTimeout(() => setSuccess(null), 10000)
          await loadData()
        }
      }
    } catch {
      // Silently fail - user can manually retry
    }
  }, [apiToken, sessionUserId, loadData])

  useEffect(() => {
    if (sessionUserId && apiToken) {
      loadData().then(() => {
        // After returning from Stripe onboarding, verify the account status
        if (searchParams.get('stripe') === 'complete') {
          verifyOnboarding()
        }
      })
    }
  }, [sessionUserId, apiToken, loadData, verifyOnboarding, searchParams])

  const saveTier = async () => {
    if (!session?.apiToken || !session?.user?.id || !editingTier) return
    setSaving(true)
    setError(null)
    try {
      const tierData = {
        name: editingTier.name,
        description: editingTier.description || undefined,
        priceMonthly: editingTier.priceMonthly || undefined,
        priceYearly: editingTier.priceYearly || undefined,
        benefits: editingTier.benefits,
        earlyAccessDays: String(editingTier.earlyAccessDays),
        tierLevel: String(editingTier.tierLevel)
      }

      let res: Response
      if (editingTier.id) {
        res = await apiFetch(
          `/api/users/${session.user.id}/subscription-tiers/${editingTier.id}`,
          session.apiToken,
          {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(tierData)
          }
        )
      } else {
        res = await apiFetch(
          `/api/users/${session.user.id}/subscription-tiers`,
          session.apiToken,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(tierData)
          }
        )
      }

      if (res.ok) {
        const data = await res.json()
        setEditingTier(null)
        setSuccess('Tier saved!')
        setTimeout(() => setSuccess(null), 3000)
        await loadData()

        // If the API auto-created a Stripe Express account, redirect to onboarding
        if (data.onboardingUrl) {
          window.location.href = data.onboardingUrl
          return
        }
      } else {
        const data = await res.json().catch(() => ({}))
        setError(data.error || 'Failed to save tier')
      }
    } catch {
      setError('Failed to save tier')
    } finally {
      setSaving(false)
    }
  }

  const deleteTier = async (tierId: string) => {
    if (!session?.apiToken || !session?.user?.id) return
    setSaving(true)
    try {
      await apiFetch(
        `/api/users/${session.user.id}/subscription-tiers/${tierId}`,
        session.apiToken,
        { method: 'DELETE' }
      )
      await loadData()
    } catch {
      setError('Failed to delete tier')
    } finally {
      setSaving(false)
      setDeletingTier(null)
    }
  }

  const addBenefit = () => {
    if (!benefitInput.trim() || !editingTier) return
    setEditingTier({
      ...editingTier,
      benefits: [...(editingTier.benefits || []), benefitInput.trim()]
    })
    setBenefitInput('')
  }

  const removeBenefit = (index: number) => {
    if (!editingTier) return
    setEditingTier({
      ...editingTier,
      benefits: editingTier.benefits?.filter((_, i) => i !== index) || []
    })
  }

  const saveDiscountCode = async () => {
    if (!session?.apiToken || !session?.user?.id) return
    setSaving(true)
    setError(null)
    try {
      const res = await apiFetch(
        `/api/authors/${session.user.id}/discount-codes`,
        session.apiToken,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            code: codeForm.code,
            discountType: codeForm.discountType,
            discountValue: codeForm.discountValue,
            maxUses: codeForm.maxUses ? parseInt(codeForm.maxUses) : null,
            expiresAt: codeForm.expiresAt || null,
            projectId: codeForm.projectId || undefined
          })
        }
      )
      if (res.ok) {
        setShowCodeForm(false)
        setCodeForm({ code: '', discountType: 'percent', discountValue: '', maxUses: '', expiresAt: '', projectId: '' })
        setSuccess('Discount code created!')
        setTimeout(() => setSuccess(null), 3000)
        await loadData()
      } else {
        const data = await res.json().catch(() => ({}))
        setError(data.error || 'Failed to create discount code')
      }
    } catch {
      setError('Failed to create discount code')
    } finally {
      setSaving(false)
    }
  }

  const connectStripe = async () => {
    if (!session?.apiToken || !session?.user?.id) return
    try {
      const res = await apiFetch(
        `/api/users/${session.user.id}/stripe/connect`,
        session.apiToken,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            returnUrl: `${window.location.origin}/settings/monetization?stripe=complete`,
            refreshUrl: `${window.location.origin}/settings/monetization?stripe=refresh`
          })
        }
      )
      if (res.ok) {
        const data = await res.json()
        if (data.url) {
          window.location.href = data.url
        }
      }
    } catch {
      setError('Failed to start Stripe onboarding')
    }
  }

  const openStripeDashboard = async () => {
    if (!session?.apiToken || !session?.user?.id) return
    try {
      const res = await apiFetch(
        `/api/users/${session.user.id}/stripe/dashboard-link`,
        session.apiToken
      )
      if (res.ok) {
        const data = await res.json()
        if (data.url) {
          window.open(data.url, '_blank', 'noopener')
        }
      }
    } catch {
      setError('Failed to open Stripe dashboard')
    }
  }

  if (status === 'loading' || loading) {
    return (
      <div className="min-h-screen bg-gray-50 dark:bg-gray-950 flex items-center justify-center">
        <div className="text-gray-500 dark:text-gray-400">Loading...</div>
      </div>
    )
  }

  if (!session?.user) {
    redirect('/login')
  }

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-950">
      <SiteNav />

      {/* Sub-header with breadcrumb */}
      <header className="bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-4">
          <div className="flex items-center gap-2 text-sm text-gray-500 dark:text-gray-400 mb-1">
            <Link href="/settings" className="hover:text-gray-900 dark:hover:text-gray-100 transition-colors">Settings</Link>
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" /></svg>
            <span className="text-gray-900 dark:text-gray-100">Monetization</span>
          </div>
          <h1 className="font-display text-2xl font-bold text-gray-900 dark:text-gray-100">Monetization</h1>
        </div>
      </header>

      <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-6 animate-fade-in">
        {success && (
          <div className="bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-lg p-4">
            <p className="text-sm text-green-700 dark:text-green-300">{success}</p>
          </div>
        )}
        {error && (
          <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-4">
            <p className="text-sm text-red-700 dark:text-red-300">{error}</p>
          </div>
        )}

        {/* Stripe Connect */}
        <div className="bg-white dark:bg-gray-800 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700 p-6">
          <h2 className="font-display text-lg font-semibold text-gray-900 dark:text-gray-100 mb-4">Payment Setup</h2>
          {paymentConfig?.stripeOnboardingComplete ? (
            <div>
              <div className="flex items-center gap-3 mb-3">
                <div className="w-3 h-3 rounded-full bg-green-500" />
                <span className="text-sm text-gray-700 dark:text-gray-300">Stripe account connected</span>
                <span className="text-xs text-gray-400 dark:text-gray-500">({paymentConfig.stripeAccountId})</span>
              </div>
              <button
                onClick={openStripeDashboard}
                className="px-4 py-2.5 bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-300 rounded-lg hover:bg-gray-300 dark:hover:bg-gray-600 transition-colors font-medium text-sm"
              >
                Manage Stripe Account
              </button>
            </div>
          ) : paymentConfig?.stripeAccountId ? (
            <div>
              <div className="flex items-center gap-3 mb-3">
                <div className="w-3 h-3 rounded-full bg-yellow-500" />
                <span className="text-sm text-gray-700 dark:text-gray-300">Stripe account pending verification</span>
              </div>
              <p className="text-sm text-gray-500 dark:text-gray-400 mb-4">
                Your Stripe account has been submitted and is being reviewed. This usually takes 1-2 business days. You&apos;ll be able to receive payments once verification is complete.
              </p>
              <button
                onClick={connectStripe}
                className="px-4 py-2.5 bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-300 rounded-lg hover:bg-gray-300 dark:hover:bg-gray-600 transition-colors font-medium text-sm"
              >
                Continue Stripe Setup
              </button>
            </div>
          ) : (
            <div>
              <p className="text-sm text-gray-500 dark:text-gray-400 mb-4">
                Connect a Stripe account to receive payments from subscribers. Stripe handles all payment processing and payouts.
              </p>
              <button
                onClick={connectStripe}
                className="px-4 py-2.5 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition-colors font-medium text-sm"
              >
                Connect Stripe Account
              </button>
            </div>
          )}
        </div>

        {/* Subscription Tiers */}
        <div className="bg-white dark:bg-gray-800 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700 p-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="font-display text-lg font-semibold text-gray-900 dark:text-gray-100">Subscription Tiers</h2>
            <button
              onClick={() => setEditingTier({ ...emptyTier, tierLevel: tiers.length + 1 })}
              className="px-3 py-1.5 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors text-sm font-medium"
            >
              + Add Tier
            </button>
          </div>

          {tiers.length === 0 && !editingTier && (
            <p className="text-sm text-gray-500 dark:text-gray-400 italic">
              No subscription tiers yet. Create one to let readers support your work.
            </p>
          )}

          {/* Tier list */}
          <div className="space-y-3 mb-4">
            {tiers.map(tier => {
              const unlocks = tierUnlocks[tier.tierLevel]
              return (
                <div key={tier.id} className="flex items-start justify-between gap-3 p-4 bg-gray-50 dark:bg-gray-900/30 rounded-lg border border-gray-100 dark:border-gray-700">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="text-xs bg-gray-200 dark:bg-gray-700 text-gray-600 dark:text-gray-300 px-1.5 py-0.5 rounded">
                        Level {tier.tierLevel}
                      </span>
                      <span className="font-medium text-gray-900 dark:text-gray-100">{tier.name}</span>
                      {!tier.isActive && (
                        <span className="text-xs text-red-500">inactive</span>
                      )}
                    </div>
                    <div className="text-sm text-gray-500 dark:text-gray-400 mt-1">
                      ${tier.priceMonthly || '0'}/mo
                      {tier.priceYearly && ` | $${tier.priceYearly}/yr`}
                      {' | '}
                      {tier.earlyAccessDays >= 99999 ? 'Instant access' : tier.earlyAccessDays === 0 ? 'Access on release day' : `${tier.earlyAccessDays}d early access`}
                    </div>

                    {/* Auto-derived: what this tier unlocks today (entities + variants) */}
                    <TierUnlocksSummary unlocks={unlocks} tierLevel={tier.tierLevel} />

                    {/* Author's freeform benefits, shown after the auto summary */}
                    {(tier.benefits as string[] | null)?.length ? (
                      <div className="mt-2 text-xs text-gray-600 dark:text-gray-400">
                        <div className="font-medium text-gray-500 dark:text-gray-400 mb-0.5">Also includes:</div>
                        <ul className="space-y-0.5">
                          {(tier.benefits as string[]).map((b, i) => (
                            <li key={i} className="flex items-start gap-1.5">
                              <span className="text-gray-400 mt-0.5">•</span>
                              <span>{b}</span>
                            </li>
                          ))}
                        </ul>
                      </div>
                    ) : null}
                  </div>
                  <div className="flex items-center gap-2 flex-shrink-0">
                    <button
                      onClick={() => setEditingTier({
                        id: tier.id,
                        name: tier.name,
                        description: tier.description || '',
                        priceMonthly: tier.priceMonthly || '',
                        priceYearly: tier.priceYearly || '',
                        benefits: (tier.benefits as string[]) || [],
                        earlyAccessDays: tier.earlyAccessDays,
                        tierLevel: tier.tierLevel
                      })}
                      className="text-sm text-blue-600 dark:text-blue-400 hover:underline"
                    >
                      Edit
                    </button>
                    <button
                      onClick={() => setDeletingTier(tier)}
                      className="text-sm text-red-600 dark:text-red-400 hover:underline"
                    >
                      Delete
                    </button>
                  </div>
                </div>
              )
            })}
          </div>

          {/* Tier editor */}
          {editingTier && (
            <div className="border border-blue-200 dark:border-blue-800 rounded-lg p-4 bg-blue-50/30 dark:bg-blue-950/10">
              <h3 className="font-medium text-gray-900 dark:text-gray-100 mb-3">
                {editingTier.id ? 'Edit Tier' : 'New Tier'}
              </h3>
              <div className="space-y-3">
                <div className="flex gap-3">
                  <div className="flex-1">
                    <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Name</label>
                    <input
                      type="text"
                      value={editingTier.name}
                      onChange={e => setEditingTier({ ...editingTier, name: e.target.value })}
                      className="w-full px-3 py-2 border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-900/50 text-gray-900 dark:text-gray-100 rounded-lg text-sm"
                      placeholder="e.g. Supporter"
                    />
                  </div>
                  <div className="w-16">
                    <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Level</label>
                    <input
                      type="number"
                      min="1"
                      value={editingTier.tierLevel}
                      onChange={e => setEditingTier({ ...editingTier, tierLevel: parseInt(e.target.value) || 1 })}
                      className="w-full px-3 py-2 border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-900/50 text-gray-900 dark:text-gray-100 rounded-lg text-sm text-center"
                    />
                  </div>
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Chapter Access</label>
                  <div className="grid grid-cols-3 rounded-lg border border-gray-200 dark:border-gray-600 overflow-hidden">
                    <button
                      type="button"
                      onClick={() => setEditingTier({ ...editingTier, earlyAccessDays: 0 })}
                      className={`px-3 py-2.5 text-left transition-colors ${
                        editingTier.earlyAccessDays === 0
                          ? 'bg-gray-800 text-white dark:bg-gray-100 dark:text-gray-900'
                          : 'bg-white dark:bg-gray-900/50 text-gray-500 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-800'
                      }`}
                    >
                      <span className="block text-sm font-medium">Same as public</span>
                      <span className={`block text-xs mt-0.5 ${
                        editingTier.earlyAccessDays === 0
                          ? 'text-gray-300 dark:text-gray-500'
                          : 'text-gray-400 dark:text-gray-500'
                      }`}>Read when everyone else does</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        if (editingTier.earlyAccessDays === 0 || editingTier.earlyAccessDays >= 99999) {
                          setEditingTier({ ...editingTier, earlyAccessDays: 7 })
                        }
                      }}
                      className={`px-3 py-2.5 text-left border-x border-gray-200 dark:border-gray-600 transition-colors ${
                        editingTier.earlyAccessDays > 0 && editingTier.earlyAccessDays < 99999
                          ? 'bg-gray-800 text-white dark:bg-gray-100 dark:text-gray-900'
                          : 'bg-white dark:bg-gray-900/50 text-gray-500 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-800'
                      }`}
                    >
                      <span className="block text-sm font-medium">
                        {editingTier.earlyAccessDays > 0 && editingTier.earlyAccessDays < 99999 ? (
                          <span className="inline-flex items-center gap-1">
                            <input
                              type="number"
                              min="1"
                              value={editingTier.earlyAccessDays}
                              onChange={e => setEditingTier({ ...editingTier, earlyAccessDays: Math.max(1, parseInt(e.target.value) || 1) })}
                              onClick={e => e.stopPropagation()}
                              className="w-8 bg-transparent text-center font-medium outline-none [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                            />
                            days early
                          </span>
                        ) : (
                          'Early access'
                        )}
                      </span>
                      <span className={`block text-xs mt-0.5 ${
                        editingTier.earlyAccessDays > 0 && editingTier.earlyAccessDays < 99999
                          ? 'text-gray-300 dark:text-gray-500'
                          : 'text-gray-400 dark:text-gray-500'
                      }`}>Read before the public release</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => setEditingTier({ ...editingTier, earlyAccessDays: 99999 })}
                      className={`px-3 py-2.5 text-left transition-colors ${
                        editingTier.earlyAccessDays >= 99999
                          ? 'bg-purple-600 text-white'
                          : 'bg-white dark:bg-gray-900/50 text-gray-500 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-800'
                      }`}
                    >
                      <span className="flex items-center gap-1 text-sm font-medium">
                        <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                        </svg>
                        Instant
                      </span>
                      <span className={`block text-xs mt-0.5 ${
                        editingTier.earlyAccessDays >= 99999
                          ? 'text-purple-200'
                          : 'text-gray-400 dark:text-gray-500'
                      }`}>Read the moment it&apos;s ready</span>
                    </button>
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Monthly Price ($)</label>
                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      value={editingTier.priceMonthly}
                      onChange={e => setEditingTier({ ...editingTier, priceMonthly: e.target.value })}
                      className="w-full px-3 py-2 border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-900/50 text-gray-900 dark:text-gray-100 rounded-lg text-sm"
                      placeholder="5.00"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Yearly Price ($)</label>
                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      value={editingTier.priceYearly}
                      onChange={e => setEditingTier({ ...editingTier, priceYearly: e.target.value })}
                      className="w-full px-3 py-2 border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-900/50 text-gray-900 dark:text-gray-100 rounded-lg text-sm"
                      placeholder="50.00"
                    />
                  </div>
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Description</label>
                  <textarea
                    value={editingTier.description}
                    onChange={e => setEditingTier({ ...editingTier, description: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-900/50 text-gray-900 dark:text-gray-100 rounded-lg text-sm resize-none"
                    rows={2}
                    placeholder="What do subscribers at this tier get?"
                  />
                </div>
                {/* Benefits */}
                <div>
                  <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Benefits</label>
                  <div className="space-y-1 mb-2">
                    {editingTier.benefits?.map((b, i) => (
                      <div key={i} className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300">
                        <span>- {b}</span>
                        <button onClick={() => removeBenefit(i)} className="text-xs text-red-500 hover:underline">remove</button>
                      </div>
                    ))}
                  </div>
                  <div className="flex gap-2">
                    <input
                      type="text"
                      value={benefitInput}
                      onChange={e => setBenefitInput(e.target.value)}
                      onKeyDown={e => e.key === 'Enter' && (e.preventDefault(), addBenefit())}
                      className="flex-1 px-3 py-1.5 border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-900/50 text-gray-900 dark:text-gray-100 rounded-lg text-sm"
                      placeholder="Add a benefit..."
                    />
                    <button onClick={addBenefit} className="px-3 py-1.5 bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-300 rounded-lg text-sm">Add</button>
                  </div>
                </div>
                <div className="flex justify-end gap-2 pt-2">
                  <button
                    onClick={() => setEditingTier(null)}
                    className="px-4 py-2 text-sm text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-100"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={saveTier}
                    disabled={saving || !editingTier.name}
                    className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors text-sm font-medium disabled:opacity-50"
                  >
                    {saving ? 'Saving...' : 'Save Tier'}
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Discount Codes */}
        <div className="bg-white dark:bg-gray-800 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700 p-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="font-display text-lg font-semibold text-gray-900 dark:text-gray-100">Discount Codes</h2>
            <button
              onClick={() => setShowCodeForm(!showCodeForm)}
              className="px-3 py-1.5 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors text-sm font-medium"
            >
              + Add Code
            </button>
          </div>

          {discountCodes.length === 0 && !showCodeForm && (
            <p className="text-sm text-gray-500 dark:text-gray-400 italic">
              No discount codes yet.
            </p>
          )}

          {discountCodes.length > 0 && (
            <div className="space-y-2 mb-4">
              {discountCodes.map(code => (
                <div key={code.id} className="flex items-center justify-between p-3 bg-gray-50 dark:bg-gray-900/30 rounded-lg text-sm">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-mono font-medium text-gray-900 dark:text-gray-100">{code.code}</span>
                    <span className="text-gray-500 dark:text-gray-400">
                      {code.discountType === 'percent' ? `${code.discountValue}% off` :
                       code.discountType === 'fixed_amount' ? `$${code.discountValue} off` :
                       `${code.discountValue} day free trial`}
                    </span>
                    {code.projectId ? (
                      <span className="px-1.5 py-0.5 bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 text-xs rounded">
                        {authorProjects.find(p => p.id === code.projectId)?.title || 'Project'}
                      </span>
                    ) : (
                      <span className="px-1.5 py-0.5 bg-gray-100 dark:bg-gray-700 text-gray-500 dark:text-gray-400 text-xs rounded">
                        All projects
                      </span>
                    )}
                  </div>
                  <div className="text-gray-400 dark:text-gray-500 text-xs">
                    {code.currentUses}{code.maxUses ? `/${code.maxUses}` : ''} uses
                    {!code.isActive && ' (inactive)'}
                  </div>
                </div>
              ))}
            </div>
          )}

          {showCodeForm && (
            <div className="border border-blue-200 dark:border-blue-800 rounded-lg p-4 bg-blue-50/30 dark:bg-blue-950/10">
              <div className="space-y-3">
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Code</label>
                    <input
                      type="text"
                      value={codeForm.code}
                      onChange={e => setCodeForm({ ...codeForm, code: e.target.value.toUpperCase() })}
                      className="w-full px-3 py-2 border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-900/50 text-gray-900 dark:text-gray-100 rounded-lg text-sm font-mono"
                      placeholder="WELCOME20"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Type</label>
                    <select
                      value={codeForm.discountType}
                      onChange={e => setCodeForm({ ...codeForm, discountType: e.target.value as any })}
                      className="w-full px-3 py-2 border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-900/50 text-gray-900 dark:text-gray-100 rounded-lg text-sm"
                    >
                      <option value="percent">Percentage off</option>
                      <option value="fixed_amount">Fixed amount off</option>
                      <option value="free_trial">Free trial (days)</option>
                    </select>
                  </div>
                </div>
                {authorProjects.length > 0 && (
                  <div>
                    <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Project Scope</label>
                    <select
                      value={codeForm.projectId}
                      onChange={e => setCodeForm({ ...codeForm, projectId: e.target.value })}
                      className="w-full px-3 py-2 border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-900/50 text-gray-900 dark:text-gray-100 rounded-lg text-sm"
                    >
                      <option value="">All projects (author-wide)</option>
                      {authorProjects.map(p => (
                        <option key={p.id} value={p.id}>{p.title}</option>
                      ))}
                    </select>
                  </div>
                )}
                <div className="grid grid-cols-3 gap-3">
                  <div>
                    <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">
                      {codeForm.discountType === 'percent' ? 'Percent' : codeForm.discountType === 'free_trial' ? 'Days' : 'Amount ($)'}
                    </label>
                    <input
                      type="number"
                      min="0"
                      value={codeForm.discountValue}
                      onChange={e => setCodeForm({ ...codeForm, discountValue: e.target.value })}
                      className="w-full px-3 py-2 border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-900/50 text-gray-900 dark:text-gray-100 rounded-lg text-sm"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Max Uses (blank = unlimited)</label>
                    <input
                      type="number"
                      min="0"
                      value={codeForm.maxUses}
                      onChange={e => setCodeForm({ ...codeForm, maxUses: e.target.value })}
                      className="w-full px-3 py-2 border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-900/50 text-gray-900 dark:text-gray-100 rounded-lg text-sm"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Expires</label>
                    <input
                      type="date"
                      value={codeForm.expiresAt}
                      onChange={e => setCodeForm({ ...codeForm, expiresAt: e.target.value })}
                      className="w-full px-3 py-2 border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-900/50 text-gray-900 dark:text-gray-100 rounded-lg text-sm"
                    />
                  </div>
                </div>
                <div className="flex justify-end gap-2">
                  <button onClick={() => setShowCodeForm(false)} className="px-4 py-2 text-sm text-gray-600 dark:text-gray-400">Cancel</button>
                  <button
                    onClick={saveDiscountCode}
                    disabled={saving || !codeForm.code || !codeForm.discountValue}
                    className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors text-sm font-medium disabled:opacity-50"
                  >
                    {saving ? 'Creating...' : 'Create Code'}
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Beta Readers & Access link */}
        <Link
          href="/settings/beta-readers"
          className="block bg-white dark:bg-gray-800 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700 p-6 hover:border-blue-300 dark:hover:border-blue-700 transition-colors"
        >
          <div className="flex items-center justify-between">
            <div>
              <h2 className="font-display text-lg font-semibold text-gray-900 dark:text-gray-100">Beta Readers & Access Grants</h2>
              <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">
                Grant specific users direct access to your projects — beta readers, ARC readers, comps, and gifts.
              </p>
            </div>
            <span className="text-gray-400 dark:text-gray-500">&rarr;</span>
          </div>
        </Link>
      </div>

      <ConfirmModal
        open={!!deletingTier}
        title="Delete Tier"
        description={deletingTier ? `Delete "${deletingTier.name}"? Active subscribers will keep their access until their current period ends.` : ''}
        confirmLabel="Delete Tier"
        variant="danger"
        loading={saving}
        onConfirm={() => deletingTier && deleteTier(deletingTier.id)}
        onCancel={() => setDeletingTier(null)}
      />
    </div>
  )
}

function TierUnlocksSummary({
  unlocks,
  tierLevel,
}: {
  unlocks?: { entityCount: number; variantCount: number; sample: string[] } | undefined
  tierLevel: number
}) {
  if (!unlocks || (unlocks.entityCount === 0 && unlocks.variantCount === 0)) {
    return (
      <div className="mt-2 text-xs text-gray-400 dark:text-gray-500 italic">
        Nothing gated to this tier yet — gate individual entities at Level {tierLevel} from each project's Publishing view.
      </div>
    )
  }
  const bits: string[] = []
  if (unlocks.entityCount > 0) bits.push(`${unlocks.entityCount} ${unlocks.entityCount === 1 ? 'entity' : 'entities'}`)
  if (unlocks.variantCount > 0) bits.push(`${unlocks.variantCount} ${unlocks.variantCount === 1 ? 'variant' : 'variants'}`)
  return (
    <div className="mt-2 text-xs">
      <div className="font-medium text-emerald-700 dark:text-emerald-400">
        Unlocks at this tier: +{bits.join(', +')}
      </div>
      {unlocks.sample.length > 0 && (
        <div className="mt-0.5 text-gray-500 dark:text-gray-400 truncate">
          {unlocks.sample.slice(0, 3).join(' · ')}
          {unlocks.entityCount + unlocks.variantCount > unlocks.sample.length && ' …'}
        </div>
      )}
    </div>
  )
}
