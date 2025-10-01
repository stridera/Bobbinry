'use client'

import { useState, useEffect, useMemo } from 'react'
import Link from 'next/link'
import { BobbinrySDK } from '@bobbinry/sdk'
import { ShellLayout } from '@/components/ShellLayout'
import { ClientWrapper } from '@/components/ClientWrapper'

interface BobbinMetadata {
  id: string
  name: string
  version: string
  author: string
  description: string
  tags: string[]
  license?: string
  capabilities: {
    publishable?: boolean
    external?: boolean
    ai?: boolean
    customViews?: boolean
  }
  execution?: {
    mode: 'native' | 'sandboxed'
    signature?: string
  }
  manifestPath: string
  isInstalled: boolean
  installedVersion?: string
}

interface InstalledBobbin {
  id: string
  version: string
  manifest: any
  installedAt: string
}

function MarketplaceContent() {
  const [sdk] = useState(() => new BobbinrySDK('shell'))
  const [currentProject] = useState<string>('550e8400-e29b-41d4-a716-446655440001')
  const [availableBobbins, setAvailableBobbins] = useState<BobbinMetadata[]>([])
  const [installedBobbins, setInstalledBobbins] = useState<InstalledBobbin[]>([])
  const [loading, setLoading] = useState(true)
  const [searchQuery, setSearchQuery] = useState('')
  const [filterMode, setFilterMode] = useState<'all' | 'installed' | 'available'>('all')
  const [filterExecution, setFilterExecution] = useState<'all' | 'native' | 'sandboxed'>('all')
  const [sortBy, setSortBy] = useState<'name' | 'author' | 'recent'>('name')
  const [selectedBobbin, setSelectedBobbin] = useState<BobbinMetadata | null>(null)
  const [actionMessage, setActionMessage] = useState<{ type: 'success' | 'error', text: string } | null>(null)
  const [actionInProgress, setActionInProgress] = useState<string | null>(null)

  // Load available bobbins from the bobbins directory
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

  // Load installed bobbins
  const loadInstalledBobbins = async () => {
    try {
      const response = await sdk.api.getInstalledBobbins(currentProject)
      return response.bobbins || []
    } catch (error) {
      console.error('Failed to load installed bobbins:', error)
      return []
    }
  }

  // Load all bobbins on mount
  useEffect(() => {
    const loadAllData = async () => {
      setLoading(true)
      const [available, installed] = await Promise.all([
        loadAvailableBobbins(),
        loadInstalledBobbins()
      ])

      // Mark installed bobbins
      const installedIds = new Set(installed.map((b: InstalledBobbin) => b.id))
      const installedVersions = new Map(installed.map((b: InstalledBobbin) => [b.id, b.version]))

      const enriched = available.map((bobbin: any) => ({
        ...bobbin,
        isInstalled: installedIds.has(bobbin.id),
        installedVersion: installedVersions.get(bobbin.id)
      }))

      setAvailableBobbins(enriched)
      setInstalledBobbins(installed)
      setLoading(false)
    }

    if (typeof window !== 'undefined') {
      loadAllData()
    }
  }, [currentProject])

  // Install bobbin
  const installBobbin = async (bobbin: BobbinMetadata) => {
    setActionInProgress(bobbin.id)
    setActionMessage(null)

    try {
      // Fetch manifest content
      const manifestResponse = await fetch(bobbin.manifestPath)
      const manifestContent = await manifestResponse.text()

      await sdk.api.installBobbin(currentProject, manifestContent, 'yaml')

      // Reload data
      const [available, installed] = await Promise.all([
        loadAvailableBobbins(),
        loadInstalledBobbins()
      ])

      const installedIds = new Set(installed.map((b: InstalledBobbin) => b.id))
      const installedVersions = new Map(installed.map((b: InstalledBobbin) => [b.id, b.version]))

      const enriched = available.map((b: any) => ({
        ...b,
        isInstalled: installedIds.has(b.id),
        installedVersion: installedVersions.get(b.id)
      }))

      setAvailableBobbins(enriched)
      setInstalledBobbins(installed)
      setActionMessage({ type: 'success', text: `${bobbin.name} installed successfully!` })

      // Auto-clear message after 3s
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

  // Uninstall bobbin
  const uninstallBobbin = async (bobbinId: string) => {
    setActionInProgress(bobbinId)
    setActionMessage(null)

    try {
      await sdk.api.uninstallBobbin(currentProject, bobbinId)

      // Reload data
      const [available, installed] = await Promise.all([
        loadAvailableBobbins(),
        loadInstalledBobbins()
      ])

      const installedIds = new Set(installed.map((b: InstalledBobbin) => b.id))
      const installedVersions = new Map(installed.map((b: InstalledBobbin) => [b.id, b.version]))

      const enriched = available.map((b: any) => ({
        ...b,
        isInstalled: installedIds.has(b.id),
        installedVersion: installedVersions.get(b.id)
      }))

      setAvailableBobbins(enriched)
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

  // Filter and sort bobbins
  const filteredAndSortedBobbins = useMemo(() => {
    let filtered = availableBobbins

    // Filter by search query
    if (searchQuery) {
      const query = searchQuery.toLowerCase()
      filtered = filtered.filter(bobbin =>
        bobbin.name.toLowerCase().includes(query) ||
        bobbin.description.toLowerCase().includes(query) ||
        bobbin.author.toLowerCase().includes(query) ||
        bobbin.tags.some(tag => tag.toLowerCase().includes(query))
      )
    }

    // Filter by installation status
    if (filterMode === 'installed') {
      filtered = filtered.filter(b => b.isInstalled)
    } else if (filterMode === 'available') {
      filtered = filtered.filter(b => !b.isInstalled)
    }

    // Filter by execution mode
    if (filterExecution !== 'all') {
      filtered = filtered.filter(b => b.execution?.mode === filterExecution)
    }

    // Sort
    filtered = [...filtered].sort((a, b) => {
      if (sortBy === 'name') {
        return a.name.localeCompare(b.name)
      } else if (sortBy === 'author') {
        return a.author.localeCompare(b.author)
      } else {
        // Sort by installation date (installed first, then alphabetically)
        if (a.isInstalled && !b.isInstalled) return -1
        if (!a.isInstalled && b.isInstalled) return 1
        return a.name.localeCompare(b.name)
      }
    })

    return filtered
  }, [availableBobbins, searchQuery, filterMode, filterExecution, sortBy])

  if (loading) {
    return (
      <ShellLayout currentView="marketplace" context={{ currentProject }}>
        <div className="flex items-center justify-center h-full">
          <div className="text-center">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto mb-4"></div>
            <p className="text-gray-600">Loading marketplace...</p>
          </div>
        </div>
      </ShellLayout>
    )
  }

  return (
    <ShellLayout currentView="marketplace" context={{ currentProject }}>
      <div className="h-full flex flex-col">
        {/* Header */}
        <div className="bg-white border-b border-gray-200 px-6 py-4">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-2xl font-bold text-gray-900">Bobbin Marketplace</h1>
              <p className="text-sm text-gray-600 mt-1">
                {availableBobbins.length} available • {installedBobbins.length} installed
              </p>
            </div>
            <Link
              href="/"
              className="px-4 py-2 text-sm bg-gray-100 text-gray-700 rounded-md hover:bg-gray-200"
            >
              ← Back to Home
            </Link>
          </div>

          {/* Action Message */}
          {actionMessage && (
            <div className={`mt-4 p-3 rounded-md ${
              actionMessage.type === 'success' ? 'bg-green-50 text-green-800' : 'bg-red-50 text-red-800'
            }`}>
              {actionMessage.text}
            </div>
          )}
        </div>

        {/* Filters and Search */}
        <div className="bg-gray-50 border-b border-gray-200 px-6 py-4">
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            {/* Search */}
            <div className="md:col-span-2">
              <input
                type="text"
                placeholder="Search bobbins by name, description, author, or tags..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full px-4 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>

            {/* Filter by Status */}
            <select
              value={filterMode}
              onChange={(e) => setFilterMode(e.target.value as any)}
              className="px-4 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="all">All Bobbins</option>
              <option value="installed">Installed Only</option>
              <option value="available">Available Only</option>
            </select>

            {/* Filter by Execution Mode */}
            <select
              value={filterExecution}
              onChange={(e) => setFilterExecution(e.target.value as any)}
              className="px-4 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="all">All Modes</option>
              <option value="native">Native (First-Party)</option>
              <option value="sandboxed">Sandboxed (Third-Party)</option>
            </select>
          </div>

          {/* Sort */}
          <div className="mt-3 flex items-center gap-2 text-sm">
            <span className="text-gray-600">Sort by:</span>
            <button
              onClick={() => setSortBy('name')}
              className={`px-3 py-1 rounded ${sortBy === 'name' ? 'bg-blue-600 text-white' : 'bg-white text-gray-700 hover:bg-gray-100'}`}
            >
              Name
            </button>
            <button
              onClick={() => setSortBy('author')}
              className={`px-3 py-1 rounded ${sortBy === 'author' ? 'bg-blue-600 text-white' : 'bg-white text-gray-700 hover:bg-gray-100'}`}
            >
              Author
            </button>
            <button
              onClick={() => setSortBy('recent')}
              className={`px-3 py-1 rounded ${sortBy === 'recent' ? 'bg-blue-600 text-white' : 'bg-white text-gray-700 hover:bg-gray-100'}`}
            >
              Recently Installed
            </button>
          </div>
        </div>

        {/* Bobbin Grid */}
        <div className="flex-1 overflow-auto p-6">
          {filteredAndSortedBobbins.length === 0 ? (
            <div className="text-center py-12">
              <p className="text-gray-500">No bobbins found matching your filters.</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {filteredAndSortedBobbins.map(bobbin => (
                <div
                  key={bobbin.id}
                  className="bg-white rounded-lg shadow-sm border border-gray-200 hover:shadow-md transition-shadow overflow-hidden"
                >
                  {/* Bobbin Header */}
                  <div className="p-5 border-b border-gray-100">
                    <div className="flex items-start justify-between mb-2">
                      <h3 className="text-lg font-semibold text-gray-900">{bobbin.name}</h3>
                      {bobbin.isInstalled && (
                        <span className="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-green-100 text-green-800">
                          ✓ Installed
                        </span>
                      )}
                    </div>
                    <p className="text-sm text-gray-600 mb-3 line-clamp-2">{bobbin.description}</p>

                    {/* Metadata */}
                    <div className="flex flex-wrap gap-2 text-xs">
                      <span className="text-gray-500">v{bobbin.version}</span>
                      <span className="text-gray-400">•</span>
                      <span className="text-gray-500">{bobbin.author}</span>
                      {bobbin.execution && (
                        <>
                          <span className="text-gray-400">•</span>
                          <span className={`px-2 py-0.5 rounded ${
                            bobbin.execution.mode === 'native'
                              ? 'bg-purple-100 text-purple-700'
                              : 'bg-blue-100 text-blue-700'
                          }`}>
                            {bobbin.execution.mode}
                          </span>
                        </>
                      )}
                    </div>
                  </div>

                  {/* Tags */}
                  {bobbin.tags && bobbin.tags.length > 0 && (
                    <div className="px-5 py-3 bg-gray-50">
                      <div className="flex flex-wrap gap-2">
                        {bobbin.tags.map(tag => (
                          <span key={tag} className="inline-block px-2 py-1 text-xs bg-gray-200 text-gray-700 rounded">
                            {tag}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Capabilities */}
                  {bobbin.capabilities && Object.keys(bobbin.capabilities).length > 0 && (
                    <div className="px-5 py-3 border-t border-gray-100">
                      <div className="flex flex-wrap gap-2 text-xs">
                        {bobbin.capabilities.publishable && (
                          <span className="text-gray-600">📝 Publishable</span>
                        )}
                        {bobbin.capabilities.external && (
                          <span className="text-gray-600">🌐 External</span>
                        )}
                        {bobbin.capabilities.ai && (
                          <span className="text-gray-600">🤖 AI</span>
                        )}
                        {bobbin.capabilities.customViews && (
                          <span className="text-gray-600">🎨 Custom Views</span>
                        )}
                      </div>
                    </div>
                  )}

                  {/* Actions */}
                  <div className="p-4 bg-gray-50 border-t border-gray-100 flex gap-2">
                    <button
                      onClick={() => setSelectedBobbin(bobbin)}
                      className="flex-1 px-4 py-2 text-sm bg-white border border-gray-300 text-gray-700 rounded-md hover:bg-gray-50"
                    >
                      View Details
                    </button>
                    {bobbin.isInstalled ? (
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
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Detail Modal */}
        {selectedBobbin && (
          <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
            <div className="bg-white rounded-lg shadow-xl max-w-2xl w-full max-h-[90vh] overflow-auto">
              <div className="sticky top-0 bg-white border-b border-gray-200 px-6 py-4 flex items-center justify-between">
                <h2 className="text-2xl font-bold text-gray-900">{selectedBobbin.name}</h2>
                <button
                  onClick={() => setSelectedBobbin(null)}
                  className="text-gray-400 hover:text-gray-600 text-2xl"
                >
                  ×
                </button>
              </div>

              <div className="p-6">
                <div className="mb-6">
                  <h3 className="text-sm font-semibold text-gray-700 mb-2">Description</h3>
                  <p className="text-gray-600">{selectedBobbin.description}</p>
                </div>

                <div className="grid grid-cols-2 gap-4 mb-6">
                  <div>
                    <h3 className="text-sm font-semibold text-gray-700 mb-1">Version</h3>
                    <p className="text-gray-600">{selectedBobbin.version}</p>
                  </div>
                  <div>
                    <h3 className="text-sm font-semibold text-gray-700 mb-1">Author</h3>
                    <p className="text-gray-600">{selectedBobbin.author}</p>
                  </div>
                  {selectedBobbin.license && (
                    <div>
                      <h3 className="text-sm font-semibold text-gray-700 mb-1">License</h3>
                      <p className="text-gray-600">{selectedBobbin.license}</p>
                    </div>
                  )}
                  {selectedBobbin.execution && (
                    <div>
                      <h3 className="text-sm font-semibold text-gray-700 mb-1">Execution Mode</h3>
                      <span className={`inline-block px-3 py-1 rounded text-sm ${
                        selectedBobbin.execution.mode === 'native'
                          ? 'bg-purple-100 text-purple-700'
                          : 'bg-blue-100 text-blue-700'
                      }`}>
                        {selectedBobbin.execution.mode}
                      </span>
                    </div>
                  )}
                </div>

                {selectedBobbin.tags && selectedBobbin.tags.length > 0 && (
                  <div className="mb-6">
                    <h3 className="text-sm font-semibold text-gray-700 mb-2">Tags</h3>
                    <div className="flex flex-wrap gap-2">
                      {selectedBobbin.tags.map(tag => (
                        <span key={tag} className="px-3 py-1 bg-gray-200 text-gray-700 rounded-full text-sm">
                          {tag}
                        </span>
                      ))}
                    </div>
                  </div>
                )}

                {selectedBobbin.capabilities && Object.keys(selectedBobbin.capabilities).length > 0 && (
                  <div className="mb-6">
                    <h3 className="text-sm font-semibold text-gray-700 mb-2">Capabilities</h3>
                    <ul className="list-disc list-inside text-gray-600 space-y-1">
                      {selectedBobbin.capabilities.publishable && <li>Publishable content</li>}
                      {selectedBobbin.capabilities.external && <li>External API access</li>}
                      {selectedBobbin.capabilities.ai && <li>AI integration</li>}
                      {selectedBobbin.capabilities.customViews && <li>Custom UI views</li>}
                    </ul>
                  </div>
                )}

                {selectedBobbin.isInstalled && (
                  <div className="bg-green-50 border border-green-200 rounded-lg p-4">
                    <p className="text-green-800 text-sm">
                      ✓ This bobbin is currently installed (v{selectedBobbin.installedVersion})
                    </p>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}
      </div>
    </ShellLayout>
  )
}

export default function MarketplacePage() {
  return (
    <ClientWrapper>
      <MarketplaceContent />
    </ClientWrapper>
  )
}
