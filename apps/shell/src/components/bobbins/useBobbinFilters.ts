import { useMemo } from 'react'
import { BobbinMetadata, getBobbinCategory } from './types'

interface FilterOptions {
  searchQuery: string
  selectedCategory: string
  filterMode: 'all' | 'installed' | 'available'
  filterExecution: 'all' | 'native' | 'sandboxed'
  sortBy: 'name' | 'author' | 'recent'
}

export function useBobbinFilters(bobbins: BobbinMetadata[], options: FilterOptions) {
  const { searchQuery, selectedCategory, filterMode, filterExecution, sortBy } = options

  return useMemo(() => {
    let filtered = bobbins

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

    if (filterExecution !== 'all') {
      filtered = filtered.filter(b => b.execution?.mode === filterExecution)
    }

    filtered = [...filtered].sort((a, b) => {
      if (sortBy === 'name') return a.name.localeCompare(b.name)
      if (sortBy === 'author') return a.author.localeCompare(b.author)
      if (a.isInstalled && !b.isInstalled) return -1
      if (!a.isInstalled && b.isInstalled) return 1
      return a.name.localeCompare(b.name)
    })

    return filtered
  }, [bobbins, searchQuery, selectedCategory, filterMode, filterExecution, sortBy])
}
