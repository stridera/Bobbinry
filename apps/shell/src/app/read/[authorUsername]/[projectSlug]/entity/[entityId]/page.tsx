'use client'

import { Suspense, useEffect, useState } from 'react'
import { useParams } from 'next/navigation'
import { useSession } from 'next-auth/react'
import Link from 'next/link'
import { config } from '@/lib/config'
import { ReaderNav } from '@/components/ReaderNav'
import EntityView from '../../EntityView'
import type { PublishedEntity, PublishedType } from '../../entities-data'

interface EntityPayload {
  type: PublishedType
  entity: PublishedEntity
  callerTierLevel: number
}

export default function EntitySubpage() {
  return (
    <Suspense fallback={<Loader />}>
      <EntitySubpageContent />
    </Suspense>
  )
}

function EntitySubpageContent() {
  const params = useParams()
  const authorUsername = params.authorUsername as string
  const projectSlug = params.projectSlug as string
  const entityId = params.entityId as string
  const { data: session } = useSession()
  const apiToken = (session as any)?.apiToken as string | undefined

  const [authorName, setAuthorName] = useState<string>('')
  const [projectName, setProjectName] = useState<string>('')
  const [projectId, setProjectId] = useState<string>('')
  const [payload, setPayload] = useState<EntityPayload | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [tierRequired, setTierRequired] = useState<number | null>(null)

  // Resolve project from slug/author first so we can hit the entities endpoint
  useEffect(() => {
    let cancelled = false
    fetch(
      `${config.apiUrl}/api/public/projects/by-author-and-slug/${encodeURIComponent(authorUsername)}/${encodeURIComponent(projectSlug)}`
    )
      .then(async r => (r.ok ? r.json() : Promise.reject(new Error(`Project not found (${r.status})`))))
      .then(data => {
        if (cancelled) return
        setAuthorName(data.author?.displayName || data.author?.username || authorUsername)
        setProjectName(data.project?.name || projectSlug)
        setProjectId(data.project?.id || '')
      })
      .catch(err => {
        if (!cancelled) setError(err?.message ?? 'Project not found')
      })
    return () => { cancelled = true }
  }, [authorUsername, projectSlug])

  useEffect(() => {
    if (!projectId) return
    let cancelled = false
    /* eslint-disable react-hooks/set-state-in-effect -- initial fetch */
    setLoading(true)
    setTierRequired(null)
    /* eslint-enable react-hooks/set-state-in-effect */
    const headers: Record<string, string> = {}
    if (apiToken) headers['Authorization'] = `Bearer ${apiToken}`
    fetch(`${config.apiUrl}/api/public/projects/${projectId}/entities/${entityId}`, { headers })
      .then(async r => {
        if (r.status === 403) {
          const body = await r.json().catch(() => ({}))
          if (!cancelled) setTierRequired(body.minimumTierLevel ?? 1)
          return null
        }
        if (!r.ok) throw new Error(`Failed to load entity (${r.status})`)
        return r.json() as Promise<EntityPayload>
      })
      .then(data => {
        if (!cancelled && data) setPayload(data)
      })
      .catch(err => {
        if (!cancelled) setError(err?.message ?? 'Failed to load entity')
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => { cancelled = true }
  }, [projectId, entityId, apiToken])

  const crumbs = [
    { label: authorName || authorUsername, href: `/read/${authorUsername}` },
    { label: projectName || projectSlug, href: `/read/${authorUsername}/${projectSlug}?tab=entities` },
    { label: payload?.entity.name || 'Entity' },
  ]

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-950">
      <ReaderNav crumbs={crumbs} />

      {(loading || error || tierRequired !== null) && (
        <div className="mx-auto max-w-3xl px-4 py-6 sm:px-6 lg:px-8">
          <Link
            href={`/read/${authorUsername}/${projectSlug}?tab=entities`}
            className="mb-4 inline-flex items-center gap-1 text-xs text-gray-500 hover:text-gray-800 dark:text-gray-400 dark:hover:text-gray-200"
          >
            <svg className="h-3 w-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
            Back to codex
          </Link>

          {loading && <Loader />}

          {!loading && error && (
            <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700 dark:border-red-800 dark:bg-red-900/20 dark:text-red-300">
              {error}
            </div>
          )}

          {!loading && tierRequired !== null && (
            <div className="rounded-lg border border-purple-200 bg-purple-50 p-6 text-sm text-purple-800 dark:border-purple-800 dark:bg-purple-900/20 dark:text-purple-200">
              <p className="font-medium">This entity is available to subscribers at tier {tierRequired} or higher.</p>
              <Link
                href={`/read/${authorUsername}/${projectSlug}?tab=support`}
                className="mt-3 inline-flex items-center gap-1 rounded-md bg-purple-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-purple-700"
              >
                View subscription tiers →
              </Link>
            </div>
          )}
        </div>
      )}

      {!loading && payload && (
        <EntityView
          type={payload.type}
          entity={payload.entity}
          projectId={projectId}
          apiToken={apiToken}
          entityHrefBase={`/read/${authorUsername}/${projectSlug}/entity`}
          stickyHeaderTopClass="top-11"
          headerAction={
            <Link
              href={`/read/${authorUsername}/${projectSlug}?tab=entities`}
              className="inline-flex items-center gap-1 rounded-md px-2.5 py-1 text-xs font-medium text-gray-500 hover:bg-gray-100 hover:text-gray-900 dark:text-gray-400 dark:hover:bg-gray-800 dark:hover:text-gray-100"
              title="Back to codex"
            >
              <svg className="h-3 w-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
              </svg>
              Back to codex
            </Link>
          }
        />
      )}
    </div>
  )
}

function Loader() {
  return (
    <div className="py-16 text-center text-sm text-gray-500 dark:text-gray-400">
      Loading…
    </div>
  )
}
