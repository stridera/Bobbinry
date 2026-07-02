'use client'

import type { ComponentType } from 'react'
import { ManuscriptSearchPanel } from './ManuscriptSearchPanel'
import { EntitySearchPanel } from './EntitySearchPanel'

export interface ActiveChapter {
  id: string
  title: string
}

/** Slice of the shell context the search panels care about. */
export interface ShellSearchContext {
  projectId: string
  apiToken: string
  currentView?: string | undefined
  bobbinId?: string | undefined
  entityType?: string | undefined
  activeChapter: ActiveChapter | null
}

export interface SearchPanelProps {
  ctx: ShellSearchContext
  /** Live value of the top-bar input — the panel's "Find" field. */
  query: string
  /** 'replace' when opened via Ctrl+Shift+H; find-only panels ignore it. */
  initialMode: 'find' | 'replace'
  onClose: () => void
}

export interface SearchProviderDef {
  id: string
  placeholder: string
  supportsReplace: boolean
  /** Live debounced search vs explicit Enter-to-search. */
  searchTrigger: 'live' | 'submit'
  /** Browser-style find in the open chapter: Enter cycles, counter shows n/m. */
  supportsInChapterFind: boolean
  Panel: ComponentType<SearchPanelProps>
}

export const manuscriptSearchProvider: SearchProviderDef = {
  id: 'manuscript',
  placeholder: 'Search manuscript…',
  supportsReplace: true,
  searchTrigger: 'live',
  supportsInChapterFind: true,
  Panel: ManuscriptSearchPanel,
}

export const entitySearchProvider: SearchProviderDef = {
  id: 'entities',
  placeholder: 'Search characters, places & lore…',
  supportsReplace: false,
  searchTrigger: 'live',
  supportsInChapterFind: false,
  Panel: EntitySearchPanel,
}

/**
 * Pick the search behavior for the current workspace view. Defaults to the
 * manuscript provider so search keeps working on views we don't recognize.
 * Future surfaces (explore, reader) plug in by adding a provider def and a
 * branch here.
 */
export function resolveSearchProvider(ctx: { currentView?: string | undefined; bobbinId?: string | undefined }): SearchProviderDef {
  if (ctx.bobbinId === 'entities' || ctx.currentView?.startsWith('entities.')) {
    return entitySearchProvider
  }
  return manuscriptSearchProvider
}
