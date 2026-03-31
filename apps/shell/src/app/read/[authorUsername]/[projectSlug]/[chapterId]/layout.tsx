import type { Metadata } from 'next'

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4100'
const BASE_URL = process.env.NEXTAUTH_URL || process.env.NEXT_PUBLIC_APP_URL || 'https://bobbinry.com'

export async function generateMetadata({
  params,
}: {
  params: Promise<{ authorUsername: string; projectSlug: string; chapterId: string }>
}): Promise<Metadata> {
  const { authorUsername, projectSlug, chapterId } = await params

  let projectName = projectSlug
  let authorName = authorUsername
  let chapterTitle = 'Chapter'

  try {
    const slugRes = await fetch(
      `${API_URL}/api/public/projects/by-author-and-slug/${encodeURIComponent(authorUsername)}/${encodeURIComponent(projectSlug)}`,
      { next: { revalidate: 300 } }
    )
    if (slugRes.ok) {
      const slugData = await slugRes.json()
      projectName = slugData.project?.name || projectSlug
      authorName = slugData.author?.displayName || slugData.author?.userName || authorUsername

      const chapterRes = await fetch(
        `${API_URL}/api/public/projects/${slugData.project.id}/chapters/${chapterId}`,
        { next: { revalidate: 300 } }
      )
      if (chapterRes.ok) {
        const chapterData = await chapterRes.json()
        chapterTitle = chapterData.chapter?.title || 'Chapter'
      }
    }
  } catch {}

  const title = `${chapterTitle} — ${projectName} | Bobbinry`
  const description = `Read "${chapterTitle}" from ${projectName} by ${authorName} on Bobbinry`
  const url = `${BASE_URL}/read/${authorUsername}/${projectSlug}/${chapterId}`

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

export default function ChapterLayout({ children }: { children: React.ReactNode }) {
  return children
}
