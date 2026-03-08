'use client'

import { useState, useRef, useEffect, useCallback, useMemo } from 'react'
import { useSession } from 'next-auth/react'
import { useClickOutside } from '@bobbinry/sdk'
import { apiFetch } from '@/lib/api'
import { useBobbinFilters } from './useBobbinFilters'
import type { BobbinMetadata } from './types'

interface InstalledBobbin {
  id: string
  version: string
  manifest: {
    name: string
    description?: string
  }
  installedAt: string
}

interface BobbinManagerPopoverProps {
  projectId: string
  installedBobbins: InstalledBobbin[]
  onOpenFullMarketplace?: (() => void) | undefined
}

function enrichWithInstalledStatus(bobbins: BobbinMetadata[], installedBobbins: InstalledBobbin[]): BobbinMetadata[] {
  return bobbins.map(b => {
    const installed = installedBobbins.find(ib => ib.id === b.id)
    const result: BobbinMetadata = { ...b, isInstalled: !!installed }
    if (installed) result.installedVersion = installed.version
    return result
  })
}

export function BobbinManagerPopover({ projectId, installedBobbins, onOpenFullMarketplace }: BobbinManagerPopoverProps) {
  const { data: session } = useSession()
  const [isOpen, setIsOpen] = useState(false)
  const [activeTab, setActiveTab] = useState<'installed' | 'browse'>('installed')
  const [rawMarketplaceBobbins, setRawMarketplaceBobbins] = useState<BobbinMetadata[]>([])
  const [marketplaceStatus, setMarketplaceStatus] = useState<'idle' | 'loading' | 'loaded'>('idle')
  const [searchQuery, setSearchQuery] = useState('')
  const [busyId, setBusyId] = useState<string | null>(null)
  const popoverRef = useRef<HTMLDivElement>(null)

  useClickOutside(popoverRef as React.RefObject<HTMLElement>, () => setIsOpen(false))

  // Escape key
  useEffect(() => {
    if (!isOpen) return
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setIsOpen(false)
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [isOpen])

  // Load marketplace on first Browse tab switch
  useEffect(() => {
    if (activeTab === 'browse' && marketplaceStatus === 'idle') {
      setMarketplaceStatus('loading')
      fetch('/api/marketplace/bobbins')
        .then(res => res.json())
        .then(data => {
          setRawMarketplaceBobbins((data.bobbins || []) as BobbinMetadata[])
          setMarketplaceStatus('loaded')
        })
        .catch(err => console.error('Failed to load marketplace:', err))
        .finally(() => {
          setMarketplaceStatus(prev => prev === 'loading' ? 'idle' : prev)
        })
    }
  }, [activeTab, marketplaceStatus])

  // Derive installed status via useMemo instead of a sync effect
  const marketplaceBobbins = useMemo(
    () => enrichWithInstalledStatus(rawMarketplaceBobbins, installedBobbins),
    [rawMarketplaceBobbins, installedBobbins]
  )

  const filteredBobbins = useBobbinFilters(marketplaceBobbins, {
    searchQuery,
    selectedCategory: 'all',
    filterMode: 'all',
    filterExecution: 'all',
    sortBy: 'name',
  })

  const handleInstall = useCallback(async (bobbin: BobbinMetadata) => {
    if (!session?.apiToken) return
    setBusyId(bobbin.id)
    try {
      const response = await apiFetch(
        `/api/projects/${projectId}/bobbins/install`,
        session.apiToken,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ manifestPath: `bobbins/${bobbin.id}.manifest.yaml` }),
        }
      )
      if (!response.ok) {
        const err = await response.json().catch(() => ({ error: 'Installation failed' }))
        throw new Error(err.error || 'Installation failed')
      }
      window.dispatchEvent(new CustomEvent('bobbinry:bobbins-changed'))
    } catch (err) {
      console.error('Install failed:', err)
    } finally {
      setBusyId(null)
    }
  }, [session?.apiToken, projectId])

  const handleUninstall = useCallback(async (bobbinId: string) => {
    if (!session?.apiToken) return
    setBusyId(bobbinId)
    try {
      const response = await apiFetch(
        `/api/projects/${projectId}/bobbins/${bobbinId}`,
        session.apiToken,
        { method: 'DELETE' }
      )
      if (!response.ok) {
        const err = await response.json().catch(() => ({ error: 'Uninstall failed' }))
        throw new Error(err.error || 'Uninstall failed')
      }
      window.dispatchEvent(new CustomEvent('bobbinry:bobbins-changed'))
    } catch (err) {
      console.error('Uninstall failed:', err)
    } finally {
      setBusyId(null)
    }
  }, [session?.apiToken, projectId])

  return (
    <div className="relative" ref={popoverRef}>
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="p-1.5 hover:bg-gray-100 dark:hover:bg-gray-700 rounded text-gray-500 dark:text-gray-400 transition-colors"
        title="Manage bobbins"
      >
        {/* Puzzle piece icon */}
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 4a2 2 0 114 0v1a1 1 0 001 1h3a1 1 0 011 1v3a1 1 0 01-1 1h-1a2 2 0 100 4h1a1 1 0 011 1v3a1 1 0 01-1 1h-3a1 1 0 01-1-1v-1a2 2 0 10-4 0v1a1 1 0 01-1 1H7a1 1 0 01-1-1v-3a1 1 0 00-1-1H4a2 2 0 110-4h1a1 1 0 001-1V7a1 1 0 011-1h3a1 1 0 001-1V4z" />
        </svg>
      </button>

      {isOpen && (
        <div className="absolute right-0 mt-2 w-80 bg-white dark:bg-gray-800 rounded-lg shadow-lg border border-gray-200 dark:border-gray-700 z-50 animate-fade-in-scale flex flex-col" style={{ maxHeight: '28rem' }}>
          {/* Tabs */}
          <div className="flex border-b border-gray-200 dark:border-gray-700 shrink-0">
            <button
              onClick={() => setActiveTab('installed')}
              className={`flex-1 px-4 py-2.5 text-xs font-medium transition-colors ${
                activeTab === 'installed'
                  ? 'text-blue-600 dark:text-blue-400 border-b-2 border-blue-600 dark:border-blue-400'
                  : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300'
              }`}
            >
              Installed ({installedBobbins.length})
            </button>
            <button
              onClick={() => setActiveTab('browse')}
              className={`flex-1 px-4 py-2.5 text-xs font-medium transition-colors ${
                activeTab === 'browse'
                  ? 'text-blue-600 dark:text-blue-400 border-b-2 border-blue-600 dark:border-blue-400'
                  : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300'
              }`}
            >
              Browse
            </button>
          </div>

          {/* Content */}
          <div className="flex-1 overflow-y-auto min-h-0">
            {activeTab === 'installed' ? (
              installedBobbins.length === 0 ? (
                <div className="p-6 text-center text-sm text-gray-400 dark:text-gray-500">
                  No bobbins installed yet.
                </div>
              ) : (
                <div className="py-1">
                  {installedBobbins.map(bobbin => (
                    <div key={bobbin.id} className="flex items-center justify-between px-4 py-2 hover:bg-gray-50 dark:hover:bg-gray-700/50">
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-gray-900 dark:text-gray-100 truncate">
                          {bobbin.manifest.name}
                        </p>
                        <p className="text-xs text-gray-400 dark:text-gray-500">v{bobbin.version}</p>
                      </div>
                      <button
                        onClick={() => handleUninstall(bobbin.id)}
                        disabled={busyId === bobbin.id}
                        className="text-xs text-red-500 dark:text-red-400 hover:text-red-700 dark:hover:text-red-300 disabled:opacity-50 px-2 py-1 rounded hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors shrink-0"
                      >
                        {busyId === bobbin.id ? 'Removing...' : 'Remove'}
                      </button>
                    </div>
                  ))}
                </div>
              )
            ) : (
              <div>
                {/* Search */}
                <div className="p-2 border-b border-gray-100 dark:border-gray-700">
                  <input
                    type="text"
                    value={searchQuery}
                    onChange={e => setSearchQuery(e.target.value)}
                    placeholder="Search bobbins..."
                    className="w-full px-3 py-1.5 text-sm bg-gray-50 dark:bg-gray-700/50 border border-gray-200 dark:border-gray-600 rounded-md text-gray-900 dark:text-gray-100 placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                  />
                </div>

                {marketplaceStatus === 'loading' ? (
                  <div className="p-6 text-center text-sm text-gray-400 dark:text-gray-500">
                    Loading bobbins...
                  </div>
                ) : (
                  <div className="py-1">
                    {filteredBobbins.map(bobbin => (
                      <div key={bobbin.id} className="flex items-center justify-between px-4 py-2 hover:bg-gray-50 dark:hover:bg-gray-700/50">
                        <div className="min-w-0 mr-2">
                          <p className="text-sm font-medium text-gray-900 dark:text-gray-100 truncate">
                            {bobbin.name}
                          </p>
                          <p className="text-xs text-gray-400 dark:text-gray-500 truncate">
                            {bobbin.description}
                          </p>
                        </div>
                        {bobbin.isInstalled ? (
                          <span className="text-xs text-green-600 dark:text-green-400 shrink-0 px-2 py-1">
                            Installed
                          </span>
                        ) : (
                          <button
                            onClick={() => handleInstall(bobbin)}
                            disabled={busyId === bobbin.id}
                            className="text-xs text-blue-600 dark:text-blue-400 hover:text-blue-700 dark:hover:text-blue-300 disabled:opacity-50 px-2 py-1 rounded hover:bg-blue-50 dark:hover:bg-blue-900/20 transition-colors shrink-0"
                          >
                            {busyId === bobbin.id ? 'Installing...' : 'Install'}
                          </button>
                        )}
                      </div>
                    ))}
                    {filteredBobbins.length === 0 && (
                      <div className="p-4 text-center text-sm text-gray-400 dark:text-gray-500">
                        No bobbins found.
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Footer */}
          {onOpenFullMarketplace && (
            <div className="border-t border-gray-200 dark:border-gray-700 px-4 py-2 shrink-0">
              <button
                onClick={() => { onOpenFullMarketplace(); setIsOpen(false) }}
                className="text-xs font-medium text-blue-600 dark:text-blue-400 hover:text-blue-700 dark:hover:text-blue-300 transition-colors"
              >
                Open full marketplace &rarr;
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
