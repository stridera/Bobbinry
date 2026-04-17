import { ApiError, AuthError } from '../lib/errors.js'

export interface ClientOptions {
  apiKey?: string
  apiUrl: string
  verbose?: boolean
}

export class BobbinryClient {
  private apiKey?: string
  private apiUrl: string
  private verbose: boolean

  constructor(opts: ClientOptions) {
    this.apiKey = opts.apiKey
    this.apiUrl = opts.apiUrl.replace(/\/+$/, '')
    this.verbose = opts.verbose ?? false
  }

  private headers(extra?: Record<string, string>): Record<string, string> {
    const h: Record<string, string> = { ...extra }
    if (this.apiKey) {
      h['Authorization'] = `Bearer ${this.apiKey}`
    }
    return h
  }

  private async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const url = `${this.apiUrl}/api${path}`
    const headers = this.headers(body ? { 'Content-Type': 'application/json' } : undefined)

    if (this.verbose) {
      process.stderr.write(`${method} ${url}\n`)
    }

    let res: Response
    try {
      res = await fetch(url, {
        method,
        headers,
        body: body ? JSON.stringify(body) : undefined,
      })
    } catch (err) {
      throw new ApiError(0, `Network error: ${err instanceof Error ? err.message : String(err)}`, undefined,
        'Check that the API is reachable. Use --api-url to override.')
    }

    if (this.verbose) {
      process.stderr.write(`  → ${res.status} ${res.statusText}\n`)
      const rateRemaining = res.headers.get('x-ratelimit-remaining')
      if (rateRemaining) {
        process.stderr.write(`  Rate limit remaining: ${rateRemaining}\n`)
      }
    }

    if (!res.ok) {
      const text = await res.text()
      let parsed: { error?: string; message?: string } = {}
      try { parsed = JSON.parse(text) } catch { /* not JSON */ }

      const message = parsed.message || parsed.error || res.statusText
      const hint = this.getErrorHint(res.status, message)
      throw new ApiError(res.status, message, parsed.message && parsed.error ? parsed.error : undefined, hint)
    }

