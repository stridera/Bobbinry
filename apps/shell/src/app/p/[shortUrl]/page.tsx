import { redirect, notFound } from 'next/navigation'
import { config } from '@/lib/config'

export default async function ShortUrlRedirect({
  params,
}: {
  params: Promise<{ shortUrl: string }>
}) {
  const { shortUrl } = await params

  const res = await fetch(`${config.apiUrl}/api/p/${encodeURIComponent(shortUrl)}`, {
    cache: 'no-store',
  })

  if (!res.ok) {
    notFound()
  }

  const data = await res.json()
  redirect(data.redirectTo)
}
