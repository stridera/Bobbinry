/**
 * Link-preview metadata for a reader entity page (Discord, Slack, search).
 *
 * The page itself is a client component, so its `layout.tsx` builds this on
 * the server. Everything comes from the public entity endpoint fetched with no
 * credentials — exactly what an anonymous visitor sees — so a preview can
 * never carry a tier-locked entity's name or a hidden era's text.
 */

import type { Metadata } from 'next'

export interface ProjectSummary {
  id: string
  name: string
  authorName: string
  /** The author's real username, for canonical URLs (the route may use a UUID). */
  canonicalAuthor: string
}

export interface EntitySummary {
  id: string
  slug: string | null
  name: string | null
  description: string | null
  imageUrl: string | null
  typeLabel: string
}

export type EntityLookup =
  | { status: 'ok'; project: ProjectSummary; entity: EntitySummary }
  | { status: 'locked'; project: ProjectSummary }
  | { status: 'missing'; project: ProjectSummary | null }

const DESCRIPTION_LIMIT = 160

/** Plain text from a description that may be rich-text HTML, trimmed for a preview. */
export function previewText(raw: string | null | undefined): string | null {
  if (!raw) return null
  const text = raw
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim()
  if (!text) return null
  return text.length > DESCRIPTION_LIMIT ? `${text.slice(0, DESCRIPTION_LIMIT - 1).trimEnd()}…` : text
}

/**
 * Fetch what an anonymous reader may see of the entity. Mirrors the project
 * layout's project fetch (same URL and revalidate) so Next dedupes it.
 */
export async function lookupEntity(
  apiUrl: string,
  authorUsername: string,
  projectSlug: string,
  entityId: string
): Promise<EntityLookup> {
  let project: ProjectSummary | null = null
  try {
    const res = await fetch(
      `${apiUrl}/api/public/projects/by-author-and-slug/${encodeURIComponent(authorUsername)}/${encodeURIComponent(projectSlug)}`,
      { next: { revalidate: 300 } }
    )
    if (res.ok) {
      const data = await res.json()
      if (data?.project?.id) {
        project = {
          id: data.project.id,
          name: data.project.name || projectSlug,
          authorName: data.author?.displayName || data.author?.userName || data.author?.username || authorUsername,
          canonicalAuthor: data.author?.username || authorUsername,
        }
      }
    }
  } catch {}
  if (!project) return { status: 'missing', project: null }

  try {
    const res = await fetch(
      `${apiUrl}/api/public/projects/${project.id}/entities/${encodeURIComponent(entityId)}`,
      { next: { revalidate: 300 } }
    )
    if (res.status === 403) return { status: 'locked', project }
    if (!res.ok) return { status: 'missing', project }
    const data = await res.json()
    if (!data?.entity?.id) return { status: 'missing', project }
    return {
      status: 'ok',
      project,
      entity: {
        id: data.entity.id,
        slug: data.entity.slug ?? null,
        name: data.entity.name ?? null,
        description: data.entity.description ?? null,
        imageUrl: data.entity.imageUrl ?? null,
        typeLabel: data.type?.label || 'Entry',
      },
    }
  } catch {
    return { status: 'missing', project }
  }
}

export function buildEntityMetadata(
  lookup: EntityLookup,
  opts: { baseUrl: string; authorUsername: string; projectSlug: string }
): Metadata {
  if (lookup.status === 'missing') {
    return { title: lookup.project ? `Entry Not Found — ${lookup.project.name} | Bobbinry` : 'Entry Not Found | Bobbinry' }
  }

  const { project } = lookup
  const projectPath = `/read/${project.canonicalAuthor}/${opts.projectSlug}`
  // The project's generated card, addressed absolutely so crawlers can fetch it.
  const projectCard = `${opts.baseUrl}/read/${opts.authorUsername}/${opts.projectSlug}/opengraph-image`

  if (lookup.status === 'locked') {
    const title = `Locked entry — ${project.name}`
    const description = `Subscribers to ${project.name} by ${project.authorName} can read this entry on Bobbinry.`
    return {
      title: `${title} | Bobbinry`,
      description,
      openGraph: { title, description, siteName: 'Bobbinry', type: 'article', images: [{ url: projectCard }] },
      twitter: { card: 'summary_large_image', title, description, images: [projectCard] },
    }
  }

  const { entity } = lookup
  const name = entity.name?.trim() || 'Untitled'
  const title = `${name} · ${entity.typeLabel} — ${project.name}`
  const description =
    previewText(entity.description) ?? `From ${project.name} by ${project.authorName} on Bobbinry.`
  const url = `${opts.baseUrl}${projectPath}/entity/${entity.slug || entity.id}`
  const image = entity.imageUrl && /^https?:\/\//.test(entity.imageUrl) ? entity.imageUrl : projectCard

  return {
    title: `${title} | Bobbinry`,
    description,
    openGraph: {
      title,
      description,
      url,
      siteName: 'Bobbinry',
      type: 'article',
      images: [{ url: image, alt: image === projectCard ? project.name : name }],
    },
    twitter: { card: 'summary_large_image', title, description, images: [image] },
    alternates: { canonical: url },
  }
}
