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

export type BobbinVisibility = 'public' | 'none' | 'moderator'

export interface Manifest {
  // Basic metadata
  id: string
  name: string
  version: string
  author: string
  description: string
  tags?: string[]
  license?: string

  // Marketplace category — drives the filter pills on /bobbins.
  // Bobbins without a category appear only under "All".
  category?: BobbinCategory

  // Marketplace visibility. 'none' hides from non-owner users entirely;
  // 'moderator' is reserved for future role-gated visibility.
  visibility?: BobbinVisibility

  // Core infrastructure bobbins are auto-installed on project creation
  // and cannot be uninstalled. Reserved for manuscript.
  core?: boolean

  // Installation scope configuration
  install?: {
    scopes: ('project' | 'collection' | 'global')[]
  }

  // Capabilities - what this bobbin can do
  capabilities: {
    publishable?: boolean
    external?: boolean
    ai?: boolean
    customViews?: boolean
    backup?: boolean
    publisherCategory?: 'audience' | 'distribution'
    readerBobbinType?: 'automation' | 'reader'
  }

  // Data definitions - collections, fields, relationships
  data?: {
    collections: Collection[]
  }

  // UI definitions - how data should be displayed
  ui?: {
    views: View[]
  }

  // Interactions - actions and triggers
  interactions?: {
    actions?: Action[]
    triggers?: Trigger[]
  }

  // External access configuration
  external?: {
    endpoints: ExternalEndpoint[]
    auth?: AuthConfig
    permissions: Permission[]
  }

  // Entity linking configuration
  linking?: {
    entities: LinkableEntity[]
  }

  // Publishing configuration
  publish?: {
    entities: string[]
    fields?: string[]
    output: OutputFormat[]
  }

  // v0.2: Extensions system
  extensions?: {
    target?: {
      id: string
      version: string
    }
    contributions?: ExtensionContribution[]
    slots?: ExtensionSlotDefinition[]
  }

  // v0.2: Augmentations - add fields to existing collections
  augmentations?: {
    collections?: {
      target: string
      fields: Field[]
      requiredPermission?: string
    }[]
  }

  // v0.2: Pub/Sub configuration
  pubsub?: {
    produces?: TopicProducer[]
    consumes?: TopicConsumer[]
  }

  // v0.2: Offline behavior
  offline?: {
    defaultCache?: 'none' | 'open_entities' | 'all_entities' | 'custom'
    redactFields?: string[]
    maxAge?: number // Cache max age in milliseconds
    maxSize?: number // Cache max size in MB
    collections?: string[] // Specific collections to cache (for 'custom' mode)
  }

  // v0.2: Sync and conflict resolution
  sync?: {
    conflictPolicy?: 'text_delta' | 'field_merge' | 'last_write_wins'
    fieldPolicies?: Record<string, 'text_delta' | 'field_merge' | 'last_write_wins'>
    syncInterval?: number // Sync interval in milliseconds
    optimisticUpdates?: boolean // Enable optimistic UI updates
    // Backup bobbin sync configuration
    frequency?: 'on_edit' | 'hourly' | 'daily' | 'weekly'
    scope?: 'chapter' | 'project'
    paidOnly?: boolean // Gate resource-intensive operations to paid users
  }

  // Seed data to create on first install
  seed?: Array<{
    collection: string
    ref?: string
    data: Record<string, unknown>
  }>

  // Compatibility requirements
  compatibility?: {
    minShellVersion: string
    migrations?: Migration[]
  }
}

export interface Collection {
  name: string
  displayName?: string
  fields: Field[]
  relationships?: Relationship[]
  validations?: Validation[]
  hints?: CollectionHints
}

export interface Field {
  name: string
  type: FieldType
  displayName?: string
  description?: string
  required?: boolean
  default?: any
  validation?: FieldValidation
  hints?: FieldHints
}

export type FieldType =
  | 'text'
  | 'number'
  | 'boolean'
  | 'date'
  | 'datetime'
  | 'json'
  | 'reference'
  | 'file'
  | 'image'
  | 'markdown'
  | 'rich_text'

export interface Relationship {
  name: string
  type: 'one-to-one' | 'one-to-many' | 'many-to-many'
  target: string // collection name
  foreignKey?: string
  displayName?: string
}

export interface Validation {
  field: string
  rules: ValidationRule[]
}

export interface ValidationRule {
  type: 'required' | 'min' | 'max' | 'pattern' | 'custom'
  value?: any
  message?: string
}

