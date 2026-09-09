'use client'

/**
 * Owner-only audience preview bar: "This is your project" plus the "Viewing as"
 * audience picker that drives `?viewAs=`.
 *
 * Rendered on the project reader page and on the entity subpage, so an author
 * checking how their tier-locked codex reads can tell at a glance that they're
 * still in a preview after navigating into an entity.
 */

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { config } from '@/lib/config'

interface PreviewTier {
  id: string
  name: string
  tierLevel: number
}

interface ViewAsBarProps {
  projectId: string
  /** Project owner's user id; the bar only renders for them. */
  ownerId?: string | undefined
  /** Signed-in viewer's user id, if any. */
  userId?: string | undefined
  /** Current `viewAs` value ('' when viewing as yourself). */
  viewAs: string
  /** Path the picker rewrites, e.g. `/read/elena/quantum-error`. */
  basePath: string
}

export default function ViewAsBar({ projectId, ownerId, userId, viewAs, basePath }: ViewAsBarProps) {
  const router = useRouter()
  const searchParams = useSearchParams()
  const [tiers, setTiers] = useState<PreviewTier[]>([])

  const isOwner = !!userId && !!ownerId && userId === ownerId

  // Paid tiers populate the "Subscriber — <tier>" options. Public endpoint;
  // only fetched for the owner, since nobody else sees the bar.
  useEffect(() => {
    if (!isOwner || !ownerId) return
    let cancelled = false
    fetch(`${config.apiUrl}/api/users/${ownerId}/subscription-tiers`)
      .then(r => (r.ok ? r.json() : null))
      .then((data: { tiers?: PreviewTier[] } | null) => {
        if (cancelled || !data?.tiers) return
        setTiers(data.tiers.filter(t => t.tierLevel > 0))
      })
      .catch(() => { /* picker falls back to visitor/beta only — acceptable */ })
    return () => { cancelled = true }
  }, [isOwner, ownerId])

  // A non-owner who hand-crafted a viewAs URL gets nothing: the API ignores
  // the param for them, so a bar promising a preview would be a lie.
  if (!isOwner) return null

  return (
    <div className="mb-6 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-blue-200 bg-blue-50/50 px-4 py-2.5 dark:border-blue-800 dark:bg-blue-950/20">
      <div className="flex items-center gap-2 text-sm text-blue-800 dark:text-blue-300">
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
        </svg>
        <span>This is your project.</span>
        <Link
          href={`/projects/${projectId}`}
          className="ml-1 inline-flex items-center gap-1.5 rounded-md border border-blue-200 bg-white px-2.5 py-1 text-xs font-medium text-blue-700 transition-colors hover:bg-blue-100 dark:border-blue-800 dark:bg-gray-900 dark:text-blue-300 dark:hover:bg-blue-900/40"
        >
          <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3.75 6A2.25 2.25 0 016 3.75h2.25A2.25 2.25 0 0110.5 6v2.25a2.25 2.25 0 01-2.25 2.25H6a2.25 2.25 0 01-2.25-2.25V6zM3.75 15.75A2.25 2.25 0 016 13.5h2.25a2.25 2.25 0 012.25 2.25V18a2.25 2.25 0 01-2.25 2.25H6A2.25 2.25 0 013.75 18v-2.25zM13.5 6a2.25 2.25 0 012.25-2.25H18A2.25 2.25 0 0120.25 6v2.25A2.25 2.25 0 0118 10.5h-2.25a2.25 2.25 0 01-2.25-2.25V6zM13.5 15.75a2.25 2.25 0 012.25-2.25H18a2.25 2.25 0 012.25 2.25V18A2.25 2.25 0 0118 20.25h-2.25A2.25 2.25 0 0113.5 18v-2.25z" />
          </svg>
          Dashboard
        </Link>
      </div>
      {/* The label is a sibling with htmlFor, not a wrapper. A <select> nested
          inside its own <label> gets the label's forwarded activation on top of
          its own click, which closes the popup the instant it opens — leaving
          it usable only by press-and-drag. */}
      <div className="flex items-center gap-2 text-sm text-blue-800 dark:text-blue-300">
        <label htmlFor="reader-view-as">Viewing as</label>
        <select
          id="reader-view-as"
          value={viewAs}
          onChange={(e) => {
            const next = new URLSearchParams(searchParams.toString())
            if (e.target.value) {
              next.set('viewAs', e.target.value)
            } else {
              next.delete('viewAs')
            }
            router.replace(`${basePath}${next.toString() ? `?${next.toString()}` : ''}`)
          }}
          className="rounded-md border border-blue-200 bg-white px-2 py-1 text-xs text-gray-900 dark:border-blue-800 dark:bg-gray-900 dark:text-gray-100"
        >
          <option value="">Yourself</option>
          <option value="visitor">Visitor</option>
          <option value="beta">Beta reader</option>
          {tiers.map((tier) => (
            <option key={tier.id} value={`tier:${tier.id}`}>
              Subscriber — {tier.name}
            </option>
          ))}
        </select>
      </div>
    </div>
  )
}
