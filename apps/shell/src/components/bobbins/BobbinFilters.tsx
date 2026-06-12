'use client'

import { useMemo } from 'react'
import { CATEGORIES } from './types'
import type { BobbinMetadata } from './types'

interface BobbinFiltersProps {
  searchQuery: string
  onSearchChange: (query: string) => void
  selectedCategory: string
  onCategoryChange: (category: string) => void
  filterMode: 'all' | 'installed' | 'available'
  onFilterModeChange: (mode: 'all' | 'installed' | 'available') => void
  sortBy: 'name' | 'author' | 'recent'
  onSortChange: (sort: 'name' | 'author' | 'recent') => void
  showStatusFilter?: boolean
  /** When provided, category pills are limited to categories that at least
   *  one of these bobbins declares — empty categories (e.g. import/export
   *  before any such bobbin ships) are hidden. Omit to show all. */
  bobbins?: BobbinMetadata[]
}

export function BobbinFilters({
  searchQuery,
  onSearchChange,
  selectedCategory,
  onCategoryChange,
  filterMode,
  onFilterModeChange,
  sortBy,
  onSortChange,
  showStatusFilter = true,
  bobbins,
}: BobbinFiltersProps) {
  const visibleCategories = useMemo(() => {
    if (!bobbins) return CATEGORIES
    const present = new Set(bobbins.map(b => b.category).filter(Boolean))
    return CATEGORIES.filter(cat => cat.id === 'all' || present.has(cat.id))
  }, [bobbins])

  return (
    <div className="space-y-4">
      {/* Category pills */}
      <div className="flex flex-wrap gap-2">
        {visibleCategories.map(cat => (
          <button
            key={cat.id}
            onClick={() => onCategoryChange(cat.id)}
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

      <div className={`grid grid-cols-1 gap-4 ${
        showStatusFilter ? 'md:grid-cols-3' : 'md:grid-cols-1'
      }`}>
        {/* Search */}
        <div className={showStatusFilter ? 'md:col-span-2' : ''}>
          <input
            type="text"
            placeholder="Search bobbins by name, description, author, or tags..."
            value={searchQuery}
            onChange={(e) => onSearchChange(e.target.value)}
            className="w-full px-4 py-2 border border-gray-300 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100 placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
          />
        </div>

        {/* Filter by Status */}
        {showStatusFilter && (
          <select
            value={filterMode}
            onChange={(e) => onFilterModeChange(e.target.value as any)}
            className="px-4 py-2 border border-gray-300 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            <option value="all">All Bobbins</option>
            <option value="installed">Installed Only</option>
            <option value="available">Available Only</option>
          </select>
        )}
      </div>

      {/* Sort */}
      <div className="flex items-center gap-2 text-sm">
        <span className="text-gray-500 dark:text-gray-400">Sort by:</span>
        {(['name', 'author', 'recent'] as const).map(s => (
          <button
            key={s}
            onClick={() => onSortChange(s)}
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
  )
}
