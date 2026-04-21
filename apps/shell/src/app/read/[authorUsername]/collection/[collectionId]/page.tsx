'use client'

import { useState, useEffect, useCallback } from 'react'
import { useParams } from 'next/navigation'
import Link from 'next/link'
import { config } from '@/lib/config'
import { ReaderNav } from '@/components/ReaderNav'
import { OptimizedImage } from '@/components/OptimizedImage'
import { ReaderProjectCard } from '@/components/ReaderProjectCard'

interface CollectionData {
  id: string
  name: string
  description: string | null
  coverImage: string | null
  colorTheme: string | null
}

interface AuthorInfo {
  userId: string
  username: string | null
  displayName: string | null
  avatarUrl: string | null
  userName: string | null
}

interface CollectionProject {
  id: string
  name: string
  description: string | null
  coverImage: string | null
  shortUrl: string | null
  createdAt: string
  orderIndex: number
}

export default function CollectionReadPage() {
  const params = useParams()
  const authorUsername = params.authorUsername as string
  const collectionId = params.collectionId as string

  const [collection, setCollection] = useState<CollectionData | null>(null)
  const [author, setAuthor] = useState<AuthorInfo | null>(null)
  const [projects, setProjects] = useState<CollectionProject[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const loadCollection = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(
        `${config.apiUrl}/api/public/collections/by-author/${encodeURIComponent(authorUsername)}/${encodeURIComponent(collectionId)}`
      )
      if (!res.ok) {
        setError(res.status === 404 ? 'Collection not found' : 'Failed to load collection')
        return
      }
      const data = await res.json()
      setCollection(data.collection)
      setAuthor(data.author)
      setProjects(data.projects || [])
    } catch {
      setError('Failed to load collection')
    } finally {
      setLoading(false)
    }
  }, [authorUsername, collectionId])

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- initial fetch
    loadCollection()
  }, [loadCollection])

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 dark:bg-gray-950">
        <ReaderNav crumbs={[{ label: authorUsername, href: `/read/${authorUsername}` }]} />
        <div className="flex items-center justify-center py-32">
          <p className="text-gray-500 dark:text-gray-400">Loading...</p>
        </div>
      </div>
    )
  }

  if (error || !collection || !author) {
    return (
      <div className="min-h-screen bg-gray-50 dark:bg-gray-950">
        <ReaderNav crumbs={[{ label: authorUsername, href: `/read/${authorUsername}` }]} />
        <div className="flex items-center justify-center py-32">
          <div className="text-center">
            <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100 mb-2">
              {error || 'Collection not found'}
            </h1>
            <Link href={`/read/${authorUsername}`} className="text-blue-600 dark:text-blue-400 hover:underline">
              View author&apos;s works
            </Link>
          </div>
        </div>
      </div>
    )
  }

  const authorName = author.displayName || author.userName || author.username || authorUsername

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-950">
      <ReaderNav crumbs={[
        { label: authorName, href: `/read/${authorUsername}` },
        { label: collection.name }
      ]} />

      <div className="max-w-4xl mx-auto px-4 py-8">
        {/* Collection header */}
        <div className="flex gap-6 mb-8">
          {collection.coverImage && (
            <OptimizedImage
              src={collection.coverImage}
              variant="thumb"
              alt={collection.name}
              className="w-32 h-44 rounded-lg object-cover shadow-md flex-shrink-0"
            />
          )}
          <div className="min-w-0">
            <h1 className="font-display text-3xl font-bold text-gray-900 dark:text-gray-100 mb-2">
              {collection.name}
            </h1>
            <Link
              href={`/read/${authorUsername}`}
              className="text-sm text-blue-600 dark:text-blue-400 hover:underline"
            >
              by {authorName}
            </Link>
            <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
              {projects.length} book{projects.length !== 1 ? 's' : ''} in this series
            </p>
            {collection.description && (
              <p className="text-gray-600 dark:text-gray-300 mt-3 whitespace-pre-line">
                {collection.description}
              </p>
            )}
          </div>
        </div>

        {/* Books grid */}
        <div className="grid gap-4 sm:grid-cols-2">
          {projects.map((project, index) => (
            <ReaderProjectCard
              key={project.id}
              href={`/read/${authorUsername}/${project.shortUrl}`}
              name={project.name}
              coverImage={project.coverImage}
              description={project.description}
              badge={`Book ${index + 1}`}
            />
          ))}
        </div>
      </div>
    </div>
  )
}