export interface CollectionHints {
  searchable?: string[] // Fields to index for full-text search
  sortKey?: string // Primary sort field
  displayField?: string // Field to show in references
  icon?: string
}

export interface FieldHints {
  searchable?: boolean
  sortable?: boolean
  filterable?: boolean
  displayOrder?: number
  group?: string
}

export interface FieldValidation {
  min?: number
  max?: number
  pattern?: string
  required?: boolean
  custom?: string
}

export interface View {
  id: string
  type: ViewType
  name: string
  source: string // Collection or query name
  layout?: ViewLayout
  filters?: ViewFilter[]
  actions?: string[]
  permissions?: ViewPermission[]
  handlers?: string[]  // Entity types this view can handle (e.g., ['container', 'content'])
  priority?: number    // Higher = preferred default when multiple views match
  requiresEntity?: boolean // Only show as a tab when navigating to a real entity (UUID), not a sentinel/list-view id
}

export type ViewType =
  | 'tree'      // Hierarchical outline view
  | 'editor'    // Rich text editor
  | 'board'     // Kanban board
  | 'table'     // Data table
  | 'calendar'  // Calendar view
  | 'map'       // Geographic map
  | 'chart'     // Data visualization
  | 'form'      // Data entry form
  | 'custom'    // Custom native view

export interface ViewLayout {
  columns?: ViewColumn[]
  groups?: ViewGroup[]
  sort?: ViewSort[]
  pagination?: boolean
  pageSize?: number
}

export interface ViewColumn {
  field: string
  width?: number | string
  sortable?: boolean
  filterable?: boolean
}

export interface ViewGroup {
  field: string
  direction?: 'asc' | 'desc'
}

export interface ViewSort {
  field: string
  direction: 'asc' | 'desc'
}

export interface ViewFilter {
  field: string
  operator: 'eq' | 'ne' | 'gt' | 'lt' | 'contains' | 'startsWith' | 'endsWith'
  value: any
}

export interface ViewPermission {
  role: string
  actions: ('read' | 'write' | 'delete')[]
}

export interface Action {
  id: string
  name: string
  type: ActionType
  description?: string
  target?: string
  handler?: string
  parameters?: ActionParameter[]
  permissions?: ActionPermission[]
}

export type ActionType =
  | 'create'
  | 'update'
  | 'delete'
  | 'publish'
  | 'export'
  | 'import'
  | 'custom'

export interface ActionParameter {
  name: string
  type: string
  required?: boolean
  default?: any
}

export interface ActionPermission {
  role: string
  allow: boolean
}

export interface Trigger {
  id: string
  event: TriggerEvent
  conditions?: TriggerCondition[]
  actions: string[]
}

export type TriggerEvent =
  | 'create'
  | 'update'
  | 'delete'
  | 'publish'
  | 'schedule'

export interface TriggerCondition {
  field: string
  operator: string
  value: any
}

export interface ExternalEndpoint {
  id: string
  url: string
  method: 'GET' | 'POST' | 'PUT' | 'DELETE'
  description?: string
}

export interface AuthConfig {
  type: 'api-key' | 'oauth' | 'basic'
  config: Record<string, any>
}

export interface Permission {
  endpoint: string
  reason: string
  required: boolean
}

export interface LinkableEntity {
  collection: string
  display: LinkDisplayConfig
}

export interface LinkDisplayConfig {
  template: string // Template for link display, e.g. "{{title}} ({{type}})"
  preview?: string[] // Fields to show in link preview
}

export interface OutputFormat {
  format: 'html' | 'pdf' | 'epub' | 'json' | 'markdown'
  template?: string
  options?: Record<string, any>
}

export interface Migration {
  version: string
  description: string
  up: string
  down: string
}

// v0.2: Extension system interfaces
export interface ExtensionSlotDefinition {
  id: string
  name: string
  description?: string
  supportedTypes: string[]
  maxContributions?: number
}

