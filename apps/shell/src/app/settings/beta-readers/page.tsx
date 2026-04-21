'use client'

import { useState, useEffect, useCallback } from 'react'
import { useSession } from 'next-auth/react'
import { redirect } from 'next/navigation'
import Link from 'next/link'
import { apiFetch } from '@/lib/api'
import { SiteNav } from '@/components/SiteNav'

interface AuthorProject {
  id: string
  title: string
}

interface BetaReaderEntry {
  betaReader: {
    id: string
    readerId: string
    projectId: string | null
    accessLevel: string
    notes: string | null
    isActive: boolean
  }
  user: {
    id: string
    name: string | null
    username: string | null
  } | null
}

interface AccessGrantEntry {
  grant: {
    id: string
    grantedTo: string
    projectId: string | null
    grantType: string
    expiresAt: string | null
    reason: string | null
    isActive: boolean
    createdAt: string
  }
  user: {
    id: string
    name: string | null
    email: string | null
    username: string | null
  } | null
}

export default function BetaReadersPage() {
  const { data: session, status } = useSession()
  const [projects, setProjects] = useState<AuthorProject[]>([])
  const [selectedProjectId, setSelectedProjectId] = useState<string>('')
  const [betaReaders, setBetaReaders] = useState<BetaReaderEntry[]>([])
  const [accessGrants, setAccessGrants] = useState<AccessGrantEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [success, setSuccess] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  // Beta reader form
  const [showBetaForm, setShowBetaForm] = useState(false)
  const [betaForm, setBetaForm] = useState({
    username: '',
    accessLevel: 'beta' as 'beta' | 'arc' | 'early_access',
    notes: '',
    perProject: true
  })
  const [lookupResult, setLookupResult] = useState<{ userId: string; displayName: string } | null>(null)
  const [lookupError, setLookupError] = useState<string | null>(null)

  // Access grant form
  const [showGrantForm, setShowGrantForm] = useState(false)
  const [grantForm, setGrantForm] = useState({
    username: '',
    grantType: 'comp' as 'gift' | 'comp' | 'beta' | 'promotional',
    expiresAt: '',
    reason: '',
    perProject: true
  })
  const [grantLookupResult, setGrantLookupResult] = useState<{ userId: string; displayName: string } | null>(null)
  const [grantLookupError, setGrantLookupError] = useState<string | null>(null)

  const userId = session?.user?.id
  const apiToken = (session as any)?.apiToken as string | undefined

  const loadProjects = useCallback(async () => {
    if (!apiToken) return
    try {
      const res = await apiFetch('/api/users/me/projects', apiToken)
      if (res.ok) {
        const data = await res.json()
        const projs = (data.projects || []).map((p: any) => ({
          id: p.project.id,
          title: p.project.name
        }))
        setProjects(projs)
      }
    } catch {
      console.error('Failed to load projects')
    }
  }, [apiToken])

  const loadData = useCallback(async () => {
    if (!apiToken || !userId) return
    setLoading(true)
    try {
      const betaParams = selectedProjectId ? `?projectId=${selectedProjectId}` : ''
      const grantParams = selectedProjectId
        ? `?projectId=${selectedProjectId}&active=true`
        : '?active=true'
      const [betaRes, grantsRes] = await Promise.all([
        apiFetch(`/api/users/${userId}/beta-readers${betaParams}`, apiToken),
        apiFetch(`/api/authors/${userId}/access-grants${grantParams}`, apiToken)
      ])

      if (betaRes.ok) {
        const data = await betaRes.json()
        setBetaReaders(data.betaReaders || [])
      }
      if (grantsRes.ok) {
        const data = await grantsRes.json()
        setAccessGrants(data.accessGrants || [])
      }
    } catch {
      console.error('Failed to load data')
    } finally {
      setLoading(false)
    }
  }, [apiToken, userId, selectedProjectId])

  useEffect(() => {
    if (userId && apiToken) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- initial fetch
      loadProjects()
    }
  }, [userId, apiToken, loadProjects])

  useEffect(() => {
    if (userId && apiToken) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- initial fetch
      loadData()
    }
  }, [userId, apiToken, loadData])

  const lookupUser = async (username: string, setResult: (r: any) => void, setErr: (e: string | null) => void) => {
    if (!username.trim() || !apiToken) return
    setResult(null)
    setErr(null)
    try {
      const res = await apiFetch(`/api/users/by-username/${encodeURIComponent(username.trim())}`, apiToken)
      if (res.ok) {
        const data = await res.json()
        const p = data.profile || data
        setResult({ userId: p.userId, displayName: p.userName || p.displayName || username })
      } else {
        setErr('User not found')
      }
    } catch {
      setErr('Failed to look up user')
    }
  }

  const addBetaReader = async () => {
    if (!apiToken || !userId || !lookupResult) return
    setSaving(true)
    setError(null)
    try {
      const res = await apiFetch(`/api/users/${userId}/beta-readers`, apiToken, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          readerId: lookupResult.userId,
          projectId: betaForm.perProject && selectedProjectId ? selectedProjectId : undefined,
          accessLevel: betaForm.accessLevel,
          notes: betaForm.notes || undefined
        })
      })
      if (res.ok) {
        setShowBetaForm(false)
        setBetaForm({ username: '', accessLevel: 'beta', notes: '', perProject: true })
        setLookupResult(null)
        setSuccess('Beta reader added!')
        setTimeout(() => setSuccess(null), 3000)
        await loadData()
      } else {
        const data = await res.json().catch(() => ({}))
        setError(data.error || 'Failed to add beta reader')
      }
    } catch {
      setError('Failed to add beta reader')
    } finally {
      setSaving(false)
    }
  }

  const removeBetaReader = async (betaReaderId: string) => {
    if (!apiToken || !userId) return
    try {
      const res = await apiFetch(`/api/users/${userId}/beta-readers/${betaReaderId}`, apiToken, {
        method: 'DELETE'
      })
      if (res.ok) {
        await loadData()
      }
    } catch {
      setError('Failed to remove beta reader')
    }
  }

  const toggleBetaReaderActive = async (betaReaderId: string, isActive: boolean) => {
    if (!apiToken || !userId) return
    try {
      const res = await apiFetch(`/api/users/${userId}/beta-readers/${betaReaderId}`, apiToken, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ isActive: !isActive })
      })
      if (res.ok) {
        await loadData()
      }
    } catch {
      setError('Failed to update beta reader')
    }
  }

  const addAccessGrant = async () => {
    if (!apiToken || !userId || !grantLookupResult) return
    setSaving(true)
    setError(null)
    try {
      const res = await apiFetch(`/api/authors/${userId}/access-grants`, apiToken, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          grantedTo: grantLookupResult.userId,
          projectId: grantForm.perProject && selectedProjectId ? selectedProjectId : undefined,
          grantType: grantForm.grantType,
          expiresAt: grantForm.expiresAt || undefined,
          reason: grantForm.reason || undefined
        })
      })
      if (res.ok) {
        setShowGrantForm(false)
        setGrantForm({ username: '', grantType: 'comp', expiresAt: '', reason: '', perProject: true })
        setGrantLookupResult(null)
        setSuccess('Access grant created!')
        setTimeout(() => setSuccess(null), 3000)
        await loadData()
      } else {
        const data = await res.json().catch(() => ({}))
        setError(data.error || 'Failed to create access grant')
      }
    } catch {
      setError('Failed to create access grant')
    } finally {
      setSaving(false)
    }
  }

  const revokeAccessGrant = async (grantId: string) => {
    if (!apiToken) return
    try {
      const res = await apiFetch(`/api/access-grants/${grantId}`, apiToken, {
        method: 'DELETE'
      })
      if (res.ok) {
        await loadData()
      }
    } catch {
      setError('Failed to revoke access grant')
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

  const accessLevelLabels: Record<string, string> = {
    beta: 'Beta Reader',
    arc: 'ARC Reader',
    early_access: 'Early Access'
  }

  const grantTypeLabels: Record<string, string> = {
    gift: 'Gift',
    comp: 'Comp',
    beta: 'Beta',
    promotional: 'Promo'
  }

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-950">
      <SiteNav />

      <header className="bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-4">
          <div className="flex items-center gap-2 text-sm text-gray-500 dark:text-gray-400 mb-1">
            <Link href="/settings" className="hover:text-gray-900 dark:hover:text-gray-100 transition-colors">Settings</Link>
            <span>/</span>
            <span className="text-gray-900 dark:text-gray-100">Beta Readers & Access</span>
          </div>
          <h1 className="font-display text-2xl font-bold text-gray-900 dark:text-gray-100">
            Beta Readers & Access Grants
          </h1>
        </div>
      </header>

      <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-6">
        {success && (
          <div className="bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 text-green-700 dark:text-green-300 px-4 py-3 rounded-lg text-sm">
            {success}
          </div>
        )}
        {error && (
          <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 text-red-700 dark:text-red-300 px-4 py-3 rounded-lg text-sm">
            {error}
          </div>
        )}

        {/* Project selector */}
        {projects.length > 0 && (
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Project</label>
            <select
              value={selectedProjectId}
              onChange={e => setSelectedProjectId(e.target.value)}
              className="px-3 py-2 border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-900/50 text-gray-900 dark:text-gray-100 rounded-lg text-sm"
            >
              <option value="">All projects</option>
              {projects.map(p => (
                <option key={p.id} value={p.id}>{p.title}</option>
              ))}
            </select>
          </div>
        )}

            {/* Beta Readers */}
            <div className="bg-white dark:bg-gray-800 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700 p-6">
              <div className="flex items-center justify-between mb-4">
                <div>
                  <h2 className="font-display text-lg font-semibold text-gray-900 dark:text-gray-100">Beta Readers</h2>
                  <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">
                    Beta readers get instant access to all published chapters, regardless of embargo schedules.
                  </p>
                </div>
                <button
                  onClick={() => setShowBetaForm(!showBetaForm)}
                  className="px-3 py-1.5 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors text-sm font-medium"
                >
                  + Add
                </button>
              </div>

              {betaReaders.length === 0 && !showBetaForm && (
                <p className="text-sm text-gray-500 dark:text-gray-400 italic">No beta readers yet.</p>
              )}

              {betaReaders.length > 0 && (
                <div className="space-y-2 mb-4">
                  {betaReaders.map(({ betaReader: br, user }) => (
                    <div key={br.id} className="flex items-center justify-between p-3 bg-gray-50 dark:bg-gray-900/30 rounded-lg text-sm">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-medium text-gray-900 dark:text-gray-100">
                          {user?.username ? `@${user.username}` : user?.name || 'Unknown'}
                        </span>
                        <span className={`px-1.5 py-0.5 text-xs rounded ${
                          br.accessLevel === 'arc' ? 'bg-purple-100 dark:bg-purple-900/30 text-purple-700 dark:text-purple-300' :
                          br.accessLevel === 'early_access' ? 'bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300' :
                          'bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300'
                        }`}>
                          {accessLevelLabels[br.accessLevel] || br.accessLevel}
                        </span>
                        {!br.projectId && (
                          <span className="px-1.5 py-0.5 bg-gray-100 dark:bg-gray-700 text-gray-500 dark:text-gray-400 text-xs rounded">
                            All projects
                          </span>
                        )}
                        {!br.isActive && (
                          <span className="px-1.5 py-0.5 bg-red-100 dark:bg-red-900/30 text-red-600 dark:text-red-400 text-xs rounded">
                            Inactive
                          </span>
                        )}
                        {br.notes && (
                          <span className="text-gray-400 dark:text-gray-500 text-xs" title={br.notes}>
                            {br.notes.length > 30 ? br.notes.slice(0, 30) + '...' : br.notes}
                          </span>
                        )}
                      </div>
                      <div className="flex items-center gap-1">
                        <button
                          onClick={() => toggleBetaReaderActive(br.id, br.isActive)}
                          className="px-2 py-1 text-xs text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200"
                          title={br.isActive ? 'Deactivate' : 'Activate'}
                        >
                          {br.isActive ? 'Pause' : 'Resume'}
                        </button>
                        <button
                          onClick={() => removeBetaReader(br.id)}
                          className="px-2 py-1 text-xs text-red-500 hover:text-red-700"
                        >
                          Remove
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {showBetaForm && (
                <div className="border border-blue-200 dark:border-blue-800 rounded-lg p-4 bg-blue-50/30 dark:bg-blue-950/10">
                  <div className="space-y-3">
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Username</label>
                        <div className="flex gap-2">
                          <input
                            type="text"
                            value={betaForm.username}
                            onChange={e => {
                              setBetaForm({ ...betaForm, username: e.target.value })
                              setLookupResult(null)
                              setLookupError(null)
                            }}
                            className="flex-1 px-3 py-2 border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-900/50 text-gray-900 dark:text-gray-100 rounded-lg text-sm"
                            placeholder="username"
                          />
                          <button
                            onClick={() => lookupUser(betaForm.username, setLookupResult, setLookupError)}
                            disabled={!betaForm.username.trim()}
                            className="px-3 py-2 bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 rounded-lg text-sm hover:bg-gray-200 dark:hover:bg-gray-600 disabled:opacity-50"
                          >
                            Find
                          </button>
                        </div>
                        {lookupResult && (
                          <p className="text-xs text-green-600 dark:text-green-400 mt-1">Found: {lookupResult.displayName}</p>
                        )}
                        {lookupError && (
                          <p className="text-xs text-red-500 mt-1">{lookupError}</p>
                        )}
                      </div>
                      <div>
                        <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Access Level</label>
                        <select
                          value={betaForm.accessLevel}
                          onChange={e => setBetaForm({ ...betaForm, accessLevel: e.target.value as any })}
                          className="w-full px-3 py-2 border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-900/50 text-gray-900 dark:text-gray-100 rounded-lg text-sm"
                        >
                          <option value="beta">Beta Reader</option>
                          <option value="arc">ARC Reader</option>
                          <option value="early_access">Early Access</option>
                        </select>
                      </div>
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Notes (optional)</label>
                        <input
                          type="text"
                          value={betaForm.notes}
                          onChange={e => setBetaForm({ ...betaForm, notes: e.target.value })}
                          className="w-full px-3 py-2 border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-900/50 text-gray-900 dark:text-gray-100 rounded-lg text-sm"
                          placeholder="e.g. editor, sensitivity reader"
                        />
                      </div>
                      <div className="flex items-end">
                        <label className="flex items-center gap-2 text-sm text-gray-600 dark:text-gray-400 pb-2">
                          <input
                            type="checkbox"
                            checked={betaForm.perProject}
                            onChange={e => setBetaForm({ ...betaForm, perProject: e.target.checked })}
                            className="rounded border-gray-300"
                          />
                          This project only
                        </label>
                      </div>
                    </div>
                    <div className="flex justify-end gap-2">
                      <button onClick={() => { setShowBetaForm(false); setLookupResult(null); setLookupError(null) }} className="px-4 py-2 text-sm text-gray-600 dark:text-gray-400">Cancel</button>
                      <button
                        onClick={addBetaReader}
                        disabled={saving || !lookupResult}
                        className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors text-sm font-medium disabled:opacity-50"
                      >
                        {saving ? 'Adding...' : 'Add Beta Reader'}
                      </button>
                    </div>
                  </div>
                </div>
              )}
            </div>

            {/* Access Grants */}
            <div className="bg-white dark:bg-gray-800 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700 p-6">
              <div className="flex items-center justify-between mb-4">
                <div>
                  <h2 className="font-display text-lg font-semibold text-gray-900 dark:text-gray-100">Access Grants</h2>
                  <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">
                    Grant specific users access to your content. Use for gifts, comps, or promotional access.
                  </p>
                </div>
                <button
                  onClick={() => setShowGrantForm(!showGrantForm)}
                  className="px-3 py-1.5 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors text-sm font-medium"
                >
                  + Grant Access
                </button>
              </div>

              {accessGrants.length === 0 && !showGrantForm && (
                <p className="text-sm text-gray-500 dark:text-gray-400 italic">No active access grants.</p>
              )}

              {accessGrants.length > 0 && (
                <div className="space-y-2 mb-4">
                  {accessGrants.map(({ grant, user }) => (
                    <div key={grant.id} className="flex items-center justify-between p-3 bg-gray-50 dark:bg-gray-900/30 rounded-lg text-sm">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-medium text-gray-900 dark:text-gray-100">
                          {user?.username ? `@${user.username}` : user?.name || 'Unknown'}
                        </span>
                        <span className={`px-1.5 py-0.5 text-xs rounded ${
                          grant.grantType === 'gift' ? 'bg-pink-100 dark:bg-pink-900/30 text-pink-700 dark:text-pink-300' :
                          grant.grantType === 'promotional' ? 'bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300' :
                          'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-300'
                        }`}>
                          {grantTypeLabels[grant.grantType] || grant.grantType}
                        </span>
                        {!grant.projectId && (
                          <span className="px-1.5 py-0.5 bg-gray-100 dark:bg-gray-700 text-gray-500 dark:text-gray-400 text-xs rounded">
                            All projects
                          </span>
                        )}
                        {grant.expiresAt && (
                          <span className="text-gray-400 dark:text-gray-500 text-xs">
                            Expires {new Date(grant.expiresAt).toLocaleDateString()}
                          </span>
                        )}
                        {grant.reason && (
                          <span className="text-gray-400 dark:text-gray-500 text-xs" title={grant.reason}>
                            {grant.reason.length > 30 ? grant.reason.slice(0, 30) + '...' : grant.reason}
                          </span>
                        )}
                      </div>
                      <button
                        onClick={() => revokeAccessGrant(grant.id)}
                        className="px-2 py-1 text-xs text-red-500 hover:text-red-700"
                      >
                        Revoke
                      </button>
                    </div>
                  ))}
                </div>
              )}

              {showGrantForm && (
                <div className="border border-blue-200 dark:border-blue-800 rounded-lg p-4 bg-blue-50/30 dark:bg-blue-950/10">
                  <div className="space-y-3">
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Username</label>
                        <div className="flex gap-2">
                          <input
                            type="text"
                            value={grantForm.username}
                            onChange={e => {
                              setGrantForm({ ...grantForm, username: e.target.value })
                              setGrantLookupResult(null)
                              setGrantLookupError(null)
                            }}
                            className="flex-1 px-3 py-2 border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-900/50 text-gray-900 dark:text-gray-100 rounded-lg text-sm"
                            placeholder="username"
                          />
                          <button
                            onClick={() => lookupUser(grantForm.username, setGrantLookupResult, setGrantLookupError)}
                            disabled={!grantForm.username.trim()}
                            className="px-3 py-2 bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 rounded-lg text-sm hover:bg-gray-200 dark:hover:bg-gray-600 disabled:opacity-50"
                          >
                            Find
                          </button>
                        </div>
                        {grantLookupResult && (
                          <p className="text-xs text-green-600 dark:text-green-400 mt-1">Found: {grantLookupResult.displayName}</p>
                        )}
                        {grantLookupError && (
                          <p className="text-xs text-red-500 mt-1">{grantLookupError}</p>
                        )}
                      </div>
                      <div>
                        <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Grant Type</label>
                        <select
                          value={grantForm.grantType}
                          onChange={e => setGrantForm({ ...grantForm, grantType: e.target.value as any })}
                          className="w-full px-3 py-2 border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-900/50 text-gray-900 dark:text-gray-100 rounded-lg text-sm"
                        >
                          <option value="comp">Comp (complimentary)</option>
                          <option value="gift">Gift</option>
                          <option value="beta">Beta</option>
                          <option value="promotional">Promotional</option>
                        </select>
                      </div>
                    </div>
                    <div className="grid grid-cols-3 gap-3">
                      <div>
                        <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Expires (optional)</label>
                        <input
                          type="date"
                          value={grantForm.expiresAt}
                          onChange={e => setGrantForm({ ...grantForm, expiresAt: e.target.value })}
                          className="w-full px-3 py-2 border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-900/50 text-gray-900 dark:text-gray-100 rounded-lg text-sm"
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Reason (optional)</label>
                        <input
                          type="text"
                          value={grantForm.reason}
                          onChange={e => setGrantForm({ ...grantForm, reason: e.target.value })}
                          className="w-full px-3 py-2 border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-900/50 text-gray-900 dark:text-gray-100 rounded-lg text-sm"
                          placeholder="e.g. review copy"
                        />
                      </div>
                      <div className="flex items-end">
                        <label className="flex items-center gap-2 text-sm text-gray-600 dark:text-gray-400 pb-2">
                          <input
                            type="checkbox"
                            checked={grantForm.perProject}
                            onChange={e => setGrantForm({ ...grantForm, perProject: e.target.checked })}
                            className="rounded border-gray-300"
                          />
                          This project only
                        </label>
                      </div>
                    </div>
                    <div className="flex justify-end gap-2">
                      <button onClick={() => { setShowGrantForm(false); setGrantLookupResult(null); setGrantLookupError(null) }} className="px-4 py-2 text-sm text-gray-600 dark:text-gray-400">Cancel</button>
                      <button
                        onClick={addAccessGrant}
                        disabled={saving || !grantLookupResult}
                        className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors text-sm font-medium disabled:opacity-50"
                      >
                        {saving ? 'Granting...' : 'Grant Access'}
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
