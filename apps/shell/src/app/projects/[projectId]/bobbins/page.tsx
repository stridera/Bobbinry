'use client'

import { useState, useEffect, Suspense } from 'react'
import { useParams, useRouter, useSearchParams } from 'next/navigation'
import { useSession } from 'next-auth/react'
import { BobbinrySDK } from '@bobbinry/sdk'
import { ClientWrapper } from '@/components/ClientWrapper'
import {
  BobbinCard,
  BobbinDetailModal,
  BobbinFilters,
  useBobbinFilters,
} from '@/components/bobbins'
import type { BobbinMetadata, InstalledBobbin } from '@/components/bobbins'

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
  const [filterExecution, setFilterExecution] = useState<'all' | 'native' | 'sandboxed'>('all')
  const [sortBy, setSortBy] = useState<'name' | 'author' | 'recent'>('name')
  const [selectedBobbin, setSelectedBobbin] = useState<BobbinMetadata | null>(null)
  const [actionMessage, setActionMessage] = useState<{ type: 'success' | 'error', text: string } | null>(null)
  const [actionInProgress, setActionInProgress] = useState<string | null>(null)

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
    return available.map((bobbin: any) => ({
      ...bobbin,
      isInstalled: installedIds.has(bobbin.id),
      installedVersion: installedVersions.get(bobbin.id)
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

  const installBobbin = async (bobbin: BobbinMetadata) => {
    setActionInProgress(bobbin.id)
    setActionMessage(null)

    try {
      await sdk.api.installBobbin(projectId, bobbin.manifestContent, 'yaml')

      const [available, installed] = await Promise.all([
        loadAvailableBobbins(),
        loadInstalledBobbins()
      ])
      setAvailableBobbins(enrichBobbins(available, installed))
      setInstalledBobbins(installed)
      setActionMessage({ type: 'success', text: `${bobbin.name} installed successfully!` })
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
    filterExecution,
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
          filterExecution={filterExecution}
          onFilterExecutionChange={setFilterExecution}
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
                    <button
                      onClick={() => uninstallBobbin(bobbin.id)}
                      disabled={actionInProgress === bobbin.id}
                      className="px-4 py-2 text-sm bg-red-600 text-white rounded-md hover:bg-red-700 disabled:opacity-50"
                    >
                      {actionInProgress === bobbin.id ? 'Removing...' : 'Uninstall'}
                    </button>
                  ) : (
                    <button
                      onClick={() => installBobbin(bobbin)}
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
                onClick={() => { installBobbin(selectedBobbin); setSelectedBobbin(null) }}
                className="px-4 py-2 text-sm bg-blue-600 text-white rounded-md hover:bg-blue-700"
              >
                Install
              </button>
            )
          }
        />
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
