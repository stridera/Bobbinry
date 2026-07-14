import type { Metadata } from 'next'
import { permanentRedirect } from 'next/navigation'

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4100'
const BASE_URL = process.env.NEXTAUTH_URL || process.env.NEXT_PUBLIC_APP_URL || 'https://bobbinry.com'

async function fetchChapter(authorUsername: string, projectSlug: string, chapterId: string) {
  const slugRes = await fetch(
    `${API_URL}/api/public/projects/by-author-and-slug/${encodeURIComponent(authorUsername)}/${encodeURIComponent(projectSlug)}`,
    { next: { revalidate: 300 } }
  )
  if (!slugRes.ok) return null
  const slugData = await slugRes.json()

  const chapterRes = await fetch(
    `${API_URL}/api/public/projects/${slugData.project.id}/chapters/${encodeURIComponent(chapterId)}`,
    { next: { revalidate: 300 } }
  )
  if (!chapterRes.ok) return { slugData, chapterData: null }
  return { slugData, chapterData: await chapterRes.json() }
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ authorUsername: string; projectSlug: string; chapterId: string }>
}): Promise<Metadata> {
  const { authorUsername, projectSlug, chapterId } = await params

  let projectName = projectSlug
  let authorName = authorUsername
  let chapterTitle = 'Chapter'
  let chapterSlug: string | null = null

  try {
    const result = await fetchChapter(authorUsername, projectSlug, chapterId)
    if (result) {
      projectName = result.slugData.project?.name || projectSlug
      authorName = result.slugData.author?.displayName || result.slugData.author?.userName || authorUsername
      chapterTitle = result.chapterData?.chapter?.title || 'Chapter'
      chapterSlug = result.chapterData?.chapter?.slug || null
    }
  } catch {}

  const title = `${chapterTitle} — ${projectName} | Bobbinry`
  const description = `Read "${chapterTitle}" from ${projectName} by ${authorName} on Bobbinry`
  const url = `${BASE_URL}/read/${authorUsername}/${projectSlug}/${chapterSlug ?? chapterId}`

  return {
    title,
    description,
    openGraph: {
      title: chapterTitle,
      description,
      url,
      type: 'article',
      siteName: 'Bobbinry',
    },
    twitter: {
      card: 'summary_large_image',
      title: chapterTitle,
      description,
    },
    alternates: { canonical: url },
  }
}

export default async function ChapterLayout({
  children,
  params,
}: {
  children: React.ReactNode
  params: Promise<{ authorUsername: string; projectSlug: string; chapterId: string }>
}) {
  const { authorUsername, projectSlug, chapterId } = await params

  // Real 301 for crawlers and old links: UUID URLs and old-slug aliases
  // permanently redirect to the current slug URL.
  try {
    const result = await fetchChapter(authorUsername, projectSlug, chapterId)
    const slug = result?.chapterData?.chapter?.slug
    if (slug && slug !== chapterId) {
      permanentRedirect(`/read/${authorUsername}/${projectSlug}/${slug}`)
    }
  } catch (err) {
    // next/navigation redirects work by throwing — never swallow them.
    if (err && typeof err === 'object' && 'digest' in err) throw err
  }

  return children
}
