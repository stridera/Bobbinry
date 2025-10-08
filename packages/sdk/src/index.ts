// API client for communicating with the Bobbinry API
export class BobbinryAPI {
  private baseURL: string

  constructor(baseURL: string = 'http://localhost:4000/api') {
    this.baseURL = baseURL
  }

  get apiBaseUrl(): string {
    return this.baseURL
  }

  // Project management
  async getProject(projectId: string) {
    const response = await fetch(`${this.baseURL}/projects/${projectId}`)
    if (!response.ok) {
      throw new Error(`Failed to fetch project: ${response.statusText}`)
    }
    return response.json()
  }

  // Bobbin management
  async installBobbin(projectId: string, manifestContent: string, manifestType: 'yaml' | 'json' = 'yaml') {
    const response = await fetch(`${this.baseURL}/projects/${projectId}/bobbins/install`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        manifestContent,
        manifestType
      })
    })

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({ error: 'Unknown error' }))
      throw new Error(errorData.error || `Installation failed: ${response.statusText}`)
    }

    return response.json()
  }

  async getInstalledBobbins(projectId: string) {
    const response = await fetch(`${this.baseURL}/projects/${projectId}/bobbins`)
    if (!response.ok) {
      throw new Error(`Failed to fetch bobbins: ${response.statusText}`)
    }
    return response.json()
  }

  async uninstallBobbin(projectId: string, bobbinId: string) {
    const response = await fetch(`${this.baseURL}/projects/${projectId}/bobbins/${bobbinId}`, {
      method: 'DELETE'
    })

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({ error: 'Unknown error' }))
      throw new Error(errorData.error || `Uninstall failed: ${response.statusText}`)
    }

    return response.json()
  }
}

// Message bus for Shell ↔ Views communication
export interface Message {
  type: string
  source: string
  target: string
  data: any
  id?: string
}

export class MessageBus {
  private listeners: Map<string, ((message: Message) => void)[]> = new Map()
  private componentId: string

  constructor(componentId: string) {
    this.componentId = componentId
    this.setupWindowListener()
  }

  private setupWindowListener() {
    if (typeof window !== 'undefined') {
      window.addEventListener('message', (event) => {
        if (this.isValidMessage(event.data)) {
          this.handleMessage(event.data)
        }
      })
    }
  }

  private isValidMessage(data: any): data is Message {
    return data &&
      typeof data.type === 'string' &&
      typeof data.source === 'string' &&
      typeof data.target === 'string'
  }

  private handleMessage(message: Message) {
    // Only handle messages targeted to this component or broadcast messages
    if (message.target === this.componentId || message.target === '*') {
      const listeners = this.listeners.get(message.type) || []
      listeners.forEach(listener => listener(message))
    }
  }

  // Register a listener for a specific message type
  on(messageType: string, handler: (message: Message) => void) {
    if (!this.listeners.has(messageType)) {
      this.listeners.set(messageType, [])
    }
    this.listeners.get(messageType)!.push(handler)
  }

  // Remove a listener
  off(messageType: string, handler: (message: Message) => void) {
    const listeners = this.listeners.get(messageType)
    if (listeners) {
      const index = listeners.indexOf(handler)
      if (index > -1) {
        listeners.splice(index, 1)
      }
    }
  }

  // Send a message
  send(target: string, type: string, data: any) {
    const message: Message = {
      type,
      source: this.componentId,
      target,
      data,
      id: this.generateId()
    }

    if (typeof window !== 'undefined') {
      // Post to parent window (for iframe communication)
      if (window.parent !== window) {
        window.parent.postMessage(message, '*')
      }
      // Post to current window (for same-window communication)
      window.postMessage(message, '*')
    }
  }

