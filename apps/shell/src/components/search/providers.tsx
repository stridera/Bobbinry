'use client'

import type { ComponentType } from 'react'
import { ManuscriptSearchPanel } from './ManuscriptSearchPanel'
import { EntitySearchPanel } from './EntitySearchPanel'
import type { SearchDeclaration } from '@bobbinry/types'
import { searchDeclarations } from '@/lib/extensions'

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
  /** The resolved provider — carries the declaring bobbin's id. */
  provider: SearchProviderDef
  /** Live value of the top-bar input — the panel's "Find" field. */
  query: string
  /** 'replace' when opened via Ctrl+Shift+H; find-only panels ignore it. */
  initialMode: 'find' | 'replace'
  onClose: () => void
}

export interface SearchProviderDef {
  id: string
  /** Bobbin that declared this search; undefined for the built-in fallback. */
  bobbinId?: string
  placeholder: string
  supportsReplace: boolean
  /** Live debounced search vs explicit Enter-to-search. */
  searchTrigger: 'live' | 'submit'
  /** Browser-style find in the open chapter: Enter cycles, counter shows n/m. */
  supportsInChapterFind: boolean
  Panel: ComponentType<SearchPanelProps>
}

/** Shell-owned panel per search kind; the bobbin picks the kind in its manifest. */
const PANEL_FOR_KIND: Record<SearchDeclaration['kind'], Pick<SearchProviderDef, 'supportsReplace' | 'searchTrigger' | 'supportsInChapterFind' | 'Panel'>> = {
  text: { supportsReplace: true, searchTrigger: 'live', supportsInChapterFind: true, Panel: ManuscriptSearchPanel },
  records: { supportsReplace: false, searchTrigger: 'live', supportsInChapterFind: false, Panel: EntitySearchPanel },
}

const DEFAULT_TEXT_PROVIDER: SearchProviderDef = {
  id: 'text',
  placeholder: 'Search…',
  ...PANEL_FOR_KIND.text,
}

function providerFrom(bobbinId: string, search: SearchDeclaration): SearchProviderDef {
  return {
    id: bobbinId,
    bobbinId,
    placeholder: search.placeholder ?? 'Search…',
    ...PANEL_FOR_KIND[search.kind],
  }
}

/**
 * Pick the search behaviour for the current workspace view from the active
 * bobbin's manifest `search` declaration (on its shell.leftPanel
 * contribution). Views of a bobbin that declares nothing fall back to the
 * first registered text search so the bar keeps working everywhere.
 */
export function resolveSearchProvider(ctx: { currentView?: string | undefined; bobbinId?: string | undefined }): SearchProviderDef {
  const declarations = searchDeclarations()
  const activeBobbin = ctx.bobbinId ?? ctx.currentView?.split('.')[0]
  const own = activeBobbin ? declarations.find(d => d.bobbinId === activeBobbin) : undefined
  if (own) return providerFrom(own.bobbinId, own.search)
  const text = declarations.find(d => d.search.kind === 'text') ?? declarations[0]
  return text ? providerFrom(text.bobbinId, text.search) : DEFAULT_TEXT_PROVIDER
}
