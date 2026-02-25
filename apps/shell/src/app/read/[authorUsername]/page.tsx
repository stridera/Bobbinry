'use client'

import { useState, useEffect } from 'react'
import { useParams } from 'next/navigation'
import { useSession } from 'next-auth/react'
import Link from 'next/link'
import { config } from '@/lib/config'
import { ReaderNav } from '@/components/ReaderNav'

interface AuthorInfo {
  userId: string
  username: string
  displayName: string | null
  avatarUrl: string | null
  bio?: string | null
  userName: string | null
}

interface PublishedProject {
  id: string
  name: string
  description: string | null
  coverImage: string | null
  shortUrl: string | null
  createdAt: string
}

export default function AuthorReadPage() {
  const params = useParams()
  const authorUsername = params.authorUsername as string
  const { data: session } = useSession()

  const [author, setAuthor] = useState<AuthorInfo | null>(null)
  const [projects, setProjects] = useState<PublishedProject[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    loadAuthor()
  }, [authorUsername])

  const loadAuthor = async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(
        `${config.apiUrl}/api/public/authors/${encodeURIComponent(authorUsername)}/projects`
      )
      if (!res.ok) {
        setError(res.status === 404 ? 'Author not found' : 'Failed to load author')
        return
      }
      const data = await res.json()
      setAuthor(data.author)
      setProjects(data.projects || [])
    } catch (err) {
      setError('Failed to load author')
    } finally {
      setLoading(false)
    }
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 dark:bg-gray-950">
        <ReaderNav crumbs={[{ label: 'Explore', href: '/explore' }]} />
        <div className="flex items-center justify-center py-32">
          <p className="text-gray-500 dark:text-gray-400">Loading...</p>
        </div>
      </div>
    )
  }

  if (error || !author) {
    return (
      <div className="min-h-screen bg-gray-50 dark:bg-gray-950">
        <ReaderNav crumbs={[{ label: 'Explore', href: '/explore' }]} />
        <div className="flex items-center justify-center py-32">
          <div className="text-center">
            <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100 mb-2">
              {error || 'Author not found'}
            </h1>
            <Link href="/explore" className="text-blue-600 dark:text-blue-400 hover:underline">
              Browse Stories
            </Link>
          </div>
        </div>
      </div>
    )
  }

  const displayName = author.displayName || author.userName || author.username

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-950">
      <ReaderNav crumbs={[{ label: displayName, href: `/u/${author.username}` }, { label: 'Works' }]} />

      <div className="max-w-4xl mx-auto px-4 py-8">
        {/* Author header */}
        <div className="flex items-center gap-4 mb-8">
          {author.avatarUrl ? (
            <img
              src={author.avatarUrl}
              alt={displayName}
              className="w-16 h-16 rounded-full object-cover"
            />
          ) : (
            <div className="w-16 h-16 rounded-full bg-gradient-to-br from-purple-400 to-blue-500 flex items-center justify-center text-white font-bold text-2xl">
              {displayName.charAt(0).toUpperCase()}
            </div>
          )}
          <div>
            <h1 className="font-display text-2xl font-bold text-gray-900 dark:text-gray-100">
              {displayName}
            </h1>
            <div className="flex items-center gap-3 text-sm text-gray-500 dark:text-gray-400">
              <span>@{author.username}</span>
              <span>&middot;</span>
              <span>{projects.length} published work{projects.length !== 1 ? 's' : ''}</span>
            </div>
            <Link
              href={`/u/${author.username}`}
              className="text-xs text-blue-600 dark:text-blue-400 hover:underline mt-1 inline-block"
            >
              View full profile
            </Link>
          </div>
        </div>

        {/* Published projects grid */}
        {projects.length === 0 ? (
          <div className="text-center py-12">
            <p className="text-gray-500 dark:text-gray-400">
              This author hasn't published any stories yet.
            </p>
          </div>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2">
            {projects.map(project => (
              <Link
                key={project.id}
                href={`/read/${author.username}/${project.shortUrl}`}
                className="group bg-white dark:bg-gray-900 rounded-lg border border-gray-200 dark:border-gray-800 hover:border-blue-300 dark:hover:border-blue-700 hover:shadow-md transition-all overflow-hidden"
              >
                {/* Cover or placeholder */}
                <div className="aspect-[16/9] bg-gradient-to-br from-blue-100 to-purple-100 dark:from-blue-900/30 dark:to-purple-900/30 relative overflow-hidden">
                  {project.coverImage ? (
                    <img
                      src={project.coverImage}
                      alt={project.name}
                      className="w-full h-full object-cover"
                    />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center">
                      <span className="text-4xl font-bold text-blue-300 dark:text-blue-700 opacity-50">
                        {project.name.charAt(0).toUpperCase()}
                      </span>
                    </div>
                  )}
                </div>
                <div className="p-4">
                  <h3 className="font-semibold text-gray-900 dark:text-gray-100 truncate group-hover:text-blue-600 dark:group-hover:text-blue-400 transition-colors">
                    {project.name}
                  </h3>
                  {project.description && (
                    <p className="text-sm text-gray-500 dark:text-gray-400 mt-1 line-clamp-2">
                      {project.description}
                    </p>
                  )}
                </div>
              </Link>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
