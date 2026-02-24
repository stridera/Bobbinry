/**
 * Project Card Component
 *
 * Displays a project card in the dashboard with warm literary styling
 */

import Link from 'next/link'
import { formatDistanceToNow } from 'date-fns'

interface Project {
  id: string
  name: string
  description: string | null
  shortUrl: string | null
  isArchived: boolean
  createdAt: string
  updatedAt: string
}

export function ProjectCard({ project }: { project: Project }) {
  const projectUrl = `/projects/${project.id}`

  return (
    <Link
      href={projectUrl}
      className="group block border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 rounded-lg overflow-hidden hover:shadow-md hover:border-blue-300/50 dark:hover:border-blue-700/50 transition-all"
    >
      <div className="flex">
        {/* Accent bar */}
        <div className="w-1 bg-blue-500/40 group-hover:bg-blue-500 dark:bg-blue-400/30 dark:group-hover:bg-blue-400 transition-colors" />

        <div className="flex-1 p-4">
          <div className="flex items-start justify-between">
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <h3 className="font-display font-semibold text-gray-900 dark:text-gray-100 group-hover:text-blue-600 dark:group-hover:text-blue-400 transition-colors truncate">
                  {project.name}
                </h3>
                {project.isArchived && (
                  <span className="flex-shrink-0 px-2 py-0.5 bg-gray-100 dark:bg-gray-700 text-gray-500 dark:text-gray-400 text-xs rounded-full">
                    Archived
                  </span>
                )}
                {project.shortUrl && (
                  <span className="flex-shrink-0 px-2 py-0.5 bg-blue-50 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400 text-xs rounded-full">
                    /{project.shortUrl}
                  </span>
                )}
              </div>

              {project.description && (
                <p className="text-sm text-gray-500 dark:text-gray-400 mt-1 line-clamp-2">{project.description}</p>
              )}

              <div className="flex items-center gap-4 mt-2.5 text-xs text-gray-400 dark:text-gray-500">
                <span>Updated {formatDistanceToNow(new Date(project.updatedAt), { addSuffix: true })}</span>
              </div>
            </div>

            <div className="ml-4 flex-shrink-0">
              <svg
                className="w-4 h-4 text-gray-300 dark:text-gray-600 group-hover:text-blue-500 dark:group-hover:text-blue-400 transition-colors"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
              </svg>
            </div>
          </div>
        </div>
      </div>
    </Link>
  )
}
