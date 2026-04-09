import type { MetadataRoute } from 'next'

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4100'
const BASE_URL = process.env.NEXTAUTH_URL || process.env.NEXT_PUBLIC_APP_URL || 'https://bobbinry.com'

// Hard cap on each sitemap fetch. The build worker spends a maximum of
// FETCH_TIMEOUT_MS × number_of_fetches before falling back to base entries.
// Without this, a slow or unreachable API will hang Vercel's static
// generation phase for minutes and ultimately fail the deploy. See
// `infra/post-mortems/2026-04-09-env-validator-crash-loop.md`.
const FETCH_TIMEOUT_MS = 15_000

interface DiscoverProject {
  authorUsername: string | null
  shortUrl: string | null
  updatedAt: string
}

interface DiscoverAuthor {
  username: string | null
}

async function fetchWithTimeout(url: string): Promise<Response | null> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS)
  try {
    return await fetch(url, {
      next: { revalidate: 3600 },
      signal: controller.signal,
    })
  } catch (err) {
    // Network error, abort, anything else — never fail the build over the
    // sitemap. The base entries below are still useful.
    console.warn(`[sitemap] fetch failed for ${url}:`, err instanceof Error ? err.message : err)
    return null
  } finally {
    clearTimeout(timer)
  }
}

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const entries: MetadataRoute.Sitemap = [
    { url: BASE_URL, lastModified: new Date(), changeFrequency: 'daily', priority: 1 },
    { url: `${BASE_URL}/explore`, changeFrequency: 'daily', priority: 0.9 },
    { url: `${BASE_URL}/read`, changeFrequency: 'daily', priority: 0.8 },
  ]

  // Fetch published projects
  const projectsRes = await fetchWithTimeout(`${API_URL}/api/discover/projects?limit=500&sort=recent`)
  if (projectsRes?.ok) {
    try {
      const data = await projectsRes.json()
      for (const p of (data.projects || []) as DiscoverProject[]) {
        if (p.authorUsername && p.shortUrl) {
          entries.push({
            url: `${BASE_URL}/read/${p.authorUsername}/${p.shortUrl}`,
            lastModified: new Date(p.updatedAt),
            changeFrequency: 'weekly',
            priority: 0.7,
          })
        }
      }
    } catch (err) {
      console.warn('[sitemap] failed to parse projects response:', err)
    }
  }

  // Fetch public authors
  const authorsRes = await fetchWithTimeout(`${API_URL}/api/discover/authors?limit=500&sort=popular`)
  if (authorsRes?.ok) {
    try {
      const data = await authorsRes.json()
      for (const a of (data.authors || []) as DiscoverAuthor[]) {
        if (a.username) {
          entries.push({
            url: `${BASE_URL}/u/${a.username}`,
            changeFrequency: 'weekly',
            priority: 0.6,
          })
        }
      }
    } catch (err) {
      console.warn('[sitemap] failed to parse authors response:', err)
    }
  }

  return entries
}