  // Send a message and wait for a response
  async request(target: string, type: string, data: any, timeout: number = 5000): Promise<any> {
    return new Promise((resolve, reject) => {
      const requestId = this.generateId()
      const responseType = `${type}_response`

      // Set up response handler
      const responseHandler = (message: Message) => {
        if (message.data?.requestId === requestId) {
          this.off(responseType, responseHandler)
          resolve(message.data)
        }
      }

      this.on(responseType, responseHandler)

      // Set up timeout
      const timeoutId = setTimeout(() => {
        this.off(responseType, responseHandler)
        reject(new Error(`Request timeout: ${type}`))
      }, timeout)

      // Send request with cleanup
      this.send(target, type, { ...data, requestId })

      // Store timeout ID for cleanup in response handler
      const originalHandler = responseHandler
      const wrappedHandler = (message: Message) => {
        clearTimeout(timeoutId)
        originalHandler(message)
      }

      this.off(responseType, responseHandler)
      this.on(responseType, wrappedHandler)
    })
  }

  private generateId(): string {
    return Math.random().toString(36).substring(2, 15)
  }
}

// Entity data access layer
export interface EntityQuery {
  collection: string
  filters?: Record<string, any>
  sort?: { field: string; direction: 'asc' | 'desc' }[]
  limit?: number
  offset?: number
  search?: string
}

export interface EntityResult<T = any> {
  data: T[]
  total: number
  hasMore: boolean
}

export class EntityAPI {
  private api: BobbinryAPI
  private projectId: string

  constructor(api: BobbinryAPI, projectId: string) {
    this.api = api
    this.projectId = projectId
  }

  // TODO: Implement entity CRUD operations
  async query<T = any>(query: EntityQuery): Promise<EntityResult<T>> {
    const params = new URLSearchParams({
      projectId: this.projectId,
      ...(query.limit && { limit: query.limit.toString() }),
      ...(query.offset && { offset: query.offset.toString() }),
      ...(query.search && { search: query.search }),
      ...(query.filters && { filters: JSON.stringify(query.filters) })
    })

    const response = await fetch(`${this.api.apiBaseUrl}/collections/${query.collection}/entities?${params}`)

    if (!response.ok) {
      throw new Error(`Failed to query entities: ${response.statusText}`)
    }

    const result = await response.json()
    return {
      data: result.entities || [],
      total: result.total || 0,
      hasMore: result.entities && result.entities.length >= (query.limit || 50)
    }
  }

  async get<T = any>(collection: string, id: string): Promise<T | null> {
    const params = new URLSearchParams({
      projectId: this.projectId,
      collection
    })

    const response = await fetch(`${this.api.apiBaseUrl}/entities/${id}?${params}`)

    if (!response.ok) {
      if (response.status === 404) {
        return null
      }
      throw new Error(`Failed to get entity: ${response.statusText}`)
    }

    return response.json()
  }

  async create<T = any>(collection: string, data: Partial<T>): Promise<T> {
    const response = await fetch(`${this.api.apiBaseUrl}/entities`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        collection,
        projectId: this.projectId,
        data
      })
    })

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({ error: 'Unknown error' }))
      throw new Error(`Failed to create entity: ${errorData.error || response.statusText}`)
    }

    return response.json()
  }

  async update<T = any>(collection: string, id: string, data: Partial<T>): Promise<T> {
    const response = await fetch(`${this.api.apiBaseUrl}/entities/${id}`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        collection,
        projectId: this.projectId,
        data
      })
    })

    if (!response.ok) {
      throw new Error(`Failed to update entity: ${response.statusText}`)
    }

    return response.json()
  }

  async delete(collection: string, id: string): Promise<void> {
    const params = new URLSearchParams({
      projectId: this.projectId,
      collection
    })

    const response = await fetch(`${this.api.apiBaseUrl}/entities/${id}?${params}`, {
      method: 'DELETE'
    })

    if (!response.ok) {
      throw new Error(`Failed to delete entity: ${response.statusText}`)
    }
  }
}

