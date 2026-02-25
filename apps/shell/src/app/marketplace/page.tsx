'use client'

import { useState, useEffect, useMemo } from 'react'
import { useSession } from 'next-auth/react'
import Link from 'next/link'
import { SiteNav } from '@/components/SiteNav'

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
  manifestContent: string
  isInstalled: boolean
  installedVersion?: string
}

const CATEGORIES = [
  { id: 'all', label: 'All' },
  { id: 'writing', label: 'Writing' },
  { id: 'publishing', label: 'Publishing' },
  { id: 'organization', label: 'Organization' },
  { id: 'augmentation', label: 'Augmentation' },
]

const TAG_CATEGORY_MAP: Record<string, string> = {
  writing: 'writing',
  manuscript: 'writing',
  editor: 'writing',
  chapters: 'writing',
  scenes: 'writing',
  publishing: 'publishing',
  publish: 'publishing',
  export: 'publishing',
  organization: 'organization',
  corkboard: 'organization',
  planning: 'organization',
  worldbuilding: 'organization',
  dictionary: 'organization',
  glossary: 'organization',
  ai: 'augmentation',
  automation: 'augmentation',
  enhancement: 'augmentation',
  tools: 'augmentation',
}

function getBobbinCategory(tags: string[]): string[] {
  const categories = new Set<string>()
  for (const tag of tags) {
    const cat = TAG_CATEGORY_MAP[tag.toLowerCase()]
    if (cat) categories.add(cat)
  }
  return categories.size > 0 ? Array.from(categories) : ['writing']
}

