'use client'

import { useState, useEffect, useCallback } from 'react'
import { useSession } from 'next-auth/react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { SiteNav } from '@/components/SiteNav'
import { apiFetch } from '@/lib/api'

type ResourceId = 'projects' | 'entities' | 'stats'
type Level = 'none' | 'read' | 'write'

interface Resource {
  id: ResourceId
  label: string
  description: string
  maxLevel: 'read' | 'write'
}

const RESOURCES: Resource[] = [
  {
    id: 'projects',
    label: 'Projects',
    description: 'Your project list, settings, and metadata.',
    maxLevel: 'write',
  },
  {
    id: 'entities',
    label: 'Entities',
    description: 'Characters, places, lore, and other collection items — plus type definitions.',
    maxLevel: 'write',
  },
  {
    id: 'stats',
    label: 'Stats',
    description: 'Dashboard metrics, activity feeds, and project groupings.',
    maxLevel: 'read',
  },
]

const LEVEL_LABEL: Record<Level, string> = {
  none: 'None',
  read: 'Read',
  write: 'Read & Write',
}

const EMPTY_PERMISSIONS: Record<ResourceId, Level> = {
  projects: 'none',
  entities: 'none',
  stats: 'none',
}

const READ_ONLY_PRESET: Record<ResourceId, Level> = {
  projects: 'read',
  entities: 'read',
  stats: 'read',
}

const FULL_ACCESS_PRESET: Record<ResourceId, Level> = {
  projects: 'write',
  entities: 'write',
  stats: 'read',
}

function permissionsToScopes(perms: Record<ResourceId, Level>): string[] {
  const scopes: string[] = []
  for (const r of RESOURCES) {
    const level = perms[r.id]
    if (level === 'none') continue
    scopes.push(`${r.id}:read`)
    if (level === 'write') scopes.push(`${r.id}:write`)
  }
  return scopes
}

function samePermissions(
  a: Record<ResourceId, Level>,
  b: Record<ResourceId, Level>
): boolean {
  return RESOURCES.every(r => a[r.id] === b[r.id])
}