// Shell configuration access
export interface ShellConfig {
  theme: 'light' | 'dark'
  projectId: string
  user: {
    id: string
    name: string
    email?: string
  }
  locale: string
  capabilities: string[]
  api: {
    baseUrl: string
    wsUrl?: string
  }
}

type ConfigChangeCallback = (config: ShellConfig) => void

export class ShellAPI {
  private config: ShellConfig | null = null
  private configListeners: ConfigChangeCallback[] = []
  private isIframe: boolean

  constructor() {
    this.isIframe = typeof window !== 'undefined' && window.parent !== window
    this.setupConfigListener()
    this.requestInitialConfig()
  }

  private setupConfigListener() {
    if (typeof window === 'undefined') return

    window.addEventListener('message', (event) => {
      const msg = event.data

      // Handle new message envelope format
      if (msg && msg.namespace === 'SHELL') {
        if (msg.type === 'SHELL_INIT' && msg.payload?.config) {
          this.config = msg.payload.config
          this.notifyListeners()
        } else if (msg.type === 'SHELL_CONFIG_RESPONSE' && msg.payload?.config) {
          this.config = msg.payload.config
          this.notifyListeners()
        } else if (msg.type === 'SHELL_THEME_UPDATE' && msg.payload?.theme) {
          if (this.config) {
            this.config.theme = msg.payload.theme
            this.notifyListeners()
          }
        }
      }
    })
  }

  private requestInitialConfig() {
    if (!this.isIframe || typeof window === 'undefined') return

    // Request config from parent using new message format
    window.parent.postMessage({
      namespace: 'SHELL',
      type: 'SHELL_CONFIG_REQUEST',
      payload: {},
      metadata: {
        source: 'sdk',
        timestamp: Date.now()
      }
    }, '*')
  }

  private notifyListeners() {
    if (!this.config) return
    this.configListeners.forEach(listener => listener(this.config!))
  }

  /**
   * Get current shell configuration
   * Returns null if config hasn't been received yet
   */
  getConfig(): ShellConfig | null {
    return this.config
  }

  /**
   * Get current theme
   * Returns 'light' as default if config not available
   */
  getTheme(): 'light' | 'dark' {
    return this.config?.theme || 'light'
  }

  /**
   * Get current project ID
   */
  getProjectId(): string {
    return this.config?.projectId || ''
  }

  /**
   * Get current user
   */
  getUser() {
    return this.config?.user || { id: '', name: '' }
  }

  /**
   * Listen for configuration changes
   * Returns unsubscribe function
   */
  onConfigChange(callback: ConfigChangeCallback): () => void {
    this.configListeners.push(callback)
    
    // Immediately call with current config if available
    if (this.config) {
      callback(this.config)
    }

    return () => {
      const index = this.configListeners.indexOf(callback)
      if (index > -1) {
        this.configListeners.splice(index, 1)
      }
    }
  }

  /**
   * Listen for theme changes only
   */
  onThemeChange(callback: (theme: 'light' | 'dark') => void): () => void {
    return this.onConfigChange((config) => {
      callback(config.theme)
    })
  }
}

// Main SDK class
export class BobbinrySDK {
  public api: BobbinryAPI
  public messageBus: MessageBus
  public entities: EntityAPI
  public shell: ShellAPI

  constructor(componentId: string, apiBaseURL?: string) {
    this.api = new BobbinryAPI(apiBaseURL)
    this.messageBus = new MessageBus(componentId)
    this.entities = new EntityAPI(this.api, '') // Project ID will be set when project is loaded
    this.shell = new ShellAPI()
  }

  setProject(projectId: string) {
    this.entities = new EntityAPI(this.api, projectId)
  }
}

// React Hooks for common patterns
export {
  useEntity,
  useEntityList,
  useCreateEntity,
  useUpdateEntity,
  useDeleteEntity,
  useMessageBus,
  useDebounce,
  useLocalStorage,
  usePrevious,
  useClickOutside,
  useBoolean
} from './hooks'

// Convenience exports
export * from '@bobbinry/types'