    // Handle empty responses (204 No Content, etc.)
    const text = await res.text()
    if (!text) return undefined as T
    return JSON.parse(text) as T
  }

  private getErrorHint(status: number, message: string): string | undefined {
    switch (status) {
      case 401:
        return 'API key is invalid or expired. Create a new one at https://bobbinry.com/settings/api-keys'
      case 403:
        if (message.includes('scope')) {
          return 'This API key does not have the required scope. Create a new key with the needed scopes at https://bobbinry.com/settings/api-keys'
        }
        if (message.includes('Session auth required')) {
          return 'This endpoint requires browser login and cannot be accessed via API key'
        }
        return undefined
      case 404:
        return 'Resource not found. Check the ID or slug.'
      case 429:
        return 'Rate limit exceeded. Wait and retry, or upgrade to supporter tier for higher limits.'
      default:
        return undefined
    }
  }

  private requireAuth(): void {
    if (!this.apiKey) {
      throw new AuthError('No API key configured')
    }
  }

  private get<T>(path: string): Promise<T> {
    return this.request<T>('GET', path)
  }

  private post<T>(path: string, body?: unknown): Promise<T> {
    return this.request<T>('POST', path, body)
  }

  private put<T>(path: string, body: unknown): Promise<T> {
    return this.request<T>('PUT', path, body)
  }

  private del<T>(path: string): Promise<T> {
    return this.request<T>('DELETE', path)
  }

  // ── Projects ──────────────────────────────────────────────

  async listProjects(): Promise<any> {
    this.requireAuth()
    return this.get('/projects')
  }

  async getProject(projectId: string): Promise<any> {
    this.requireAuth()
    return this.get(`/projects/${projectId}`)
  }

  async createProject(name: string, description?: string): Promise<any> {
    this.requireAuth()
    return this.post('/projects', { name, description })
  }

  async getProjectBobbins(projectId: string): Promise<any> {
    this.requireAuth()
    return this.get(`/projects/${projectId}/bobbins`)
  }

  // ── Entities ────────────────────────────��─────────────────

  async queryEntities(collection: string, params: {
    projectId: string
    limit?: number
    offset?: number
    search?: string
    filters?: Record<string, any>
  }): Promise<any> {
    this.requireAuth()
    const qs = new URLSearchParams({ projectId: params.projectId })
    if (params.limit) qs.set('limit', String(params.limit))
    if (params.offset) qs.set('offset', String(params.offset))
    if (params.search) qs.set('search', params.search)
    if (params.filters) qs.set('filters', JSON.stringify(params.filters))
    return this.get(`/collections/${collection}/entities?${qs}`)
  }

  async getEntity(entityId: string, params: { projectId: string; collection: string }): Promise<any> {
    this.requireAuth()
    const qs = new URLSearchParams({ projectId: params.projectId, collection: params.collection })
    return this.get(`/entities/${entityId}?${qs}`)
  }

  async createEntity(collection: string, projectId: string, data: Record<string, any>): Promise<any> {
    this.requireAuth()
    return this.post('/entities', { collection, projectId, data })
  }

  async updateEntity(entityId: string, params: {
    collection: string
    projectId: string
    data: Record<string, any>
    expectedVersion?: number
  }): Promise<any> {
    this.requireAuth()
    return this.put(`/entities/${entityId}`, params)
  }

  async deleteEntity(entityId: string, params: { projectId: string; collection: string }): Promise<any> {
    this.requireAuth()
    const qs = new URLSearchParams({ projectId: params.projectId, collection: params.collection })
    return this.del(`/entities/${entityId}?${qs}`)
  }

  // ── Stats ─────────────────────────────────────────────────

  async getStats(): Promise<any> {
    this.requireAuth()
    return this.get('/dashboard/stats')
  }

  async getUserProjects(): Promise<any> {
    this.requireAuth()
    return this.get('/users/me/projects')
  }

  async getRecentActivity(limit = 20): Promise<any> {
    this.requireAuth()
    return this.get(`/users/me/recent-activity?limit=${limit}`)
  }

  // ── Profile ───────────────────────────────────────────────

  async whoami(): Promise<any> {
    this.requireAuth()
    return this.get('/membership')
  }

  // ── Discover (public, no auth needed) ─────────────────────

  async discoverProjects(params?: { q?: string; sort?: string; limit?: number }): Promise<any> {
    const qs = new URLSearchParams()
    if (params?.q) qs.set('q', params.q)
    if (params?.sort) qs.set('sort', params.sort)
    if (params?.limit) qs.set('limit', String(params.limit))
    return this.get(`/discover/projects?${qs}`)
  }

  async discoverAuthors(params?: { q?: string; sort?: string; limit?: number }): Promise<any> {
    const qs = new URLSearchParams()
    if (params?.q) qs.set('q', params.q)
    if (params?.sort) qs.set('sort', params.sort)
    if (params?.limit) qs.set('limit', String(params.limit))
    return this.get(`/discover/authors?${qs}`)
  }

  async discoverTags(): Promise<any> {
    return this.get('/discover/tags')
  }

  // ── Read (public) ─────────────────────────────────────────

  async resolveSlug(slug: string): Promise<any> {
    return this.get(`/public/projects/by-slug/${encodeURIComponent(slug)}`)
  }

  async resolveByAuthorAndSlug(username: string, slug: string): Promise<any> {
    return this.get(`/public/projects/by-author-and-slug/${encodeURIComponent(username)}/${encodeURIComponent(slug)}`)
  }

  async getToc(projectId: string): Promise<any> {
    return this.get(`/public/projects/${projectId}/toc`)
  }

  async getChapter(projectId: string, chapterId: string): Promise<any> {
    return this.get(`/public/projects/${projectId}/chapters/${chapterId}`)
  }

  // ── Export ────────────────────────────────────────────────

  async exportProject(projectId: string, format: string): Promise<Response> {
    this.requireAuth()
    const url = `${this.apiUrl}/api/export/${projectId}?format=${format}`
    const res = await fetch(url, { headers: this.headers() })
    if (!res.ok) {
      const text = await res.text()
      let parsed: { error?: string } = {}
      try { parsed = JSON.parse(text) } catch { /* not JSON */ }
      throw new ApiError(res.status, parsed.error || res.statusText)
    }
    return res
  }
}
