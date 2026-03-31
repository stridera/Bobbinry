import type { Metadata } from 'next'

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4100'
const BASE_URL = process.env.NEXTAUTH_URL || process.env.NEXT_PUBLIC_APP_URL || 'https://bobbinry.com'

export async function generateMetadata({
  params,
}: {
  params: Promise<{ authorUsername: string }>
}): Promise<Metadata> {
  const { authorUsername } = await params

  let displayName = authorUsername

  try {
    const res = await fetch(
      `${API_URL}/api/users/by-username/${encodeURIComponent(authorUsername)}`,
      { next: { revalidate: 300 } }
    )
    if (res.ok) {
      const data = await res.json()
      displayName = data.profile?.displayName || data.profile?.userName || authorUsername
    }
  } catch {}

  const title = `Stories by ${displayName} | Bobbinry`
  const description = `Browse stories and projects by ${displayName} on Bobbinry`
  const url = `${BASE_URL}/read/${authorUsername}`

  return {
    title,
    description,
    openGraph: {
      title,
      description,
      url,
      siteName: 'Bobbinry',
    },
    twitter: {
      card: 'summary',
      title,
      description,
    },
    alternates: { canonical: url },
  }
}

export default function AuthorReadLayout({ children }: { children: React.ReactNode }) {
  return children
}
