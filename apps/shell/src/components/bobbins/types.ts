export type BobbinScope = 'project' | 'collection' | 'global'

export type BobbinCategory =
  | 'write'
  | 'organize'
  | 'publish'
  | 'import'
  | 'export'
  | 'augment'
  | 'integration'
  | 'backup'
  | 'fun'

export interface BobbinMetadata {
  id: string
  name: string
  version: string
  author: string
  description: string
  tags: string[]
  license?: string
  category?: BobbinCategory
  visibility?: 'public' | 'none' | 'moderator'
  core?: boolean
  scopes?: BobbinScope[]
  capabilities: {
    publishable?: boolean
    external?: boolean
    ai?: boolean
    customViews?: boolean
  }
  externalAccess?: {
    authType?: string
    hosts: string[]
    permissions: Array<{
      endpoint: string
      reason: string
      required: boolean
    }>
  }
  slots?: string[]
  manifestContent: string
  isInstalled: boolean
  installedVersion?: string
}

export interface InstalledBobbin {
  id: string
  version: string
  scope?: BobbinScope
  scopeTarget?: string
  manifest: any
  installedAt: string
}

export const CATEGORIES = [
  { id: 'all', label: 'All' },
  { id: 'write', label: 'Write' },
  { id: 'organize', label: 'Organize' },
  { id: 'publish', label: 'Publish' },
  { id: 'import', label: 'Import' },
  { id: 'export', label: 'Export' },
  { id: 'augment', label: 'Augment' },
  { id: 'integration', label: 'Integration' },
  { id: 'backup', label: 'Backup' },
  { id: 'fun', label: 'Fun' },
] as const