function groupScopesForDisplay(
  scopes: string[]
): Array<{ id: ResourceId; label: string; level: 'read' | 'write' }> {
  const byResource: Partial<Record<ResourceId, Set<string>>> = {}
  for (const s of scopes) {
    const [resource, action] = s.split(':') as [ResourceId, string]
    if (!RESOURCES.find(r => r.id === resource)) continue
    const set = byResource[resource] ?? new Set<string>()
    set.add(action)
    byResource[resource] = set
  }
  return RESOURCES.filter(r => byResource[r.id]).map(r => ({
    id: r.id,
    label: r.label,
    level: byResource[r.id]!.has('write') ? 'write' : 'read',
  }))
}

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
  const [permissions, setPermissions] =
    useState<Record<ResourceId, Level>>(EMPTY_PERMISSIONS)
  const [expiresInDays, setExpiresInDays] = useState<string>('')
  const [creating, setCreating] = useState(false)

  const selectedScopes = permissionsToScopes(permissions)
  const isReadOnlyPreset = samePermissions(permissions, READ_ONLY_PRESET)
  const isFullAccessPreset = samePermissions(permissions, FULL_ACCESS_PRESET)

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
        setPermissions(EMPTY_PERMISSIONS)
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
                Create keys for programmatic access to your data.
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

              {/* Permissions */}
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  Permissions
                </label>
                <p className="text-xs text-gray-500 dark:text-gray-400 mb-3">
                  Pick a level per resource. <span className="text-amber-700 dark:text-amber-400 font-medium">Read &amp; Write</span> lets callers create, update, and delete.
                </p>

                {/* Presets */}
                <div className="flex flex-wrap items-center gap-2 mb-3">
                  <span className="text-[10px] uppercase tracking-[0.12em] text-gray-400 dark:text-gray-500 font-medium">
                    Quick pick
                  </span>
                  <button
                    type="button"
                    onClick={() => setPermissions(READ_ONLY_PRESET)}
                    className={`px-3 py-1 text-xs font-medium rounded-full border transition-colors ${
                      isReadOnlyPreset
                        ? 'bg-blue-600 text-white border-blue-600'
                        : 'bg-white dark:bg-gray-900 text-gray-700 dark:text-gray-300 border-gray-200 dark:border-gray-700 hover:border-blue-500 hover:text-blue-600 dark:hover:text-blue-400'
                    }`}
                  >
                    Read only
                  </button>
                  <button
                    type="button"
                    onClick={() => setPermissions(FULL_ACCESS_PRESET)}
                    className={`px-3 py-1 text-xs font-medium rounded-full border transition-colors ${
                      isFullAccessPreset
                        ? 'bg-amber-600 text-white border-amber-600'
                        : 'bg-white dark:bg-gray-900 text-gray-700 dark:text-gray-300 border-gray-200 dark:border-gray-700 hover:border-amber-500 hover:text-amber-700 dark:hover:text-amber-400'
                    }`}
                  >
                    Full access
                  </button>
                  <button
                    type="button"
                    onClick={() => setPermissions(EMPTY_PERMISSIONS)}
                    className="ml-auto text-xs text-gray-500 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-100 transition-colors"
                  >
                    Clear
                  </button>
                </div>

                {/* Segmented controls per resource */}
                <div className="space-y-2">
                  {RESOURCES.map(resource => {
                    const current = permissions[resource.id]
                    const levels: Level[] =
                      resource.maxLevel === 'write'
                        ? ['none', 'read', 'write']
                        : ['none', 'read']
                    return (
                      <div
                        key={resource.id}
                        className="p-3 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900/40"
                      >
                        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                          <div className="min-w-0">
                            <div className="text-sm font-medium text-gray-900 dark:text-gray-100">
                              {resource.label}
                            </div>
                            <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                              {resource.description}
                            </p>
                          </div>
                          <div className="inline-flex items-center rounded-md border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/50 p-0.5 flex-shrink-0 self-start sm:self-auto">
                            {levels.map(level => {
                              const active = current === level
                              const tone =
                                level === 'write'
                                  ? 'bg-amber-600 text-white'
                                  : level === 'read'
                                    ? 'bg-blue-600 text-white'
                                    : 'bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100'
                              return (
                                <button
                                  key={level}
                                  type="button"
                                  onClick={() =>
                                    setPermissions(p => ({ ...p, [resource.id]: level }))
                                  }
                                  className={`px-3 py-1 text-xs font-medium rounded transition-colors ${
                                    active
                                      ? `${tone} shadow-sm`
                                      : 'text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-100'
                                  }`}
                                  aria-pressed={active}
                                >
                                  {LEVEL_LABEL[level]}
                                </button>
                              )
                            })}
                          </div>
                        </div>
                      </div>
                    )
                  })}
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
                        {groupScopesForDisplay(key.scopes).map(g => (
                          <span
                            key={g.id}
                            className={`inline-flex items-center px-2 py-0.5 rounded text-[10px] font-medium ${
                              g.level === 'write'
                                ? 'bg-amber-50 dark:bg-amber-900/20 text-amber-700 dark:text-amber-400'
                                : 'bg-blue-50 dark:bg-blue-900/20 text-blue-600 dark:text-blue-400'
                            }`}
                          >
                            {g.label}
                            <span className="mx-1 opacity-50">·</span>
                            {g.level === 'write' ? 'Read & Write' : 'Read'}
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

        {/* API Documentation */}
        <section className="mt-12 space-y-6">
          <div>
            <h2 className="font-display text-lg font-semibold text-gray-900 dark:text-gray-100 mb-1">
              How to connect
            </h2>
            <p className="text-sm text-gray-500 dark:text-gray-400">
              Send your key as a Bearer token in the <code className="text-xs bg-gray-100 dark:bg-gray-800 px-1.5 py-0.5 rounded">Authorization</code> header. All responses are JSON.
            </p>
          </div>

          <pre className="bg-gray-900 dark:bg-gray-800 text-gray-100 rounded-lg p-4 text-sm overflow-x-auto">
            <code>{`curl -H "Authorization: Bearer bby_..." \\
  https://api.bobbinry.com/api/projects`}</code>
          </pre>

          <ul className="text-xs text-gray-500 dark:text-gray-400 space-y-1.5 list-disc list-inside">
            <li>Keys are prefixed with <code className="bg-gray-100 dark:bg-gray-800 px-1 py-0.5 rounded">bby_</code> and can be revoked at any time.</li>
            <li>Entity endpoints require <code className="bg-gray-100 dark:bg-gray-800 px-1 py-0.5 rounded">projectId</code> (query or body).</li>
            <li>Write endpoints return <code className="bg-gray-100 dark:bg-gray-800 px-1 py-0.5 rounded">403</code> if the key lacks the matching <code className="bg-gray-100 dark:bg-gray-800 px-1 py-0.5 rounded">:write</code> scope.</li>
            <li>Rate limits: 100 req/min (free), 500 req/min (supporter).</li>
          </ul>

          <details className="group bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-xl overflow-hidden">
            <summary className="flex items-center justify-between gap-3 px-4 py-3 cursor-pointer list-none hover:bg-gray-50 dark:hover:bg-gray-800/50 transition-colors">
              <div>
                <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100">Endpoint reference</h3>
                <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">Every endpoint reachable with an API key, grouped by required scope.</p>
              </div>
              <svg
                className="w-4 h-4 text-gray-400 transition-transform group-open:rotate-180 flex-shrink-0"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
                aria-hidden="true"
              >
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
              </svg>
            </summary>
            <div className="border-t border-gray-200 dark:border-gray-800 overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-gray-50 dark:bg-gray-800/50">
                    <th className="text-left px-4 py-2 text-[11px] uppercase tracking-wider font-semibold text-gray-600 dark:text-gray-400">Endpoint</th>
                    <th className="text-left px-4 py-2 text-[11px] uppercase tracking-wider font-semibold text-gray-600 dark:text-gray-400">Scope</th>
                    <th className="text-left px-4 py-2 text-[11px] uppercase tracking-wider font-semibold text-gray-600 dark:text-gray-400">Description</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                  {(
                    [
                      ['GET /api/projects', 'projects:read', 'List your projects'],
                      ['GET /api/projects/:projectId', 'projects:read', 'Get a single project'],
                      ['POST /api/projects', 'projects:write', 'Create a new project'],
                      ['GET /api/collections/:collection/entities', 'entities:read', 'Query entities in a collection'],
                      ['GET /api/entities/:entityId', 'entities:read', 'Get a single entity'],
                      ['GET /api/projects/:projectId/entity-types', 'entities:read', 'List entity type definitions'],
                      ['GET /api/projects/:projectId/entity-types/:typeId', 'entities:read', 'Get a single entity type definition'],
                      ['POST /api/entities', 'entities:write', 'Create an entity'],
                      ['PUT /api/entities/:entityId', 'entities:write', 'Update an entity'],
                      ['DELETE /api/entities/:entityId', 'entities:write', 'Delete an entity'],
                      ['POST /api/entities/batch/atomic', 'entities:write', 'Atomic batch create / update / delete'],
                      ['POST /api/projects/:projectId/entity-types', 'entities:write', 'Create an entity type definition'],
                      ['PUT /api/projects/:projectId/entity-types/:typeId', 'entities:write', 'Update an entity type definition'],
                      ['DELETE /api/projects/:projectId/entity-types/:typeId', 'entities:write', 'Delete an entity type definition'],
                      ['GET /api/dashboard/stats', 'stats:read', 'Dashboard overview stats'],
                      ['GET /api/users/me/projects', 'stats:read', 'Projects with collection info'],
                      ['GET /api/users/me/projects/grouped', 'stats:read', 'Projects grouped by collection'],
                      ['GET /api/users/me/recent-activity', 'stats:read', 'Recent entity edits across projects'],
                    ] as const
                  ).map(([endpoint, scope, desc]) => {
                    const isWrite = scope.endsWith(':write')
                    return (
                      <tr key={endpoint}>
                        <td className="px-4 py-2 font-mono text-[11px] text-gray-700 dark:text-gray-300 whitespace-nowrap">
                          {endpoint}
                        </td>
                        <td className="px-4 py-2 whitespace-nowrap">
                          <span
                            className={`inline-flex items-center px-1.5 py-0.5 rounded font-mono text-[10px] font-medium ${
                              isWrite
                                ? 'bg-amber-50 dark:bg-amber-900/20 text-amber-700 dark:text-amber-400'
                                : 'bg-blue-50 dark:bg-blue-900/20 text-blue-600 dark:text-blue-400'
                            }`}
                          >
                            {scope}
                          </span>
                        </td>
                        <td className="px-4 py-2 text-xs text-gray-600 dark:text-gray-400">{desc}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </details>
        </section>
      </div>
    </div>
  )
}