// Canonical registry of shell/reader UI slots that bobbins may contribute to.
// This is the single source of truth: the shell renders these slots, the
// compiler validates contributions against them, and the bobbin linter rejects
// contributions to unknown slots. Adding a slot here is the only step needed to
// make it available everywhere — do not maintain a parallel list elsewhere.
export const BUILTIN_SLOTS: Record<string, ExtensionSlotDefinition> = {
  'shell.leftPanel': {
    id: 'shell.leftPanel',
    name: 'Left Panel',
    description: 'Left sidebar panel for navigation and tools',
    supportedTypes: ['panel', 'menu'],
    maxContributions: 5,
  },
  'shell.rightPanel': {
    id: 'shell.rightPanel',
    name: 'Right Panel',
    description: 'Right sidebar panel for contextual information and tools',
    supportedTypes: ['panel'],
    maxContributions: 3,
  },
  'shell.topBar': {
    id: 'shell.topBar',
    name: 'Top Bar',
    description: 'Top navigation bar',
    supportedTypes: ['menu', 'action'],
    maxContributions: 10,
  },
  'shell.statusBar': {
    id: 'shell.statusBar',
    name: 'Status Bar',
    description: 'Bottom status bar',
    supportedTypes: ['action', 'view'],
    maxContributions: 8,
  },
  'shell.contextMenu': {
    id: 'shell.contextMenu',
    name: 'Context Menu',
    description: 'Right-click context menu',
    supportedTypes: ['action', 'menu'],
  },
  'shell.publishDashboard': {
    id: 'shell.publishDashboard',
    name: 'Publish Dashboard',
    description: 'Project-scoped publishing panels contributed by publisher bobbins',
    supportedTypes: ['panel'],
    maxContributions: 10,
  },
  'shell.projectBackup': {
    id: 'shell.projectBackup',
    name: 'Project Backup',
    description: 'Backup status and controls on the project dashboard',
    supportedTypes: ['panel'],
    maxContributions: 5,
  },
  'shell.editorFooter': {
    id: 'shell.editorFooter',
    name: 'Editor Footer',
    description: 'Word count goals, session stats, writing sprints',
    supportedTypes: ['view', 'action'],
    maxContributions: 5,
  },
  'shell.editorOverlay': {
    id: 'shell.editorOverlay',
    name: 'Editor Overlay',
    description: 'Focus tools, ambient sound, distraction-free overlays',
    supportedTypes: ['panel'],
    maxContributions: 3,
  },
  'shell.publishWorkflow': {
    id: 'shell.publishWorkflow',
    name: 'Publish Workflow',
    description: 'Pre-publish checklists, approval steps',
    supportedTypes: ['panel', 'action'],
    maxContributions: 5,
  },
  'shell.importSource': {
    id: 'shell.importSource',
    name: 'Import Source',
    description:
      'Import sources listed in the import wizard. Panels gather and format ' +
      'content themselves and write via sdk.import.commit; rendered with props ' +
      '{ projectId, sdk, onComplete({ createdCount }), onCancel }',
    supportedTypes: ['panel'],
    maxContributions: 8,
  },
  'reader.toolbar': {
    id: 'reader.toolbar',
    name: 'Reader Toolbar',
    description: 'Translation toggle, TTS, bookmark actions',
    supportedTypes: ['action'],
    maxContributions: 8,
  },
  'reader.afterChapter': {
    id: 'reader.afterChapter',
    name: 'After Chapter',
    description: 'Post-chapter panels like Kindle send, recommendations',
    supportedTypes: ['panel', 'action'],
    maxContributions: 5,
  },
  'reader.sidebar': {
    id: 'reader.sidebar',
    name: 'Reader Sidebar',
    description: 'Annotations, highlights, notes panel',
    supportedTypes: ['panel'],
    maxContributions: 3,
  },
}

// Slot IDs available for contributions, derived from BUILTIN_SLOTS.
export const BUILTIN_SLOT_IDS: string[] = Object.keys(BUILTIN_SLOTS)

export interface ExtensionContribution {
  slot: string
  type: 'panel' | 'view' | 'action' | 'menu'
  id: string
  title?: string
  label?: string
  icon?: string
  entry?: string
  priority?: number
  when?: ExtensionCondition
  pubsub?: {
    produces?: TopicReference[]
    consumes?: TopicReference[]
  }
}

export interface ExtensionCondition {
  inView?: string
  hasPermission?: string
  entityType?: string
}

export interface TopicReference {
  topic: string
  intent?: string
  sensitivityRequired?: 'low' | 'medium' | 'high'
}

// v0.2: Pub/Sub interfaces
export interface TopicProducer {
  topic: string
  description?: string
  schema?: any
  sensitivity?: 'low' | 'medium' | 'high'
  qos?: 'realtime' | 'batch' | 'state'
  rate?: string // e.g., "100/60" for 100 messages per 60 seconds
  rateLimit?: {
    maxPerSecond: number
    maxPerMinute: number
  }
}

export interface TopicConsumer {
  topic: string
  intent?: string
  sensitivityRequired?: 'low' | 'medium' | 'high'
  minSensitivity?: 'low' | 'medium' | 'high'
}
