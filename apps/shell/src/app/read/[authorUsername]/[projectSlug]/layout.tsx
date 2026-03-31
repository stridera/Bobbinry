import type { Metadata } from 'next'

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4100'
const BASE_URL = process.env.NEXTAUTH_URL || process.env.NEXT_PUBLIC_APP_URL || 'https://bobbinry.com'

interface ProjectData {
  project: {
    name: string
    description: string | null
    coverImage: string | null
  }
  author: {
    displayName: string | null
    userName: string | null
    username: string | null
  }
}

async function fetchProject(authorUsername: string, projectSlug: string): Promise<ProjectData | null> {
  try {
    const res = await fetch(
      `${API_URL}/api/public/projects/by-author-and-slug/${encodeURIComponent(authorUsername)}/${encodeURIComponent(projectSlug)}`,
      { next: { revalidate: 300 } }
    )
    if (res.ok) return res.json()
  } catch {}
  return null
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ authorUsername: string; projectSlug: string }>
}): Promise<Metadata> {
  const { authorUsername, projectSlug } = await params
  const data = await fetchProject(authorUsername, projectSlug)

  if (!data) {
    return { title: 'Project Not Found | Bobbinry' }
  }

  const { project, author } = data
  const authorName = author.displayName || author.userName || author.username || authorUsername
  const title = `${project.name} by ${authorName} | Bobbinry`
  const description = project.description
    ? project.description.slice(0, 160)
    : `Read ${project.name} by ${authorName} on Bobbinry`
  const url = `${BASE_URL}/read/${authorUsername}/${projectSlug}`

  return {
    title,
    description,
    openGraph: {
      title: project.name,
      description,
      url,
      type: 'book',
      siteName: 'Bobbinry',
      ...(project.coverImage && { images: [{ url: project.coverImage }] }),
    },
    twitter: {
      card: 'summary_large_image',
      title: project.name,
      description,
    },
    alternates: { canonical: url },
  }
}

export default async function ProjectLayout({
  children,
  params,
}: {
  children: React.ReactNode
  params: Promise<{ authorUsername: string; projectSlug: string }>
}) {
  const { authorUsername, projectSlug } = await params
  const data = await fetchProject(authorUsername, projectSlug)

  const jsonLd = data
    ? {
        '@context': 'https://schema.org',
        '@type': 'Book',
        name: data.project.name,
        author: {
          '@type': 'Person',
          name: data.author.displayName || data.author.userName || data.author.username || authorUsername,
          url: `${BASE_URL}/u/${authorUsername}`,
        },
        url: `${BASE_URL}/read/${authorUsername}/${projectSlug}`,
        ...(data.project.description && { description: data.project.description }),
        ...(data.project.coverImage && { image: data.project.coverImage }),
        publisher: {
          '@type': 'Organization',
          name: 'Bobbinry',
          url: BASE_URL,
        },
      }
    : null

  return (
    <>
      {jsonLd && (
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
        />
      )}
      {children}
    </>
  )
}
