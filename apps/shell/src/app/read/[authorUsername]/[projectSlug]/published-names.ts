/**
 * Published entity names for a project, shared by everything on the reader
 * that needs them: the chapter page's highlight pass, the entity sidebar's
 * relation pills, and the hover card.
 *
 * The list is gated by viewer (tier, beta access), so the cache is keyed by
 * project + token + the audience being previewed — an owner who switches to
 * "view as visitor" must not be served their own unrestricted list from cache.
 * A short TTL keeps a sidebar open/close from refetching while still picking
 * up newly published entities on the next chapter.
 */
import { publicFetch } from './public-fetch'
import { withViewAs } from './view-as'

export interface PublishedEntityName {
  id: string
  slug: string | null
  name: string
  typeId: string
  typeIcon: string
  typeLabel: string
}

const TTL_MS = 60_000
const cache = new Map<string, { at: number; promise: Promise<PublishedEntityName[] | null> }>()

/**
 * Resolves to the visible entity names, or null when the entities bobbin is
 * not installed on the project or the request failed. Concurrent callers
 * share one in-flight request; failures are not cached.
 */
export function fetchPublishedEntityNames(
  projectId: string,
  token?: string | null,
  viewAs?: string | null,
): Promise<PublishedEntityName[] | null> {
  const key = `${projectId}|${token ?? ''}|${viewAs ?? ''}`
  const hit = cache.get(key)
  if (hit && Date.now() - hit.at < TTL_MS) return hit.promise

  const promise = publicFetch(withViewAs(`/public/projects/${projectId}/entities/published-names`, viewAs), token)
    .then(async res => {
      if (!res.ok) return null
      const data = (await res.json()) as { installed?: boolean; entities?: PublishedEntityName[] }
      return data?.installed && Array.isArray(data.entities) ? data.entities : null
    })
    .then(result => {
      if (result === null) cache.delete(key)
      return result
    })
    .catch(() => {
      cache.delete(key)
      return null
    })

  cache.set(key, { at: Date.now(), promise })
  return promise
}

/** Test hook. */
export function clearPublishedNamesCache(): void {
  cache.clear()
}
