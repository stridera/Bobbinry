'use client'

import { useState, useEffect, useCallback } from 'react'
import { useSession } from 'next-auth/react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { SiteNav } from '@/components/SiteNav'
import { apiFetch } from '@/lib/api'

const AVAILABLE_SCOPES = [
  { id: 'projects:read', label: 'Projects', description: 'Read your projects and their settings' },
  { id: 'entities:read', label: 'Entities', description: 'Read entities across your collections' },
  { id: 'stats:read', label: 'Stats', description: 'Read dashboard stats and recent activity' },
  { id: 'profile:read', label: 'Profile', description: 'Read your profile information' },
] as const

interface ApiKey {
  id: string
  name: string
  keyPrefix: string
  scopes: string[]
  lastUsedAt: string | null
  expiresAt: string | null
  createdAt: string
}

export default function ApiKeysPage() {
  const { data: session, status } = useSession()
  const router = useRouter()
  const [keys, setKeys] = useState<ApiKey[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // Create form state
  const [showCreate, setShowCreate] = useState(false)
  const [name, setName] = useState('')
  const [selectedScopes, setSelectedScopes] = useState<string[]>([])
  const [expiresInDays, setExpiresInDays] = useState<string>('')
  const [creating, setCreating] = useState(false)

  // Reveal state — shown once after creation
  const [revealedKey, setRevealedKey] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)

  // Revoke state
  const [revoking, setRevoking] = useState<string | null>(null)

  const apiToken = (session as any)?.apiToken

  const loadKeys = useCallback(async () => {
    if (!apiToken) return
    try {
      const res = await apiFetch('/api/api-keys', apiToken)
      if (res.ok) {
        const data = await res.json()
        setKeys(data.keys || [])
      }
    } catch (err) {
      console.error('Failed to load API keys:', err)
    } finally {
      setLoading(false)
    }
  }, [apiToken])

  useEffect(() => {
    if (status === 'unauthenticated') {
      router.replace('/login')
      return
    }
    if (status === 'authenticated') {
      loadKeys()
    }
  }, [status, loadKeys, router])

  const createKey = async () => {
    if (!apiToken || !name.trim() || selectedScopes.length === 0) return
    setCreating(true)
    setError(null)
    try {
      const body: Record<string, unknown> = {
        name: name.trim(),
        scopes: selectedScopes,
      }
      if (expiresInDays && parseInt(expiresInDays) > 0) {
        body.expiresInDays = parseInt(expiresInDays)
      }

      const res = await apiFetch('/api/api-keys', apiToken, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })

      if (res.ok) {
        const data = await res.json()
        setRevealedKey(data.key)
        setCopied(false)
        setName('')
        setSelectedScopes([])
        setExpiresInDays('')
        setShowCreate(false)
        await loadKeys()
      } else {
        const data = await res.json()
        setError(data.error || 'Failed to create API key')
      }
    } catch (err) {
      console.error('Failed to create API key:', err)
      setError('Failed to create API key')
    } finally {
      setCreating(false)
    }
  }

  const revokeKey = async (keyId: string) => {
    if (!apiToken) return
    setRevoking(keyId)
    try {
      const res = await apiFetch(`/api/api-keys/${keyId}`, apiToken, {
        method: 'DELETE',
      })
      if (res.ok) {
        setRevealedKey(null)
        await loadKeys()
      }
    } catch (err) {
      console.error('Failed to revoke API key:', err)
    } finally {
      setRevoking(null)
    }
  }

  const copyKey = async () => {
    if (!revealedKey) return
    await navigator.clipboard.writeText(revealedKey)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  const toggleScope = (scopeId: string) => {
    setSelectedScopes(prev =>
      prev.includes(scopeId)
        ? prev.filter(s => s !== scopeId)
        : [...prev, scopeId]
    )
  }

  const formatDate = (dateStr: string | null) => {
    if (!dateStr) return null
    return new Date(dateStr).toLocaleDateString('en-US', {
      month: 'short', day: 'numeric', year: 'numeric'
    })
  }

  const formatRelative = (dateStr: string | null) => {
    if (!dateStr) return 'Never'
    const date = new Date(dateStr)
    const now = new Date()
    const diffMs = now.getTime() - date.getTime()
    const diffMin = Math.floor(diffMs / 60000)
    if (diffMin < 1) return 'Just now'
    if (diffMin < 60) return `${diffMin}m ago`
    const diffHrs = Math.floor(diffMin / 60)
    if (diffHrs < 24) return `${diffHrs}h ago`
    const diffDays = Math.floor(diffHrs / 24)
    if (diffDays < 30) return `${diffDays}d ago`
    return formatDate(dateStr)
  }

  if (status === 'loading' || loading) {
    return (
      <div className="min-h-screen bg-gray-50 dark:bg-gray-950">
        <SiteNav />
        <div className="flex items-center justify-center py-32">
          <p className="text-gray-500 dark:text-gray-400">Loading...</p>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-950">
      <SiteNav />

      <div className="max-w-3xl mx-auto px-4 py-8">
        <div className="mb-8">
          <Link href="/settings" className="text-sm text-blue-600 dark:text-blue-400 hover:underline mb-2 inline-block">
            &larr; Settings
          </Link>
          <div className="flex items-center justify-between">
            <div>
              <h1 className="font-display text-2xl font-bold text-gray-900 dark:text-gray-100">
                API Keys
              </h1>
              <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
                Create keys for programmatic read-only access to your data.
              </p>
            </div>
            {!showCreate && !revealedKey && (
              <button
                onClick={() => setShowCreate(true)}
                className="px-4 py-2 text-sm font-medium bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
              >
                Create key
              </button>
            )}
          </div>
        </div>

        {/* Error */}
        {error && (
          <div className="mb-6 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-4">
            <p className="text-sm text-red-700 dark:text-red-300">{error}</p>
          </div>
        )}

        {/* Key revealed — shown once after creation */}
        {revealedKey && (
          <div className="mb-6 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-xl p-6">
            <h3 className="font-display font-semibold text-amber-900 dark:text-amber-100 mb-2">
              Save your API key
            </h3>
            <p className="text-sm text-amber-700 dark:text-amber-300 mb-4">
              This is the only time the full key will be shown. Copy it now and store it securely.
            </p>
            <div className="flex items-center gap-2">
              <code className="flex-1 px-3 py-2 bg-white dark:bg-gray-900 border border-amber-300 dark:border-amber-700 rounded-lg text-sm font-mono text-gray-900 dark:text-gray-100 select-all break-all">
                {revealedKey}
              </code>
              <button
                onClick={copyKey}
                className="px-3 py-2 text-sm font-medium bg-amber-600 text-white rounded-lg hover:bg-amber-700 transition-colors flex-shrink-0"
              >
                {copied ? 'Copied!' : 'Copy'}
              </button>
            </div>
            <button
              onClick={() => setRevealedKey(null)}
              className="mt-3 text-sm text-amber-700 dark:text-amber-400 hover:underline"
            >
              Dismiss
            </button>
          </div>
        )}

        {/* Create form */}
        {showCreate && (
          <div className="mb-6 bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-200 dark:border-gray-700 p-6">
            <h2 className="font-display text-lg font-semibold text-gray-900 dark:text-gray-100 mb-4">
              Create API Key
            </h2>

            <div className="space-y-4">
              {/* Name */}
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">
                  Key name
                </label>
                <input
                  type="text"
                  value={name}
                  onChange={e => setName(e.target.value)}
                  placeholder="e.g. My CLI key"
                  maxLength={100}
                  className="w-full px-4 py-2.5 border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-900/50 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent text-sm text-gray-900 dark:text-gray-100 placeholder-gray-400 dark:placeholder-gray-500"
                />
              </div>

              {/* Scopes */}
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">
                  Scopes
                </label>
                <p className="text-xs text-gray-500 dark:text-gray-400 mb-2">
                  Choose what data this key can access.
                </p>
                <div className="space-y-2">
                  {AVAILABLE_SCOPES.map(scope => (
                    <label
                      key={scope.id}
                      className="flex items-start gap-3 p-3 rounded-lg border border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-700/50 cursor-pointer transition-colors"
                    >
                      <input
                        type="checkbox"
                        checked={selectedScopes.includes(scope.id)}
                        onChange={() => toggleScope(scope.id)}
                        className="mt-0.5 rounded border-gray-300 dark:border-gray-600 text-blue-600 focus:ring-blue-500"
                      />
                      <div>
                        <span className="text-sm font-medium text-gray-900 dark:text-gray-100">
                          {scope.label}
                        </span>
                        <p className="text-xs text-gray-500 dark:text-gray-400">
                          {scope.description}
                        </p>
                      </div>
                    </label>
                  ))}
                </div>
              </div>

              {/* Expiry */}
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">
                  Expiry (optional)
                </label>
                <select
                  value={expiresInDays}
                  onChange={e => setExpiresInDays(e.target.value)}
                  className="w-full px-4 py-2.5 border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-900/50 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent text-sm text-gray-900 dark:text-gray-100"
                >
                  <option value="">No expiry</option>
                  <option value="7">7 days</option>
                  <option value="30">30 days</option>
                  <option value="90">90 days</option>
                  <option value="365">1 year</option>
                </select>
              </div>

              {/* Actions */}
              <div className="flex items-center gap-3 pt-2">
                <button
                  onClick={createKey}
                  disabled={creating || !name.trim() || selectedScopes.length === 0}
                  className="px-4 py-2 text-sm font-medium bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors disabled:opacity-50"
                >
                  {creating ? 'Creating...' : 'Create key'}
                </button>
                <button
                  onClick={() => { setShowCreate(false); setError(null) }}
                  className="px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg transition-colors"
                >
                  Cancel
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Keys list */}
        {keys.length === 0 && !showCreate ? (
          <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-200 dark:border-gray-700 p-8 text-center">
            <p className="text-gray-500 dark:text-gray-400 text-sm">
              No API keys yet. Create one to get started.
            </p>
          </div>
        ) : keys.length > 0 && (
          <section>
            <h2 className="font-display text-lg font-semibold text-gray-900 dark:text-gray-100 mb-4">
              Active Keys
            </h2>
            <div className="space-y-3">
              {keys.map(key => (
                <div
                  key={key.id}
                  className="p-4 bg-white dark:bg-gray-900 rounded-lg border border-gray-200 dark:border-gray-800"
                >
                  <div className="flex items-start justify-between gap-4">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <h3 className="font-medium text-gray-900 dark:text-gray-100">
                          {key.name}
                        </h3>
                        <code className="text-xs px-1.5 py-0.5 bg-gray-100 dark:bg-gray-800 text-gray-500 dark:text-gray-400 rounded font-mono">
                          {key.keyPrefix}...
                        </code>
                      </div>
                      <div className="flex flex-wrap gap-1.5 mt-2">
                        {key.scopes.map(scope => (
                          <span
                            key={scope}
                            className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium bg-blue-50 dark:bg-blue-900/20 text-blue-600 dark:text-blue-400"
                          >
                            {scope}
                          </span>
                        ))}
                      </div>
                      <div className="flex items-center gap-3 mt-2 text-xs text-gray-500 dark:text-gray-400">
                        <span>Created {formatDate(key.createdAt)}</span>
                        <span>Last used: {formatRelative(key.lastUsedAt)}</span>
                        {key.expiresAt && (
                          <span>Expires {formatDate(key.expiresAt)}</span>
                        )}
                      </div>
                    </div>
                    <button
                      onClick={() => revokeKey(key.id)}
                      disabled={revoking === key.id}
                      className="px-3 py-1.5 text-xs text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/10 rounded transition-colors disabled:opacity-50 flex-shrink-0"
                    >
                      {revoking === key.id ? 'Revoking...' : 'Revoke'}
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </section>
        )}

        {/* Usage hint */}
        <div className="mt-8 p-4 bg-gray-100 dark:bg-gray-800/50 rounded-lg border border-gray-200 dark:border-gray-700">
          <h3 className="text-sm font-medium text-gray-900 dark:text-gray-100 mb-2">Usage</h3>
          <code className="block text-xs text-gray-600 dark:text-gray-400 font-mono break-all">
            curl -H &quot;Authorization: Bearer bby_...&quot; {typeof window !== 'undefined' ? window.location.origin.replace(/:\d+$/, ':4100') : 'https://api.bobbinry.com'}/api/projects
          </code>
        </div>
      </div>
    </div>
  )
}
