import type { Metadata } from 'next'

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4100'
const BASE_URL = process.env.NEXTAUTH_URL || process.env.NEXT_PUBLIC_APP_URL || 'https://bobbinry.com'

interface ProfileData {
  profile: {
    displayName: string | null
    userName: string | null
    username: string | null
    bio: string | null
    avatarUrl: string | null
    userId: string
  }
}

async function fetchProfile(username: string): Promise<ProfileData | null> {
  try {
    const res = await fetch(
      `${API_URL}/api/users/by-username/${encodeURIComponent(username)}`,
      { next: { revalidate: 300 } }
    )
    if (res.ok) return res.json()
  } catch {}
  return null
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ username: string }>
}): Promise<Metadata> {
  const { username } = await params
  const data = await fetchProfile(username)

  if (!data?.profile) {
    return { title: 'Author Not Found | Bobbinry' }
  }

  const { profile } = data
  const displayName = profile.displayName || profile.userName || profile.username || username
  const title = `${displayName} (@${username}) | Bobbinry`
  const description = profile.bio
    ? profile.bio.slice(0, 160)
    : `${displayName}'s profile on Bobbinry — tools for writers and worldbuilders`
  const url = `${BASE_URL}/u/${username}`

  return {
    title,
    description,
    openGraph: {
      title: displayName,
      description,
      url,
      type: 'profile',
      siteName: 'Bobbinry',
      ...(profile.avatarUrl && { images: [{ url: profile.avatarUrl }] }),
    },
    twitter: {
      card: 'summary_large_image',
      title: displayName,
      description,
    },
    alternates: { canonical: url },
  }
}

export default async function ProfileLayout({
  children,
  params,
}: {
  children: React.ReactNode
  params: Promise<{ username: string }>
}) {
  const { username } = await params
  const data = await fetchProfile(username)

  const jsonLd = data?.profile
    ? {
        '@context': 'https://schema.org',
        '@type': 'Person',
        name: data.profile.displayName || data.profile.userName || data.profile.username || username,
        url: `${BASE_URL}/u/${username}`,
        ...(data.profile.bio && { description: data.profile.bio }),
        ...(data.profile.avatarUrl && { image: data.profile.avatarUrl }),
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
