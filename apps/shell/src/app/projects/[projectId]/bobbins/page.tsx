'use client'

import { useState, useEffect, useCallback, Suspense } from 'react'
import { useParams, useRouter, useSearchParams } from 'next/navigation'
import { useSession } from 'next-auth/react'
import { BobbinrySDK } from '@bobbinry/sdk'
import { ClientWrapper } from '@/components/ClientWrapper'
import { apiFetch } from '@/lib/api'
import {
  BobbinCard,
  BobbinDetailModal,
  BobbinFilters,
  useBobbinFilters,
} from '@/components/bobbins'
import type { BobbinMetadata, InstalledBobbin } from '@/components/bobbins'
import type { BobbinScope } from '@/components/bobbins/types'

interface UserCollection {
  id: string
  name: string
}

function BobbinsContent() {
  const params = useParams()
  const router = useRouter()
  const searchParams = useSearchParams()
  const { data: session } = useSession()
  const projectId = params.projectId as string
  const slotFilter = searchParams.get('slot') || undefined
  const setupStatus = searchParams.get('setup')
  const [sdk] = useState(() => new BobbinrySDK('shell'))
  const [availableBobbins, setAvailableBobbins] = useState<BobbinMetadata[]>([])
  const [installedBobbins, setInstalledBobbins] = useState<InstalledBobbin[]>([])
  const [loading, setLoading] = useState(true)
  const [searchQuery, setSearchQuery] = useState('')
  const [selectedCategory, setSelectedCategory] = useState('all')
  const [filterMode, setFilterMode] = useState<'all' | 'installed' | 'available'>('all')
  const [sortBy, setSortBy] = useState<'name' | 'author' | 'recent'>('name')
  const [selectedBobbin, setSelectedBobbin] = useState<BobbinMetadata | null>(null)
  const [actionMessage, setActionMessage] = useState<{ type: 'success' | 'error', text: string } | null>(null)
  const [actionInProgress, setActionInProgress] = useState<string | null>(null)
  const [scopePickerBobbin, setScopePickerBobbin] = useState<BobbinMetadata | null>(null)
  const [userCollections, setUserCollections] = useState<UserCollection[]>([])
  const [collectionsLoaded, setCollectionsLoaded] = useState(false)

  const loadAvailableBobbins = async () => {
    try {
      const response = await fetch('/api/marketplace/bobbins')
      const data = await response.json()
      return data.bobbins || []
    } catch (error) {
      console.error('Failed to load available bobbins:', error)
      return []
    }
  }

  const loadInstalledBobbins = async () => {
    try {
      const response = await sdk.api.getInstalledBobbins(projectId)
      return response.bobbins || []
    } catch (error) {
      console.error('Failed to load installed bobbins:', error)
      return []
    }
  }

  const enrichBobbins = (available: any[], installed: InstalledBobbin[]) => {
    const installedIds = new Set(installed.map(b => b.id))
    const installedVersions = new Map(installed.map(b => [b.id, b.version]))
    const installedScopes = new Map(installed.map(b => [b.id, b.scope || 'project']))
    return available.map((bobbin: any) => ({
      ...bobbin,
      scopes: bobbin.install?.scopes || ['project'],
      isInstalled: installedIds.has(bobbin.id),
      installedVersion: installedVersions.get(bobbin.id),
      installedScope: installedScopes.get(bobbin.id),
    }))
  }

  useEffect(() => {
    if (session?.apiToken) {
      sdk.api.setAuthToken(session.apiToken)
    }
  }, [session?.apiToken, sdk])

  useEffect(() => {
    if (!session?.apiToken) return

    const loadAllData = async () => {
      setLoading(true)
      const [available, installed] = await Promise.all([
        loadAvailableBobbins(),
        loadInstalledBobbins()
      ])
      setAvailableBobbins(enrichBobbins(available, installed))
      setInstalledBobbins(installed)
      setLoading(false)
    }

    if (typeof window !== 'undefined') {
      loadAllData()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId, session?.apiToken])

  useEffect(() => {
    if (setupStatus === 'template-failed') {
      setActionMessage({
        type: 'error',
        text: 'Project created, but template bobbins did not fully install. Install missing bobbins below.'
      })
    }
  }, [setupStatus])

  const loadUserCollections = useCallback(async () => {
    if (collectionsLoaded || !session?.apiToken) return
    try {
      const res = await apiFetch('/api/users/me/collections', session.apiToken)
      if (res.ok) {
        const data = await res.json()
        setUserCollections((data.collections || []).map((c: any) => ({ id: c.id, name: c.name })))
      }
    } catch (err) {
      console.error('Failed to load collections:', err)
    } finally {
      setCollectionsLoaded(true)
    }
  }, [collectionsLoaded, session?.apiToken])

  /** Called when user clicks Install — shows scope picker if bobbin supports multiple scopes */
  const handleInstallClick = (bobbin: BobbinMetadata) => {
    const scopes: BobbinScope[] = (bobbin as any).scopes || ['project']
    if (scopes.length <= 1) {
      // Single scope — install directly
      installToScope(bobbin, 'project')
    } else {
      // Multi-scope — open picker
      loadUserCollections()
      setScopePickerBobbin(bobbin)
    }
  }

  /** Install a bobbin to a specific scope */
  const installToScope = async (bobbin: BobbinMetadata, scope: BobbinScope, collectionId?: string) => {
    setScopePickerBobbin(null)
    setActionInProgress(bobbin.id)
    setActionMessage(null)

    try {
      if (scope === 'project') {
        await sdk.api.installBobbin(projectId, bobbin.manifestContent, 'yaml')
      } else if (scope === 'collection' && collectionId) {
        const res = await apiFetch(`/api/collections/${collectionId}/bobbins/install`, session!.apiToken!, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ manifestContent: bobbin.manifestContent, manifestType: 'yaml' }),
        })
        if (!res.ok) {
          const err = await res.json().catch(() => ({ error: 'Installation failed' }))
          throw new Error(err.error || 'Installation failed')
        }
      } else if (scope === 'global') {
        const res = await apiFetch('/api/users/me/bobbins/install', session!.apiToken!, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ manifestContent: bobbin.manifestContent, manifestType: 'yaml' }),
        })
        if (!res.ok) {
          const err = await res.json().catch(() => ({ error: 'Installation failed' }))
          throw new Error(err.error || 'Installation failed')
        }
      }

      const [available, installed] = await Promise.all([
        loadAvailableBobbins(),
        loadInstalledBobbins()
      ])
      setAvailableBobbins(enrichBobbins(available, installed))
      setInstalledBobbins(installed)
      const scopeLabel = scope === 'project' ? 'project' : scope === 'collection' ? 'series' : 'globally'
      setActionMessage({ type: 'success', text: `${bobbin.name} installed to ${scopeLabel}!` })
      setTimeout(() => setActionMessage(null), 3000)
    } catch (error) {
      setActionMessage({
        type: 'error',
        text: `Failed to install ${bobbin.name}: ${error instanceof Error ? error.message : 'Unknown error'}`
      })
    } finally {
      setActionInProgress(null)
    }
  }

  const uninstallBobbin = async (bobbinId: string) => {
    setActionInProgress(bobbinId)
    setActionMessage(null)

    try {
      await sdk.api.uninstallBobbin(projectId, bobbinId)

      const [available, installed] = await Promise.all([
        loadAvailableBobbins(),
        loadInstalledBobbins()
      ])
      setAvailableBobbins(enrichBobbins(available, installed))
      setInstalledBobbins(installed)
      setActionMessage({ type: 'success', text: 'Bobbin uninstalled successfully!' })
      setTimeout(() => setActionMessage(null), 3000)
    } catch (error) {
      setActionMessage({
        type: 'error',
        text: `Failed to uninstall: ${error instanceof Error ? error.message : 'Unknown error'}`
      })
    } finally {
      setActionInProgress(null)
    }
  }

  const filteredBobbins = useBobbinFilters(availableBobbins, {
    searchQuery,
    selectedCategory,
    filterMode,
    filterSlot: slotFilter,
    sortBy,
  })

  if (loading) {
    return (
      <div className="h-screen flex items-center justify-center bg-gray-50 dark:bg-gray-950">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto mb-4" />
          <p className="text-gray-600 dark:text-gray-400">Loading bobbins...</p>
        </div>
      </div>
    )
  }

  return (
    <div className="h-screen flex flex-col bg-gray-50 dark:bg-gray-950">
      {/* Header */}
      <div className="bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700 px-6 py-4">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">Bobbins</h1>
            <p className="text-sm text-gray-600 dark:text-gray-400 mt-1">
              {availableBobbins.length} available &middot; {installedBobbins.length} installed
            </p>
          </div>
          <button
            onClick={() => router.push(`/projects/${projectId}`)}
            className="px-4 py-2 text-sm bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 rounded-md hover:bg-gray-200 dark:hover:bg-gray-600"
          >
            &larr; Back to Dashboard
          </button>
        </div>

        {actionMessage && (
          <div className={`mt-4 p-3 rounded-md text-sm ${
            actionMessage.type === 'success'
              ? 'bg-green-50 dark:bg-green-900/20 text-green-800 dark:text-green-200'
              : 'bg-red-50 dark:bg-red-900/20 text-red-800 dark:text-red-200'
          }`}>
            {actionMessage.text}
          </div>
        )}
      </div>

      {/* Slot filter banner */}
      {slotFilter && (
        <div className="bg-blue-50 dark:bg-blue-900/20 border-b border-blue-200 dark:border-blue-800 px-6 py-2 flex items-center justify-between">
          <span className="text-sm text-blue-800 dark:text-blue-200">
            Showing bobbins for: <strong>{slotFilter === 'shell.rightPanel' ? 'Right Panel' : slotFilter === 'shell.leftPanel' ? 'Left Panel' : slotFilter}</strong>
          </span>
          <button
            onClick={() => router.replace(`/projects/${projectId}/bobbins`)}
            className="text-sm text-blue-600 dark:text-blue-400 hover:text-blue-700 dark:hover:text-blue-300"
          >
            Show all
          </button>
        </div>
      )}

      {/* Filters */}
      <div className="bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700 px-6 py-4">
        <BobbinFilters
          searchQuery={searchQuery}
          onSearchChange={setSearchQuery}
          selectedCategory={selectedCategory}
          onCategoryChange={setSelectedCategory}
          filterMode={filterMode}
          onFilterModeChange={setFilterMode}
          sortBy={sortBy}
          onSortChange={setSortBy}
        />
      </div>

      {/* Bobbin Grid */}
      <div className="flex-1 overflow-auto p-6">
        {filteredBobbins.length === 0 ? (
          <div className="text-center py-12">
            <p className="text-gray-500 dark:text-gray-400">No bobbins found matching your filters.</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {filteredBobbins.map(bobbin => (
              <BobbinCard
                key={bobbin.id}
                bobbin={bobbin}
                onViewDetails={() => setSelectedBobbin(bobbin)}
                actionSlot={
                  bobbin.isInstalled ? (
                    <div className="flex items-center gap-2">
                      {(bobbin as any).installedScope && (bobbin as any).installedScope !== 'project' && (
                        <span className={`text-xs px-2 py-1 rounded font-medium ${
                          (bobbin as any).installedScope === 'collection'
                            ? 'bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-300'
                            : 'bg-teal-100 text-teal-700 dark:bg-teal-900/30 dark:text-teal-300'
                        }`}>
                          {(bobbin as any).installedScope === 'collection' ? 'Series' : 'Global'}
                        </span>
                      )}
                      <button
                        onClick={() => uninstallBobbin(bobbin.id)}
                        disabled={actionInProgress === bobbin.id}
                        className="px-4 py-2 text-sm bg-red-600 text-white rounded-md hover:bg-red-700 disabled:opacity-50"
                      >
                        {actionInProgress === bobbin.id ? 'Removing...' : 'Uninstall'}
                      </button>
                    </div>
                  ) : (
                    <button
                      onClick={() => handleInstallClick(bobbin)}
                      disabled={actionInProgress === bobbin.id}
                      className="px-4 py-2 text-sm bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-50"
                    >
                      {actionInProgress === bobbin.id ? 'Installing...' : 'Install'}
                    </button>
                  )
                }
              />
            ))}
          </div>
        )}
      </div>

      {/* Detail Modal */}
      {selectedBobbin && (
        <BobbinDetailModal
          bobbin={selectedBobbin}
          onClose={() => setSelectedBobbin(null)}
          actionSlot={
            selectedBobbin.isInstalled ? (
              <button
                onClick={() => { uninstallBobbin(selectedBobbin.id); setSelectedBobbin(null) }}
                className="px-4 py-2 text-sm bg-red-600 text-white rounded-md hover:bg-red-700"
              >
                Uninstall
              </button>
            ) : (
              <button
                onClick={() => { handleInstallClick(selectedBobbin); setSelectedBobbin(null) }}
                className="px-4 py-2 text-sm bg-blue-600 text-white rounded-md hover:bg-blue-700"
              >
                Install
              </button>
            )
          }
        />
      )}

      {/* Scope Picker Modal */}
      {scopePickerBobbin && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="bg-white dark:bg-gray-800 rounded-lg shadow-xl w-full max-w-md mx-4 overflow-hidden">
            <div className="px-6 py-4 border-b border-gray-200 dark:border-gray-700">
              <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
                Install {scopePickerBobbin.name}
              </h3>
              <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
                Choose where to install this bobbin
              </p>
            </div>

            <div className="p-4 space-y-2">
              {/* Project scope */}
              {((scopePickerBobbin as any).scopes as BobbinScope[] || ['project']).includes('project') && (
                <button
                  onClick={() => installToScope(scopePickerBobbin, 'project')}
                  className="w-full text-left p-3 rounded-lg border border-gray-200 dark:border-gray-700 hover:border-blue-400 dark:hover:border-blue-500 hover:bg-blue-50 dark:hover:bg-blue-900/10 transition-colors"
                >
                  <div className="font-medium text-gray-900 dark:text-gray-100">This project only</div>
                  <div className="text-sm text-gray-500 dark:text-gray-400">
                    Available in this project only
                  </div>
                </button>
              )}

              {/* Collection scope */}
              {((scopePickerBobbin as any).scopes as BobbinScope[] || ['project']).includes('collection') && (
                <>
                  {userCollections.length > 0 ? (
                    userCollections.map(col => (
                      <button
                        key={col.id}
                        onClick={() => installToScope(scopePickerBobbin, 'collection', col.id)}
                        className="w-full text-left p-3 rounded-lg border border-gray-200 dark:border-gray-700 hover:border-purple-400 dark:hover:border-purple-500 hover:bg-purple-50 dark:hover:bg-purple-900/10 transition-colors"
                      >
                        <div className="flex items-center gap-2">
                          <span className="font-medium text-gray-900 dark:text-gray-100">{col.name}</span>
                          <span className="text-[10px] px-1.5 py-0.5 rounded bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-300 font-medium">
                            series
                          </span>
                        </div>
                        <div className="text-sm text-gray-500 dark:text-gray-400">
                          Shared across all projects in this series
                        </div>
                      </button>
                    ))
                  ) : collectionsLoaded ? (
                    <div className="p-3 rounded-lg border border-dashed border-gray-300 dark:border-gray-600 text-center">
                      <div className="text-sm text-gray-400 dark:text-gray-500">
                        No series found. Create a series on the dashboard to install bobbins across projects.
                      </div>
                    </div>
                  ) : (
                    <div className="p-3 text-center text-sm text-gray-400 dark:text-gray-500">
                      Loading series...
                    </div>
                  )}
                </>
              )}

              {/* Global scope */}
              {((scopePickerBobbin as any).scopes as BobbinScope[] || ['project']).includes('global') && (
                <button
                  onClick={() => installToScope(scopePickerBobbin, 'global')}
                  className="w-full text-left p-3 rounded-lg border border-gray-200 dark:border-gray-700 hover:border-teal-400 dark:hover:border-teal-500 hover:bg-teal-50 dark:hover:bg-teal-900/10 transition-colors"
                >
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-gray-900 dark:text-gray-100">All projects</span>
                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-teal-100 text-teal-700 dark:bg-teal-900/30 dark:text-teal-300 font-medium">
                      global
                    </span>
                  </div>
                  <div className="text-sm text-gray-500 dark:text-gray-400">
                    Available in every project you own
                  </div>
                </button>
              )}
            </div>

            <div className="px-6 py-3 border-t border-gray-200 dark:border-gray-700 flex justify-end">
              <button
                onClick={() => setScopePickerBobbin(null)}
                className="px-4 py-2 text-sm text-gray-600 dark:text-gray-400 hover:text-gray-800 dark:hover:text-gray-200"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

export default function ProjectBobbinsPage() {
  return (
    <Suspense fallback={
      <div className="h-screen flex items-center justify-center bg-gray-50 dark:bg-gray-950">
        <div className="animate-pulse space-y-4 text-center">
          <div className="h-12 w-12 bg-gray-200 dark:bg-gray-800 rounded-full mx-auto" />
          <div className="h-4 bg-gray-200 dark:bg-gray-800 rounded w-32 mx-auto" />
        </div>
      </div>
    }>
      <ClientWrapper>
        <BobbinsContent />
      </ClientWrapper>
    </Suspense>
  )
}
