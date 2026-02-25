'use client'

import { useState, useEffect } from 'react'
import { useSession } from 'next-auth/react'
import { redirect } from 'next/navigation'
import Link from 'next/link'
import { config } from '@/lib/config'
import { apiFetch } from '@/lib/api'

interface SubscriptionTier {
  id: string
  name: string
  description: string | null
  priceMonthly: string | null
  priceYearly: string | null
  benefits: string[] | null
  chapterDelayDays: number
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
}

interface PaymentConfig {
  stripeAccountId: string | null
  stripeOnboardingComplete: boolean
  paymentProvider: string
}

const emptyTier = {
  name: '',
  description: '',
  priceMonthly: '',
  priceYearly: '',
  benefits: [] as string[],
  chapterDelayDays: 0,
  tierLevel: 1
}

export default function MonetizationPage() {
  const { data: session, status } = useSession()
  const [tiers, setTiers] = useState<SubscriptionTier[]>([])
  const [discountCodes, setDiscountCodes] = useState<DiscountCode[]>([])
  const [paymentConfig, setPaymentConfig] = useState<PaymentConfig | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [success, setSuccess] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  // Tier editing
  const [editingTier, setEditingTier] = useState<(typeof emptyTier & { id?: string }) | null>(null)
  const [benefitInput, setBenefitInput] = useState('')

  // Discount code editing
  const [showCodeForm, setShowCodeForm] = useState(false)
  const [codeForm, setCodeForm] = useState({
    code: '',
    discountType: 'percent' as 'percent' | 'fixed_amount' | 'free_trial',
    discountValue: '',
    maxUses: '',
    expiresAt: ''
  })

  useEffect(() => {
    if (session?.user?.id && session?.apiToken) {
      loadData()
    }
  }, [session?.user?.id, session?.apiToken])

  const loadData = async () => {
    if (!session?.apiToken || !session?.user?.id) return
    setLoading(true)
    try {
      const [tiersRes, configRes, codesRes] = await Promise.all([
        fetch(`${config.apiUrl}/api/users/${session.user.id}/subscription-tiers`),
        fetch(`${config.apiUrl}/api/users/${session.user.id}/payment-config`),
        apiFetch(`/api/users/${session.user.id}/discount-codes`, session.apiToken)
      ])

      if (tiersRes.ok) {
        const data = await tiersRes.json()
        setTiers(data.tiers || [])
      }
      if (configRes.ok) {
        const data = await configRes.json()
        setPaymentConfig(data.paymentConfig)
      }
      if (codesRes.ok) {
        const data = await codesRes.json()
        setDiscountCodes(data.discountCodes || [])
      }
    } catch (err) {
      console.error('Failed to load monetization data:', err)
    } finally {
      setLoading(false)
    }
  }

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
        chapterDelayDays: String(editingTier.chapterDelayDays),
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
        setEditingTier(null)
        setSuccess('Tier saved!')
        setTimeout(() => setSuccess(null), 3000)
        await loadData()
      } else {
        const data = await res.json().catch(() => ({}))
        setError(data.error || 'Failed to save tier')
      }
    } catch (err) {
      setError('Failed to save tier')
    } finally {
      setSaving(false)
    }
  }

  const deleteTier = async (tierId: string) => {
    if (!session?.apiToken || !session?.user?.id) return
    if (!confirm('Delete this tier? Active subscribers will keep their access until their period ends.')) return
    try {
      await apiFetch(
        `/api/users/${session.user.id}/subscription-tiers/${tierId}`,
        session.apiToken,
        { method: 'DELETE' }
      )
      await loadData()
    } catch (err) {
      setError('Failed to delete tier')
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
        `/api/users/${session.user.id}/discount-codes`,
        session.apiToken,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            code: codeForm.code,
            discountType: codeForm.discountType,
            discountValue: codeForm.discountValue,
            maxUses: codeForm.maxUses ? parseInt(codeForm.maxUses) : null,
            expiresAt: codeForm.expiresAt || null
          })
        }
      )
      if (res.ok) {
        setShowCodeForm(false)
        setCodeForm({ code: '', discountType: 'percent', discountValue: '', maxUses: '', expiresAt: '' })
        setSuccess('Discount code created!')
        setTimeout(() => setSuccess(null), 3000)
        await loadData()
      } else {
        const data = await res.json().catch(() => ({}))
        setError(data.error || 'Failed to create discount code')
      }
    } catch (err) {
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
            returnUrl: `${window.location.origin}/settings/monetization`,
            refreshUrl: `${window.location.origin}/settings/monetization`
          })
        }
      )
      if (res.ok) {
        const data = await res.json()
        if (data.oauthUrl) {
          window.location.href = data.oauthUrl
        }
      }
    } catch (err) {
      setError('Failed to start Stripe onboarding')
    }
  }

  if (status === 'loading' || loading) {
    return (
      <div className="min-h-screen bg-gray-50 dark:bg-gray-900 flex items-center justify-center">
        <div className="text-gray-500 dark:text-gray-400">Loading...</div>
      </div>
    )
  }

  if (!session?.user) {
    redirect('/login')
  }

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900">
      {/* Header */}
      <header className="bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-4">
          <div className="flex items-center gap-2 text-sm text-gray-500 dark:text-gray-400 mb-1">
            <Link href="/dashboard" className="hover:text-gray-900 dark:hover:text-gray-100 transition-colors">Dashboard</Link>
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" /></svg>
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
            <div className="flex items-center gap-3">
              <div className="w-3 h-3 rounded-full bg-green-500" />
              <span className="text-sm text-gray-700 dark:text-gray-300">Stripe account connected</span>
              <span className="text-xs text-gray-400 dark:text-gray-500">({paymentConfig.stripeAccountId})</span>
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
            {tiers.map(tier => (
              <div key={tier.id} className="flex items-center justify-between p-4 bg-gray-50 dark:bg-gray-900/30 rounded-lg border border-gray-100 dark:border-gray-700">
                <div>
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
                    {tier.chapterDelayDays === 0 ? 'Immediate access' : `${tier.chapterDelayDays}d delay`}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => setEditingTier({
                      id: tier.id,
                      name: tier.name,
                      description: tier.description || '',
                      priceMonthly: tier.priceMonthly || '',
                      priceYearly: tier.priceYearly || '',
                      benefits: (tier.benefits as string[]) || [],
                      chapterDelayDays: tier.chapterDelayDays,
                      tierLevel: tier.tierLevel
                    })}
                    className="text-sm text-blue-600 dark:text-blue-400 hover:underline"
                  >
                    Edit
                  </button>
                  <button
                    onClick={() => deleteTier(tier.id)}
                    className="text-sm text-red-600 dark:text-red-400 hover:underline"
                  >
                    Delete
                  </button>
                </div>
              </div>
            ))}
          </div>

          {/* Tier editor */}
          {editingTier && (
            <div className="border border-blue-200 dark:border-blue-800 rounded-lg p-4 bg-blue-50/30 dark:bg-blue-950/10">
              <h3 className="font-medium text-gray-900 dark:text-gray-100 mb-3">
                {editingTier.id ? 'Edit Tier' : 'New Tier'}
              </h3>
              <div className="space-y-3">
                <div className="grid grid-cols-3 gap-3">
                  <div>
                    <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Name</label>
                    <input
                      type="text"
                      value={editingTier.name}
                      onChange={e => setEditingTier({ ...editingTier, name: e.target.value })}
                      className="w-full px-3 py-2 border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-900/50 text-gray-900 dark:text-gray-100 rounded-lg text-sm"
                      placeholder="e.g. Supporter"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Level</label>
                    <input
                      type="number"
                      min="1"
                      value={editingTier.tierLevel}
                      onChange={e => setEditingTier({ ...editingTier, tierLevel: parseInt(e.target.value) || 1 })}
                      className="w-full px-3 py-2 border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-900/50 text-gray-900 dark:text-gray-100 rounded-lg text-sm"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Chapter Delay (days)</label>
                    <input
                      type="number"
                      min="0"
                      value={editingTier.chapterDelayDays}
                      onChange={e => setEditingTier({ ...editingTier, chapterDelayDays: parseInt(e.target.value) || 0 })}
                      className="w-full px-3 py-2 border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-900/50 text-gray-900 dark:text-gray-100 rounded-lg text-sm"
                    />
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
                  <div>
                    <span className="font-mono font-medium text-gray-900 dark:text-gray-100">{code.code}</span>
                    <span className="text-gray-500 dark:text-gray-400 ml-2">
                      {code.discountType === 'percent' ? `${code.discountValue}% off` :
                       code.discountType === 'fixed_amount' ? `$${code.discountValue} off` :
                       `${code.discountValue} day free trial`}
                    </span>
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
      </div>
    </div>
  )
}
