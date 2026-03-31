import type { Metadata } from 'next'

const BASE_URL = process.env.NEXTAUTH_URL || process.env.NEXT_PUBLIC_APP_URL || 'https://bobbinry.com'

export const metadata: Metadata = {
  title: 'Discover Stories & Authors | Bobbinry',
  description: 'Find your next favorite read. Browse stories by genre, discover new indie authors, and explore worlds built on Bobbinry.',
  openGraph: {
    title: 'Discover Stories & Authors',
    description: 'Find your next favorite read. Browse stories by genre, discover new indie authors, and explore worlds built on Bobbinry.',
    url: `${BASE_URL}/explore`,
    siteName: 'Bobbinry',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Discover Stories & Authors | Bobbinry',
    description: 'Find your next favorite read. Browse stories by genre, discover new indie authors, and explore worlds built on Bobbinry.',
  },
  alternates: { canonical: `${BASE_URL}/explore` },
}

export default function ExploreLayout({ children }: { children: React.ReactNode }) {
  return children
}