function MarketplaceContent() {
  const { data: session } = useSession()
  const [availableBobbins, setAvailableBobbins] = useState<BobbinMetadata[]>([])
  const [loading, setLoading] = useState(true)
  const [searchQuery, setSearchQuery] = useState('')
  const [selectedCategory, setSelectedCategory] = useState('all')
  const [filterMode, setFilterMode] = useState<'all' | 'installed' | 'available'>('all')
  const [sortBy, setSortBy] = useState<'name' | 'author' | 'recent'>('name')
  const [selectedBobbin, setSelectedBobbin] = useState<BobbinMetadata | null>(null)
  const [actionMessage, setActionMessage] = useState<{ type: 'success' | 'error', text: string } | null>(null)

  useEffect(() => {
    const loadBobbins = async () => {
      setLoading(true)
      try {
        const response = await fetch('/api/marketplace/bobbins')
        const data = await response.json()
        setAvailableBobbins(data.bobbins || [])
      } catch (error) {
        console.error('Failed to load bobbins:', error)
      } finally {
        setLoading(false)
      }
    }

    if (typeof window !== 'undefined') {
      loadBobbins()
    }
  }, [])

  const filteredAndSortedBobbins = useMemo(() => {
    let filtered = availableBobbins

    if (searchQuery) {
      const query = searchQuery.toLowerCase()
      filtered = filtered.filter(bobbin =>
        bobbin.name.toLowerCase().includes(query) ||
        bobbin.description.toLowerCase().includes(query) ||
        bobbin.author.toLowerCase().includes(query) ||
        bobbin.tags.some(tag => tag.toLowerCase().includes(query))
      )
    }

    if (selectedCategory !== 'all') {
      filtered = filtered.filter(bobbin =>
        getBobbinCategory(bobbin.tags).includes(selectedCategory)
      )
    }

    if (filterMode === 'installed') {
      filtered = filtered.filter(b => b.isInstalled)
    } else if (filterMode === 'available') {
      filtered = filtered.filter(b => !b.isInstalled)
    }

    filtered = [...filtered].sort((a, b) => {
      if (sortBy === 'name') return a.name.localeCompare(b.name)
      if (sortBy === 'author') return a.author.localeCompare(b.author)
      if (a.isInstalled && !b.isInstalled) return -1
      if (!a.isInstalled && b.isInstalled) return 1
      return a.name.localeCompare(b.name)
    })

    return filtered
  }, [availableBobbins, searchQuery, selectedCategory, filterMode, sortBy])

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 dark:bg-gray-950">
        <SiteNav />
        <div className="flex items-center justify-center py-32">
          <div className="text-center">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 dark:border-blue-400 mx-auto mb-4" />
            <p className="text-gray-600 dark:text-gray-400">Loading marketplace...</p>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-950">
      <SiteNav />

      {/* Header */}
      <div className="bg-white dark:bg-gray-900 border-b border-gray-200 dark:border-gray-800 px-6 py-6">
        <div className="max-w-6xl mx-auto">
          <div className="flex items-center justify-between mb-1">
            <div>
              <h1 className="font-display text-2xl font-bold text-gray-900 dark:text-gray-100">Bobbin Marketplace</h1>
              <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
                {availableBobbins.length} bobbins available
              </p>
            </div>
            {!session && (
              <Link
                href="/login"
                className="px-4 py-2 text-sm font-medium bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition-colors"
              >
                Sign in to install
              </Link>
            )}
          </div>

          {/* Action Message */}
          {actionMessage && (
            <div className={`mt-4 p-3 rounded-md text-sm ${
              actionMessage.type === 'success'
                ? 'bg-green-50 dark:bg-green-900/20 text-green-800 dark:text-green-300'
                : 'bg-red-50 dark:bg-red-900/20 text-red-800 dark:text-red-300'
            }`}>
              {actionMessage.text}
            </div>
          )}
        </div>
      </div>

      {/* Filters */}
      <div className="bg-gray-50 dark:bg-gray-950 border-b border-gray-200 dark:border-gray-800 px-6 py-4">
        <div className="max-w-6xl mx-auto">
          {/* Category pills */}
          <div className="flex flex-wrap gap-2 mb-4">
            {CATEGORIES.map(cat => (
              <button
                key={cat.id}
                onClick={() => setSelectedCategory(cat.id)}
                className={`px-3 py-1.5 text-sm rounded-full transition-colors ${
                  selectedCategory === cat.id
                    ? 'bg-blue-600 text-white'
                    : 'bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-300 border border-gray-200 dark:border-gray-700 hover:bg-gray-100 dark:hover:bg-gray-700'
                }`}
              >
                {cat.label}
              </button>
            ))}
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {/* Search */}
            <div className="md:col-span-2">
              <input
                type="text"
                placeholder="Search bobbins by name, description, author, or tags..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full px-4 py-2 border border-gray-300 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100 placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              />
            </div>

            {/* Filter by Status */}
            <select
              value={filterMode}
              onChange={(e) => setFilterMode(e.target.value as any)}
              className="px-4 py-2 border border-gray-300 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="all">All Bobbins</option>
              <option value="installed">Installed Only</option>
              <option value="available">Available Only</option>
            </select>
          </div>

          {/* Sort */}
          <div className="mt-3 flex items-center gap-2 text-sm">
            <span className="text-gray-500 dark:text-gray-400">Sort by:</span>
            {(['name', 'author', 'recent'] as const).map(s => (
              <button
                key={s}
                onClick={() => setSortBy(s)}
                className={`px-3 py-1 rounded transition-colors ${
                  sortBy === s
                    ? 'bg-blue-600 text-white'
                    : 'bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700'
                }`}
              >
                {s === 'recent' ? 'Recently Installed' : s.charAt(0).toUpperCase() + s.slice(1)}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Bobbin Grid */}
      <div className="max-w-6xl mx-auto px-6 py-8">
        {filteredAndSortedBobbins.length === 0 ? (
          <div className="text-center py-12">
            <p className="text-gray-500 dark:text-gray-400">No bobbins found matching your filters.</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {filteredAndSortedBobbins.map(bobbin => (
              <div
                key={bobbin.id}
                className="bg-white dark:bg-gray-900 rounded-lg shadow-sm border border-gray-200 dark:border-gray-800 hover:shadow-md hover:border-blue-300 dark:hover:border-blue-700 transition-all overflow-hidden"
              >
                {/* Bobbin Header */}
                <div className="p-5 border-b border-gray-100 dark:border-gray-800">
                  <div className="flex items-start justify-between mb-2">
                    <h3 className="font-display text-lg font-semibold text-gray-900 dark:text-gray-100">{bobbin.name}</h3>
                    {bobbin.isInstalled && (
                      <span className="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-green-100 dark:bg-green-900/30 text-green-800 dark:text-green-400">
                        Installed
                      </span>
                    )}
                  </div>
                  <p className="text-sm text-gray-600 dark:text-gray-400 mb-3 line-clamp-2">{bobbin.description}</p>

                  {/* Metadata */}
                  <div className="flex flex-wrap gap-2 text-xs">
                    <span className="text-gray-500 dark:text-gray-400">v{bobbin.version}</span>
                    <span className="text-gray-400 dark:text-gray-600">&middot;</span>
                    <span className="text-gray-500 dark:text-gray-400">{bobbin.author}</span>
                    {bobbin.execution && (
                      <>
                        <span className="text-gray-400 dark:text-gray-600">&middot;</span>
                        <span className={`px-2 py-0.5 rounded ${
                          bobbin.execution.mode === 'native'
                            ? 'bg-purple-100 dark:bg-purple-900/30 text-purple-700 dark:text-purple-400'
                            : 'bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-400'
                        }`}>
                          {bobbin.execution.mode}
                        </span>
                      </>
                    )}
                  </div>
                </div>

                {/* Tags */}
                {bobbin.tags && bobbin.tags.length > 0 && (
                  <div className="px-5 py-3 bg-gray-50 dark:bg-gray-900/50">
                    <div className="flex flex-wrap gap-2">
                      {bobbin.tags.map(tag => (
                        <span key={tag} className="inline-block px-2 py-1 text-xs bg-gray-200 dark:bg-gray-800 text-gray-700 dark:text-gray-400 rounded">
                          {tag}
                        </span>
                      ))}
                    </div>
                  </div>
                )}

                {/* Capabilities */}
                {bobbin.capabilities && Object.keys(bobbin.capabilities).length > 0 && (
                  <div className="px-5 py-3 border-t border-gray-100 dark:border-gray-800">
                    <div className="flex flex-wrap gap-3 text-xs text-gray-600 dark:text-gray-400">
                      {bobbin.capabilities.publishable && <span>Publishable</span>}
                      {bobbin.capabilities.external && <span>External</span>}
                      {bobbin.capabilities.ai && <span>AI</span>}
                      {bobbin.capabilities.customViews && <span>Custom Views</span>}
                    </div>
                  </div>
                )}

                {/* Actions */}
                <div className="p-4 bg-gray-50 dark:bg-gray-900/50 border-t border-gray-100 dark:border-gray-800 flex gap-2">
                  <button
                    onClick={() => setSelectedBobbin(bobbin)}
                    className="flex-1 px-4 py-2 text-sm bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-700 text-gray-700 dark:text-gray-300 rounded-md hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
                  >
                    View Details
                  </button>
                  {!session ? (
                    <Link
                      href="/login"
                      className="px-4 py-2 text-sm bg-blue-600 text-white rounded-md hover:bg-blue-700 transition-colors"
                    >
                      Sign in
                    </Link>
                  ) : (
                    <span className="px-4 py-2 text-sm text-gray-400 dark:text-gray-500 italic">
                      Install from project
                    </span>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Detail Modal */}
      {selectedBobbin && (
        <div className="fixed inset-0 bg-black/50 dark:bg-black/70 flex items-center justify-center z-50 p-4">
          <div className="bg-white dark:bg-gray-900 rounded-lg shadow-xl max-w-2xl w-full max-h-[90vh] overflow-auto border border-gray-200 dark:border-gray-800">
            <div className="sticky top-0 bg-white dark:bg-gray-900 border-b border-gray-200 dark:border-gray-800 px-6 py-4 flex items-center justify-between">
              <h2 className="font-display text-2xl font-bold text-gray-900 dark:text-gray-100">{selectedBobbin.name}</h2>
              <button
                onClick={() => setSelectedBobbin(null)}
                className="text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-300 text-2xl"
              >
                &times;
              </button>
            </div>

            <div className="p-6">
              <div className="mb-6">
                <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">Description</h3>
                <p className="text-gray-600 dark:text-gray-400">{selectedBobbin.description}</p>
              </div>

              <div className="grid grid-cols-2 gap-4 mb-6">
                <div>
                  <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-1">Version</h3>
                  <p className="text-gray-600 dark:text-gray-400">{selectedBobbin.version}</p>
                </div>
                <div>
                  <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-1">Author</h3>
                  <p className="text-gray-600 dark:text-gray-400">{selectedBobbin.author}</p>
                </div>
                {selectedBobbin.license && (
                  <div>
                    <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-1">License</h3>
                    <p className="text-gray-600 dark:text-gray-400">{selectedBobbin.license}</p>
                  </div>
                )}
                {selectedBobbin.execution && (
                  <div>
                    <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-1">Execution Mode</h3>
                    <span className={`inline-block px-3 py-1 rounded text-sm ${
                      selectedBobbin.execution.mode === 'native'
                        ? 'bg-purple-100 dark:bg-purple-900/30 text-purple-700 dark:text-purple-400'
                        : 'bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-400'
                    }`}>
                      {selectedBobbin.execution.mode}
                    </span>
                  </div>
                )}
              </div>

              {selectedBobbin.tags && selectedBobbin.tags.length > 0 && (
                <div className="mb-6">
                  <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">Tags</h3>
                  <div className="flex flex-wrap gap-2">
                    {selectedBobbin.tags.map(tag => (
                      <span key={tag} className="px-3 py-1 bg-gray-200 dark:bg-gray-800 text-gray-700 dark:text-gray-400 rounded-full text-sm">
                        {tag}
                      </span>
                    ))}
                  </div>
                </div>
              )}

              {selectedBobbin.capabilities && Object.keys(selectedBobbin.capabilities).length > 0 && (
                <div className="mb-6">
                  <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">Capabilities</h3>
                  <ul className="list-disc list-inside text-gray-600 dark:text-gray-400 space-y-1">
                    {selectedBobbin.capabilities.publishable && <li>Publishable content</li>}
                    {selectedBobbin.capabilities.external && <li>External API access</li>}
                    {selectedBobbin.capabilities.ai && <li>AI integration</li>}
                    {selectedBobbin.capabilities.customViews && <li>Custom UI views</li>}
                  </ul>
                </div>
              )}

              {selectedBobbin.isInstalled && (
                <div className="bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-lg p-4">
                  <p className="text-green-800 dark:text-green-300 text-sm">
                    This bobbin is currently installed (v{selectedBobbin.installedVersion})
                  </p>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

export default function MarketplacePage() {
  return <MarketplaceContent />
}
