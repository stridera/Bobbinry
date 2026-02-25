'use client'

import { useState, useEffect } from 'react'
import { useParams } from 'next/navigation'
import { useSession } from 'next-auth/react'
import Link from 'next/link'
import { config } from '@/lib/config'
import { ReaderNav } from '@/components/ReaderNav'

interface ProjectInfo {
  id: string
  name: string
  description: string | null
  coverImage: string | null
  shortUrl: string | null
}

interface AuthorInfo {
  userId: string
  username: string | null
  displayName: string | null
  avatarUrl: string | null
  userName: string | null
}

interface TocChapter {
  id: string
  title: string
  publishedAt?: string
  viewCount?: number
  order: number
  locked?: boolean
  embargoUntil?: string
}

interface SubscriptionTier {
  id: string
  name: string
  priceMonthly: string | null
  chapterDelayDays: number
  tierLevel: number
}

export default function ProjectReadingPage() {
  const params = useParams()
  const authorUsername = params.authorUsername as string
  const projectSlug = params.projectSlug as string
  const { data: session } = useSession()

  const [project, setProject] = useState<ProjectInfo | null>(null)
  const [author, setAuthor] = useState<AuthorInfo | null>(null)
  const [toc, setToc] = useState<TocChapter[]>([])
  const [tiers, setTiers] = useState<SubscriptionTier[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    loadProject()
  }, [authorUsername, projectSlug])

  const loadProject = async () => {
    setLoading(true)
    try {
      // Resolve by author + slug
      const res = await fetch(
        `${config.apiUrl}/api/public/projects/by-author-and-slug/${encodeURIComponent(authorUsername)}/${encodeURIComponent(projectSlug)}`
      )
      if (!res.ok) {
        setError(res.status === 404 ? 'Project not found' : 'Failed to load project')
        return
      }
      const data = await res.json()
      setProject(data.project)
      setAuthor(data.author)

      // Load TOC and tiers in parallel
      const userId = session?.user?.id
      const tocUrl = `${config.apiUrl}/api/public/projects/${data.project.id}/toc${userId ? `?userId=${userId}` : ''}`
      const [tocRes, tiersRes] = await Promise.all([
        fetch(tocUrl),
        data.project.ownerId
          ? fetch(`${config.apiUrl}/api/users/${data.project.ownerId}/subscription-tiers`)
          : Promise.resolve(null)
      ])

      if (tocRes.ok) {
        const tocData = await tocRes.json()
        setToc(tocData.toc || [])
      }

      if (tiersRes?.ok) {
        const tiersData = await tiersRes.json()
        setTiers((tiersData.tiers || []).filter((t: SubscriptionTier) => t.tierLevel > 0))
      }
    } catch (err) {
      setError('Failed to load project')
    } finally {
      setLoading(false)
    }
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 dark:bg-gray-950">
        <ReaderNav crumbs={[{ label: authorUsername, href: `/read/${authorUsername}` }]} />
        <div className="flex items-center justify-center py-32">
          <div className="text-gray-500 dark:text-gray-400">Loading...</div>
        </div>
      </div>
    )
  }

  if (error || !project) {
    return (
      <div className="min-h-screen bg-gray-50 dark:bg-gray-950">
        <ReaderNav crumbs={[{ label: authorUsername, href: `/read/${authorUsername}` }]} />
        <div className="flex items-center justify-center py-32">
          <div className="text-center">
            <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100 mb-2">
              {error || 'Project not found'}
            </h1>
            <Link href="/explore" className="text-blue-600 dark:text-blue-400 hover:underline">
              Browse Stories
            </Link>
          </div>
        </div>
      </div>
    )
  }

  const authorName = author?.displayName || author?.userName || 'Unknown Author'

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-950">
      <ReaderNav crumbs={[
        { label: authorName, href: `/read/${authorUsername}` },
        { label: project.name }
      ]} />

      <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 py-8">

      {/* Project header */}
      <div className="flex gap-6 mb-8">
        {project.coverImage && (
          <img
            src={project.coverImage}
            alt={project.name}
            className="w-32 h-44 rounded-lg object-cover shadow-md flex-shrink-0"
          />
        )}
        <div className="min-w-0">
          <h1 className="font-display text-3xl font-bold text-gray-900 dark:text-gray-100 mb-2">
            {project.name}
          </h1>
          {author && (
            <Link
              href={author.username ? `/read/${author.username}` : '#'}
              className="text-sm text-blue-600 dark:text-blue-400 hover:underline"
            >
              by {authorName}
            </Link>
          )}
          {project.description && (
            <p className="text-gray-600 dark:text-gray-300 mt-3 whitespace-pre-line">
              {project.description}
            </p>
          )}
        </div>
      </div>

      {/* Table of Contents */}
      <div className="mb-8">
        <h2 className="font-display text-xl font-semibold text-gray-900 dark:text-gray-100 mb-4">
          Table of Contents
        </h2>
        {toc.length === 0 ? (
          <p className="text-gray-500 dark:text-gray-400 italic">No published chapters yet.</p>
        ) : (
          <div className="space-y-1">
            {toc.map((chapter, index) => (
              <div key={chapter.id}>
                {chapter.locked ? (
                  <div className="flex items-center justify-between px-4 py-3 rounded-lg bg-gray-50 dark:bg-gray-900/30 opacity-60">
                    <div className="flex items-center gap-3">
                      <span className="text-sm text-gray-400 dark:text-gray-500 w-8 text-right">{index + 1}</span>
                      <span className="text-gray-500 dark:text-gray-400">{chapter.title || 'Untitled'}</span>
                    </div>
                    <svg className="w-4 h-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
                    </svg>
                  </div>
                ) : (
                  <Link
                    href={`/read/${authorUsername}/${projectSlug}/${chapter.id}`}
                    className="flex items-center justify-between px-4 py-3 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-900/30 transition-colors group"
                  >
                    <div className="flex items-center gap-3">
                      <span className="text-sm text-gray-400 dark:text-gray-500 w-8 text-right">{index + 1}</span>
                      <span className="text-gray-900 dark:text-gray-100 group-hover:text-blue-600 dark:group-hover:text-blue-400">
                        {chapter.title || 'Untitled'}
                      </span>
                    </div>
                    {chapter.publishedAt && (
                      <span className="text-xs text-gray-400 dark:text-gray-500">
                        {new Date(chapter.publishedAt).toLocaleDateString()}
                      </span>
                    )}
                  </Link>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Subscribe / Follow section */}
      {tiers.length > 0 && (
        <div className="border-t border-gray-200 dark:border-gray-800 pt-8">
          <h2 className="font-display text-xl font-semibold text-gray-900 dark:text-gray-100 mb-4">
            Support this Author
          </h2>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {tiers.map(tier => (
              <div
                key={tier.id}
                className="p-4 rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900/30"
              >
                <h3 className="font-medium text-gray-900 dark:text-gray-100">{tier.name}</h3>
                <p className="text-lg font-bold text-gray-900 dark:text-gray-100 mt-1">
                  ${tier.priceMonthly || '0'}<span className="text-sm font-normal text-gray-500">/mo</span>
                </p>
                <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                  {tier.chapterDelayDays === 0 ? 'Immediate access' : `${tier.chapterDelayDays}d early access`}
                </p>
                <button className="w-full mt-3 px-3 py-1.5 bg-blue-600 text-white rounded text-sm hover:bg-blue-700 transition-colors">
                  Subscribe
                </button>
              </div>
            ))}
          </div>
        </div>
      )}
      </div>
    </div>
  )
}
