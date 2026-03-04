export interface BobbinMetadata {
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
  slots?: string[]
  manifestContent: string
  isInstalled: boolean
  installedVersion?: string
}

export interface InstalledBobbin {
  id: string
  version: string
  manifest: any
  installedAt: string
}

export const CATEGORIES = [
  { id: 'all', label: 'All' },
  { id: 'writing', label: 'Writing' },
  { id: 'publishing', label: 'Publishing' },
  { id: 'organization', label: 'Organization' },
  { id: 'augmentation', label: 'Augmentation' },
] as const

export const TAG_CATEGORY_MAP: Record<string, string> = {
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

export function getBobbinCategory(tags: string[]): string[] {
  const categories = new Set<string>()
  for (const tag of tags) {
    const cat = TAG_CATEGORY_MAP[tag.toLowerCase()]
    if (cat) categories.add(cat)
  }
  return categories.size > 0 ? Array.from(categories) : ['writing']
}
