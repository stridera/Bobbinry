import type { Metadata } from 'next'

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4100'
const BASE_URL = process.env.NEXTAUTH_URL || process.env.NEXT_PUBLIC_APP_URL || 'https://bobbinry.com'

interface CollectionData {
  collection: {
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

async function fetchCollection(authorUsername: string, collectionId: string): Promise<CollectionData | null> {
  try {
    const res = await fetch(
      `${API_URL}/api/public/collections/by-author/${encodeURIComponent(authorUsername)}/${encodeURIComponent(collectionId)}`,
      { next: { revalidate: 300 } }
    )
    if (res.ok) return res.json()
  } catch {}
  return null
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ authorUsername: string; collectionId: string }>
}): Promise<Metadata> {
  const { authorUsername, collectionId } = await params
  const data = await fetchCollection(authorUsername, collectionId)

  if (!data) {
    return { title: 'Collection Not Found | Bobbinry' }
  }

  const { collection, author } = data
  const authorName = author.displayName || author.userName || author.username || authorUsername
  const title = `${collection.name} by ${authorName} | Bobbinry`
  const description = collection.description
    ? collection.description.slice(0, 160)
    : `Read the ${collection.name} series by ${authorName} on Bobbinry`
  const url = `${BASE_URL}/read/${authorUsername}/collection/${collectionId}`

  return {
    title,
    description,
    openGraph: {
      title: collection.name,
      description,
      url,
      type: 'website',
      siteName: 'Bobbinry',
      ...(collection.coverImage && { images: [{ url: collection.coverImage }] }),
    },
    twitter: {
      card: 'summary_large_image',
      title: collection.name,
      description,
    },
    alternates: { canonical: url },
  }
}

export default async function CollectionLayout({
  children,
  params,
}: {
  children: React.ReactNode
  params: Promise<{ authorUsername: string; collectionId: string }>
}) {
  const { authorUsername, collectionId } = await params
  const data = await fetchCollection(authorUsername, collectionId)

  const jsonLd = data
    ? {
        '@context': 'https://schema.org',
        '@type': 'BookSeries',
        name: data.collection.name,
        author: {
          '@type': 'Person',
          name: data.author.displayName || data.author.userName || data.author.username || authorUsername,
          url: `${BASE_URL}/u/${authorUsername}`,
        },
        url: `${BASE_URL}/read/${authorUsername}/collection/${collectionId}`,
        ...(data.collection.description && { description: data.collection.description }),
        ...(data.collection.coverImage && { image: data.collection.coverImage }),
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
