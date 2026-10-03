import { apiFetch } from '@/lib/api'

const ENTITY_PAGE_SIZE = 500

/**
 * Every content entity (chapter) in a project. The endpoint caps `limit`, and
 * fixed limits silently truncated long projects, so page against `total`.
 * A failed first page reads as an empty project; a failure part-way through
 * throws, since a partial list would be the same silent truncation.
 */
export async function fetchAllContentEntities<T = any>(projectId: string, apiToken: string): Promise<T[]> {
  const all: T[] = []
  for (;;) {
    const res = await apiFetch(
      `/api/collections/content/entities?projectId=${projectId}&limit=${ENTITY_PAGE_SIZE}&offset=${all.length}`,
      apiToken,
    )
    if (!res.ok) {
      if (all.length === 0) break
      throw new Error(`Failed to load chapters (${res.status})`)
    }
    const data = await res.json()
    const page: T[] = data.entities || []
    all.push(...page)
    const total: unknown = data.total
    if (page.length === 0) break
    if (typeof total === 'number' ? all.length >= total : page.length < ENTITY_PAGE_SIZE) break
  }
  return all
}
