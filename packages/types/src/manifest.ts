export interface Manifest {
  // Basic metadata
  id: string
  name: string
  version: string
  author: string
  description: string
  tags?: string[]
  license?: string

  // Capabilities - what this bobbin can do
  capabilities: {
    publishable?: boolean
    external?: boolean
    ai?: boolean
    customViews?: boolean
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
  }

  // v0.2: Augmentations - add fields to existing collections
  augmentations?: {
    collections?: {
      target: string
      fields: Field[]
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
  }

  // v0.2: Sync and conflict resolution
  sync?: {
    conflictPolicy?: 'text_delta' | 'field_merge' | 'last_write_wins'
    fieldPolicies?: Record<string, 'text_delta' | 'field_merge' | 'last_write_wins'>
  }

  // v0.2: Execution mode - native vs sandboxed
  execution?: {
    mode: 'native' | 'sandboxed'
    signature?: string  // Ed25519 signature for native bobbins (required in production)
  }

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
  | 'custom'    // Custom iframe view

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
  target?: string
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
export interface ExtensionContribution {
  slot: string
  type: 'panel' | 'view' | 'action' | 'menu'
  id: string
  title?: string
  entry?: string
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
  rateLimit?: {
    maxPerSecond: number
    maxPerMinute: number
  }
}

export interface TopicConsumer {
  topic: string
  intent?: string
  sensitivityRequired?: 'low' | 'medium' | 'high'
}