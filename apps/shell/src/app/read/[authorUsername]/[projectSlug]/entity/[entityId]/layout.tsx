import type { Metadata } from 'next'
import { buildEntityMetadata, lookupEntity } from './entity-metadata'

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4100'
const BASE_URL = process.env.NEXTAUTH_URL || process.env.NEXT_PUBLIC_APP_URL || 'https://bobbinry.com'

// The entity page is a client component; this layout exists to give shared
// entity links their own preview instead of the project's.
export async function generateMetadata({
  params,
}: {
  params: Promise<{ authorUsername: string; projectSlug: string; entityId: string }>
}): Promise<Metadata> {
  const { authorUsername, projectSlug, entityId } = await params
  const lookup = await lookupEntity(API_URL, authorUsername, projectSlug, entityId)
  return buildEntityMetadata(lookup, { baseUrl: BASE_URL, authorUsername, projectSlug })
}

export default function EntityLayout({ children }: { children: React.ReactNode }) {
  return children
}
