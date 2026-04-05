'use client'

import { useState, useEffect, useCallback } from 'react'
import { useSession } from 'next-auth/react'
import Link from 'next/link'
import { apiFetch } from '@/lib/api'
import { SiteNav } from '@/components/SiteNav'

interface PromoCode {
  id: string
  code: string
  stripeCouponId: string
  discountType: string
  discountValue: string
  discountDurationMonths: number | null
  maxRedemptions: number | null
  currentRedemptions: number
  expiresAt: string | null
  isActive: boolean
  createdAt: string
}

interface Campaign {
  id: string
  name: string
  prefix: string
  codeCount: number
  giftDurationMonths: number
  maxRedemptions: number | null
  currentRedemptions: number
  expiresAt: string | null
  isActive: boolean
  createdAt: string
}

interface Redemption {
  id: string
  userId: string
  email: string
  name: string | null
  redeemedAt: string
  resultType: string
  metadata: Record<string, unknown> | null
}

type Tab = 'codes' | 'campaigns'

export default function AdminPromoCodesPage() {
  const { data: session } = useSession()
  const [tab, setTab] = useState<Tab>('codes')
  const [codes, setCodes] = useState<PromoCode[]>([])
  const [campaigns, setCampaigns] = useState<Campaign[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // Create discount code form
  const [showCreateCode, setShowCreateCode] = useState(false)
  const [codeForm, setCodeForm] = useState({
    code: '', discountType: 'percent' as 'percent' | 'fixed_amount',
    discountValue: '', discountDurationMonths: '', maxRedemptions: '', expiresAt: '',
  })
  const [codeCreating, setCodeCreating] = useState(false)

  // Create campaign form
  const [showCreateCampaign, setShowCreateCampaign] = useState(false)
  const [campaignForm, setCampaignForm] = useState({
    name: '', prefix: '', giftDurationMonths: '6', maxRedemptions: '', expiresAt: '',
  })
  const [campaignCreating, setCampaignCreating] = useState(false)

  // Generate codes
  const [generatingFor, setGeneratingFor] = useState<string | null>(null)
  const [generateCount, setGenerateCount] = useState('50')
  const [generatedCodes, setGeneratedCodes] = useState<string[] | null>(null)

  // Redemptions
  const [redemptionsFor, setRedemptionsFor] = useState<{ type: 'code' | 'campaign'; id: string } | null>(null)
  const [redemptions, setRedemptions] = useState<Redemption[]>([])
  const [redemptionsLoading, setRedemptionsLoading] = useState(false)

  const fetchCodes = useCallback(async () => {
    if (!session?.apiToken) return
    try {
      const res = await apiFetch('/api/admin/promo-codes', session.apiToken)
      if (res.ok) setCodes((await res.json()).codes)
      else setError('Failed to load discount codes')
    } catch {
      setError('Failed to load discount codes')
    }
  }, [session?.apiToken])

  const fetchCampaigns = useCallback(async () => {
    if (!session?.apiToken) return
    try {
      const res = await apiFetch('/api/admin/campaigns', session.apiToken)
      if (res.ok) setCampaigns((await res.json()).campaigns)
      else setError('Failed to load campaigns')
    } catch {
      setError('Failed to load campaigns')
    }
  }, [session?.apiToken])

  useEffect(() => {
    if (!session?.apiToken) return
    setLoading(true)
    Promise.all([fetchCodes(), fetchCampaigns()])
      .catch(() => setError('Failed to load data'))
      .finally(() => setLoading(false))
  }, [session?.apiToken, fetchCodes, fetchCampaigns])

  const createCode = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!session?.apiToken) return
    setCodeCreating(true)
    setError(null)
    try {
      const res = await apiFetch('/api/admin/promo-codes', session.apiToken, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          code: codeForm.code,
          discountType: codeForm.discountType,
          discountValue: Number(codeForm.discountValue),
          discountDurationMonths: codeForm.discountDurationMonths ? Number(codeForm.discountDurationMonths) : undefined,
          maxRedemptions: codeForm.maxRedemptions ? Number(codeForm.maxRedemptions) : undefined,
          expiresAt: codeForm.expiresAt || undefined,
        }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        setError(data.error || 'Failed to create code')
        return
      }
      setCodeForm({ code: '', discountType: 'percent', discountValue: '', discountDurationMonths: '', maxRedemptions: '', expiresAt: '' })
      setShowCreateCode(false)
      fetchCodes()
    } catch {
      setError('Failed to create code')
    } finally {
      setCodeCreating(false)
    }
  }

  const createCampaign = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!session?.apiToken) return
    setCampaignCreating(true)
    setError(null)
    try {
      const res = await apiFetch('/api/admin/campaigns', session.apiToken, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: campaignForm.name,
          prefix: campaignForm.prefix,
          giftDurationMonths: Number(campaignForm.giftDurationMonths),
          maxRedemptions: campaignForm.maxRedemptions ? Number(campaignForm.maxRedemptions) : undefined,
          expiresAt: campaignForm.expiresAt || undefined,
        }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        setError(data.error || 'Failed to create campaign')
        return
      }
      setCampaignForm({ name: '', prefix: '', giftDurationMonths: '6', maxRedemptions: '', expiresAt: '' })
      setShowCreateCampaign(false)
      fetchCampaigns()
    } catch {
      setError('Failed to create campaign')
    } finally {
      setCampaignCreating(false)
    }
  }

  const toggleActive = async (type: 'code' | 'campaign', id: string, isActive: boolean) => {
    if (!session?.apiToken) return
    const url = type === 'code' ? `/api/admin/promo-codes/${id}` : `/api/admin/campaigns/${id}`
    try {
      const res = await apiFetch(url, session.apiToken, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ isActive: !isActive }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        setError(data.error || 'Failed to update')
      }
    } catch {
      setError('Failed to update')
    }
    if (type === 'code') { fetchCodes() } else { fetchCampaigns() }
  }

  const handleGenerateCodes = async (campaignId: string) => {
    if (!session?.apiToken) return
    const count = Number(generateCount)
    if (!count || count < 1) return
    try {
      const res = await apiFetch(`/api/admin/campaigns/${campaignId}/generate-codes`, session.apiToken, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ count }),
      })
      if (res.ok) {
        const data = await res.json()
        setGeneratedCodes(data.codes)
        fetchCampaigns()
      } else {
        const data = await res.json().catch(() => ({}))
        setError(data.error || 'Failed to generate codes')
      }
    } catch {
      setError('Failed to generate codes')
    }
  }

  const fetchRedemptions = async (type: 'code' | 'campaign', id: string) => {
    if (!session?.apiToken) return
    setRedemptionsFor({ type, id })
    setRedemptionsLoading(true)
    try {
      const url = type === 'code'
        ? `/api/admin/promo-codes/${id}/redemptions`
        : `/api/admin/campaigns/${id}/redemptions`
      const res = await apiFetch(url, session.apiToken)
      if (res.ok) setRedemptions((await res.json()).redemptions)
      else setError('Failed to load redemptions')
    } catch {
      setError('Failed to load redemptions')
    }
    setRedemptionsLoading(false)
  }

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text)
  }

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900">
      <SiteNav />
      <div className="max-w-6xl mx-auto px-4 py-8">
        <div className="flex items-center justify-between mb-6">
          <div>
            <Link href="/admin" className="text-sm text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300 mb-1 inline-block">&larr; Admin</Link>
            <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">Promo Codes</h1>
          </div>
        </div>

        {error && (
          <div className="p-4 mb-6 bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-400 rounded-lg flex items-center justify-between">
            <span>{error}</span>
            <button onClick={() => setError(null)} className="text-red-400 hover:text-red-600">&times;</button>
          </div>
        )}

        {/* Tabs */}
        <div className="flex gap-1 mb-6 bg-gray-100 dark:bg-gray-800 rounded-lg p-1 w-fit">
          <button
            onClick={() => setTab('codes')}
            className={`px-4 py-2 text-sm font-medium rounded-md transition-colors ${
              tab === 'codes'
                ? 'bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 shadow-sm'
                : 'text-gray-500 dark:text-gray-400 hover:text-gray-700'
            }`}
          >
            Discount Codes
          </button>
          <button
            onClick={() => setTab('campaigns')}
            className={`px-4 py-2 text-sm font-medium rounded-md transition-colors ${
              tab === 'campaigns'
                ? 'bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 shadow-sm'
                : 'text-gray-500 dark:text-gray-400 hover:text-gray-700'
            }`}
          >
            Gift Campaigns
          </button>
        </div>

        {loading ? (
          <div className="animate-pulse space-y-3">
            {[...Array(3)].map((_, i) => (
              <div key={i} className="h-16 bg-gray-200 dark:bg-gray-800 rounded-lg" />
            ))}
          </div>
        ) : tab === 'codes' ? (
          /* ─── Discount Codes Tab ─── */
          <div>
            <div className="flex justify-end mb-4">
              <button
                onClick={() => setShowCreateCode(!showCreateCode)}
                className="px-4 py-2 text-sm font-medium bg-purple-600 text-white rounded-lg hover:bg-purple-700 transition-colors"
              >
                {showCreateCode ? 'Cancel' : 'Create Discount Code'}
              </button>
            </div>

            {showCreateCode && (
              <form onSubmit={createCode} className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-5 mb-6 space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Code</label>
                    <input
                      value={codeForm.code}
                      onChange={(e) => setCodeForm({ ...codeForm, code: e.target.value.toUpperCase() })}
                      placeholder="COMICCON26"
                      required
                      className="w-full px-3 py-2 text-sm border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 font-mono"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Discount Type</label>
                    <select
                      value={codeForm.discountType}
                      onChange={(e) => setCodeForm({ ...codeForm, discountType: e.target.value as 'percent' | 'fixed_amount' })}
                      className="w-full px-3 py-2 text-sm border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100"
                    >
                      <option value="percent">Percentage (%)</option>
                      <option value="fixed_amount">Fixed Amount ($)</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">
                      {codeForm.discountType === 'percent' ? 'Percent Off' : 'Amount Off ($)'}
                    </label>
                    <input
                      type="number"
                      value={codeForm.discountValue}
                      onChange={(e) => setCodeForm({ ...codeForm, discountValue: e.target.value })}
                      placeholder={codeForm.discountType === 'percent' ? '50' : '2.50'}
                      required
                      min="0"
                      step={codeForm.discountType === 'percent' ? '1' : '0.01'}
                      className="w-full px-3 py-2 text-sm border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Duration (months, blank = one-time)</label>
                    <input
                      type="number"
                      value={codeForm.discountDurationMonths}
                      onChange={(e) => setCodeForm({ ...codeForm, discountDurationMonths: e.target.value })}
                      placeholder="3"
                      min="1"
                      className="w-full px-3 py-2 text-sm border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Max Uses (blank = unlimited)</label>
                    <input
                      type="number"
                      value={codeForm.maxRedemptions}
                      onChange={(e) => setCodeForm({ ...codeForm, maxRedemptions: e.target.value })}
                      placeholder="100"
                      min="1"
                      className="w-full px-3 py-2 text-sm border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Expires At (blank = never)</label>
                    <input
                      type="datetime-local"
                      value={codeForm.expiresAt}
                      onChange={(e) => setCodeForm({ ...codeForm, expiresAt: e.target.value })}
                      className="w-full px-3 py-2 text-sm border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100"
                    />
                  </div>
                </div>
                <button
                  type="submit"
                  disabled={codeCreating}
                  className="px-4 py-2 text-sm font-medium bg-purple-600 text-white rounded-lg hover:bg-purple-700 disabled:opacity-50 transition-colors"
                >
                  {codeCreating ? 'Creating...' : 'Create Code'}
                </button>
              </form>
            )}

            {codes.length === 0 ? (
              <p className="text-sm text-gray-500 dark:text-gray-400 text-center py-8">No discount codes yet.</p>
            ) : (
              <div className="space-y-2">
                {codes.map((code) => (
                  <div key={code.id} className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-4">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        <span className="font-mono font-bold text-gray-900 dark:text-gray-100">{code.code}</span>
                        <span className={`text-xs px-2 py-0.5 rounded-full ${code.isActive ? 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400' : 'bg-gray-100 dark:bg-gray-700 text-gray-500'}`}>
                          {code.isActive ? 'Active' : 'Inactive'}
                        </span>
                      </div>
                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => fetchRedemptions('code', code.id)}
                          className="text-xs text-blue-600 dark:text-blue-400 hover:underline"
                        >
                          Redemptions
                        </button>
                        <button
                          onClick={() => toggleActive('code', code.id, code.isActive)}
                          className="text-xs text-gray-500 hover:text-gray-700 dark:hover:text-gray-300"
                        >
                          {code.isActive ? 'Deactivate' : 'Activate'}
                        </button>
                      </div>
                    </div>
                    <div className="mt-2 flex gap-4 text-xs text-gray-500 dark:text-gray-400">
                      <span>
                        {code.discountType === 'percent' ? `${code.discountValue}% off` : `$${code.discountValue} off`}
                        {code.discountDurationMonths ? ` for ${code.discountDurationMonths}mo` : ' (once)'}
                      </span>
                      <span>Uses: {code.currentRedemptions}{code.maxRedemptions ? `/${code.maxRedemptions}` : ''}</span>
                      {code.expiresAt && <span>Expires: {new Date(code.expiresAt).toLocaleDateString()}</span>}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        ) : (
          /* ─── Gift Campaigns Tab ─── */
          <div>
            <div className="flex justify-end mb-4">
              <button
                onClick={() => setShowCreateCampaign(!showCreateCampaign)}
                className="px-4 py-2 text-sm font-medium bg-purple-600 text-white rounded-lg hover:bg-purple-700 transition-colors"
              >
                {showCreateCampaign ? 'Cancel' : 'Create Campaign'}
              </button>
            </div>

            {showCreateCampaign && (
              <form onSubmit={createCampaign} className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-5 mb-6 space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Campaign Name</label>
                    <input
                      value={campaignForm.name}
                      onChange={(e) => setCampaignForm({ ...campaignForm, name: e.target.value })}
                      placeholder="ComicCon 2026 Giveaway"
                      required
                      className="w-full px-3 py-2 text-sm border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Code Prefix</label>
                    <input
                      value={campaignForm.prefix}
                      onChange={(e) => setCampaignForm({ ...campaignForm, prefix: e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '') })}
                      placeholder="COMICCON26"
                      required
                      className="w-full px-3 py-2 text-sm border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 font-mono"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Gift Duration (months)</label>
                    <input
                      type="number"
                      value={campaignForm.giftDurationMonths}
                      onChange={(e) => setCampaignForm({ ...campaignForm, giftDurationMonths: e.target.value })}
                      required
                      min="1"
                      className="w-full px-3 py-2 text-sm border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Max Redemptions (blank = unlimited)</label>
                    <input
                      type="number"
                      value={campaignForm.maxRedemptions}
                      onChange={(e) => setCampaignForm({ ...campaignForm, maxRedemptions: e.target.value })}
                      placeholder="500"
                      min="1"
                      className="w-full px-3 py-2 text-sm border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100"
                    />
                  </div>
                  <div className="col-span-2">
                    <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Expires At (blank = never)</label>
                    <input
                      type="datetime-local"
                      value={campaignForm.expiresAt}
                      onChange={(e) => setCampaignForm({ ...campaignForm, expiresAt: e.target.value })}
                      className="w-full px-3 py-2 text-sm border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100"
                    />
                  </div>
                </div>
                <button
                  type="submit"
                  disabled={campaignCreating}
                  className="px-4 py-2 text-sm font-medium bg-purple-600 text-white rounded-lg hover:bg-purple-700 disabled:opacity-50 transition-colors"
                >
                  {campaignCreating ? 'Creating...' : 'Create Campaign'}
                </button>
              </form>
            )}

            {campaigns.length === 0 ? (
              <p className="text-sm text-gray-500 dark:text-gray-400 text-center py-8">No gift campaigns yet.</p>
            ) : (
              <div className="space-y-2">
                {campaigns.map((campaign) => (
                  <div key={campaign.id} className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-4">
                    <div className="flex items-center justify-between">
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="font-medium text-gray-900 dark:text-gray-100">{campaign.name}</span>
                          <span className="font-mono text-xs text-gray-500 dark:text-gray-400">{campaign.prefix}-*</span>
                          <span className={`text-xs px-2 py-0.5 rounded-full ${campaign.isActive ? 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400' : 'bg-gray-100 dark:bg-gray-700 text-gray-500'}`}>
                            {campaign.isActive ? 'Active' : 'Inactive'}
                          </span>
                        </div>
                        <div className="mt-1 flex gap-4 text-xs text-gray-500 dark:text-gray-400">
                          <span>{campaign.giftDurationMonths}mo free</span>
                          <span>Codes: {campaign.codeCount}</span>
                          <span>Redeemed: {campaign.currentRedemptions}{campaign.maxRedemptions ? `/${campaign.maxRedemptions}` : ''}</span>
                          {campaign.expiresAt && <span>Expires: {new Date(campaign.expiresAt).toLocaleDateString()}</span>}
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => {
                            setGeneratingFor(generatingFor === campaign.id ? null : campaign.id)
                            setGeneratedCodes(null)
                          }}
                          className="text-xs px-3 py-1.5 bg-blue-600 text-white rounded-md hover:bg-blue-700 transition-colors"
                        >
                          Generate Codes
                        </button>
                        <button
                          onClick={() => fetchRedemptions('campaign', campaign.id)}
                          className="text-xs text-blue-600 dark:text-blue-400 hover:underline"
                        >
                          Redemptions
                        </button>
                        <button
                          onClick={() => toggleActive('campaign', campaign.id, campaign.isActive)}
                          className="text-xs text-gray-500 hover:text-gray-700 dark:hover:text-gray-300"
                        >
                          {campaign.isActive ? 'Deactivate' : 'Activate'}
                        </button>
                      </div>
                    </div>

                    {/* Generate codes panel */}
                    {generatingFor === campaign.id && (
                      <div className="mt-4 pt-4 border-t border-gray-200 dark:border-gray-700">
                        <div className="flex items-center gap-2 mb-3">
                          <label className="text-xs text-gray-600 dark:text-gray-400">How many codes?</label>
                          <input
                            type="number"
                            value={generateCount}
                            onChange={(e) => setGenerateCount(e.target.value)}
                            min="1"
                            max="10000"
                            className="w-24 px-2 py-1 text-sm border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100"
                          />
                          <button
                            onClick={() => handleGenerateCodes(campaign.id)}
                            className="text-xs px-3 py-1.5 bg-green-600 text-white rounded-md hover:bg-green-700 transition-colors"
                          >
                            Generate
                          </button>
                        </div>

                        {generatedCodes && (
                          <div>
                            <div className="flex items-center justify-between mb-2">
                              <span className="text-xs text-gray-500 dark:text-gray-400">{generatedCodes.length} codes generated</span>
                              <button
                                onClick={() => copyToClipboard(generatedCodes.join('\n'))}
                                className="text-xs px-3 py-1 bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-300 rounded hover:bg-gray-300 dark:hover:bg-gray-600 transition-colors"
                              >
                                Copy All
                              </button>
                            </div>
                            <div className="max-h-48 overflow-y-auto bg-gray-50 dark:bg-gray-900 rounded-lg p-3 font-mono text-xs text-gray-700 dark:text-gray-300 space-y-0.5">
                              {generatedCodes.slice(0, 200).map((c, i) => (
                                <div key={i}>{c}</div>
                              ))}
                              {generatedCodes.length > 200 && (
                                <div className="text-gray-400 pt-1">...and {generatedCodes.length - 200} more (use Copy All)</div>
                              )}
                            </div>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Redemptions modal */}
        {redemptionsFor && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={() => setRedemptionsFor(null)}>
            <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-6 max-w-lg w-full max-h-[70vh] overflow-y-auto mx-4" onClick={(e) => e.stopPropagation()}>
              <div className="flex items-center justify-between mb-4">
                <h3 className="font-medium text-gray-900 dark:text-gray-100">Redemptions</h3>
                <button onClick={() => setRedemptionsFor(null)} className="text-gray-400 hover:text-gray-600">&times;</button>
              </div>
              {redemptionsLoading ? (
                <p className="text-sm text-gray-500">Loading...</p>
              ) : redemptions.length === 0 ? (
                <p className="text-sm text-gray-500">No redemptions yet.</p>
              ) : (
                <div className="space-y-2">
                  {redemptions.map((r) => (
                    <div key={r.id} className="flex items-center justify-between text-sm py-2 border-b border-gray-100 dark:border-gray-700 last:border-0">
                      <div>
                        <span className="text-gray-900 dark:text-gray-100">{r.email}</span>
                        {r.name && <span className="text-gray-500 dark:text-gray-400 ml-2">({r.name})</span>}
                      </div>
                      <span className="text-xs text-gray-500 dark:text-gray-400">{new Date(r.redeemedAt).toLocaleDateString()}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
