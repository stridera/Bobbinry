import type { MetadataRoute } from 'next'

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4100'
const BASE_URL = process.env.NEXTAUTH_URL || process.env.NEXT_PUBLIC_APP_URL || 'https://bobbinry.com'

interface DiscoverProject {
  authorUsername: string | null
  shortUrl: string | null
  updatedAt: string
}

interface DiscoverAuthor {
  username: string | null
}

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const entries: MetadataRoute.Sitemap = [
    { url: BASE_URL, lastModified: new Date(), changeFrequency: 'daily', priority: 1 },
    { url: `${BASE_URL}/explore`, changeFrequency: 'daily', priority: 0.9 },
    { url: `${BASE_URL}/read`, changeFrequency: 'daily', priority: 0.8 },
  ]

  // Fetch published projects
  try {
    const res = await fetch(`${API_URL}/api/discover/projects?limit=500&sort=recent`, {
      next: { revalidate: 3600 },
    })
    if (res.ok) {
      const data = await res.json()
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
    }
  } catch {
    // Sitemap generation shouldn't fail the build
  }

  // Fetch public authors
  try {
    const res = await fetch(`${API_URL}/api/discover/authors?limit=500&sort=popular`, {
      next: { revalidate: 3600 },
    })
    if (res.ok) {
      const data = await res.json()
      for (const a of (data.authors || []) as DiscoverAuthor[]) {
        if (a.username) {
          entries.push({
            url: `${BASE_URL}/u/${a.username}`,
            changeFrequency: 'weekly',
            priority: 0.6,
          })
        }
      }
    }
  } catch {
    // Sitemap generation shouldn't fail the build
  }

  return entries
}
