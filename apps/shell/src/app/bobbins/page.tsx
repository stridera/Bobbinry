'use client'

import { useState, useEffect } from 'react'
import { useSession } from 'next-auth/react'
import Link from 'next/link'
import { SiteNav } from '@/components/SiteNav'
import {
  BobbinCard,
  BobbinDetailModal,
  BobbinFilters,
  ProjectPickerPopover,
  useBobbinFilters,
} from '@/components/bobbins'
import type { BobbinMetadata } from '@/components/bobbins'

function BobbinsContent() {
  const { data: session } = useSession()
  const [availableBobbins, setAvailableBobbins] = useState<BobbinMetadata[]>([])
  const [loading, setLoading] = useState(true)
  const [searchQuery, setSearchQuery] = useState('')
  const [selectedCategory, setSelectedCategory] = useState('all')
  const [filterMode, setFilterMode] = useState<'all' | 'installed' | 'available'>('all')
  const [filterExecution, setFilterExecution] = useState<'all' | 'native' | 'sandboxed'>('all')
  const [sortBy, setSortBy] = useState<'name' | 'author' | 'recent'>('name')
  const [selectedBobbin, setSelectedBobbin] = useState<BobbinMetadata | null>(null)
  const [pickerBobbin, setPickerBobbin] = useState<BobbinMetadata | null>(null)

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

  const filteredBobbins = useBobbinFilters(availableBobbins, {
    searchQuery,
    selectedCategory,
    filterMode,
    filterExecution,
    sortBy,
  })

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 dark:bg-gray-950">
        <SiteNav />
        <div className="flex items-center justify-center py-32">
          <div className="text-center">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 dark:border-blue-400 mx-auto mb-4" />
            <p className="text-gray-600 dark:text-gray-400">Loading bobbins...</p>
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
              <h1 className="font-display text-2xl font-bold text-gray-900 dark:text-gray-100">Bobbins</h1>
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
        </div>
      </div>

      {/* Filters */}
      <div className="bg-gray-50 dark:bg-gray-950 border-b border-gray-200 dark:border-gray-800 px-6 py-4">
        <div className="max-w-6xl mx-auto">
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
            showStatusFilter={false}
            showExecutionFilter={true}
          />
        </div>
      </div>

      {/* Bobbin Grid */}
      <div className="max-w-6xl mx-auto px-6 py-8">
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
                  !session ? (
                    <Link
                      href="/login"
                      className="px-4 py-2 text-sm bg-blue-600 text-white rounded-md hover:bg-blue-700 transition-colors"
                    >
                      Sign in
                    </Link>
                  ) : (
                    <button
                      onClick={() => setPickerBobbin(pickerBobbin?.id === bobbin.id ? null : bobbin)}
                      className="px-4 py-2 text-sm bg-blue-600 text-white rounded-md hover:bg-blue-700 transition-colors"
                    >
                      Install
                    </button>
                  )
                }
              />
            ))}
          </div>
        )}
      </div>

      {/* Project Picker Modal */}
      {pickerBobbin && (
        <ProjectPickerPopover
          bobbin={pickerBobbin}
          onClose={() => setPickerBobbin(null)}
        />
      )}

      {/* Detail Modal */}
      {selectedBobbin && (
        <BobbinDetailModal
          bobbin={selectedBobbin}
          onClose={() => setSelectedBobbin(null)}
        />
      )}
    </div>
  )
}

export default function BobbinsPage() {
  return <BobbinsContent />
}
