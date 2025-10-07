/**
 * Project Card Component
 *
 * Displays a project card in the dashboard
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
      className="block border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 rounded-lg p-4 hover:border-blue-300 dark:hover:border-blue-600 hover:shadow-md transition-all group"
    >
      <div className="flex items-start justify-between">
        <div className="flex-1">
          <div className="flex items-center gap-2">
            <h3 className="font-semibold text-gray-900 dark:text-gray-100 group-hover:text-blue-600 dark:group-hover:text-blue-400 transition-colors">
              {project.name}
            </h3>
            {project.isArchived && (
              <span className="px-2 py-0.5 bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-400 text-xs rounded-full">
                Archived
              </span>
            )}
            {project.shortUrl && (
              <span className="px-2 py-0.5 bg-blue-100 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400 text-xs rounded-full">
                /{project.shortUrl}
              </span>
            )}
          </div>

          {project.description && (
            <p className="text-sm text-gray-600 dark:text-gray-400 mt-1 line-clamp-2">{project.description}</p>
          )}

          <div className="flex items-center gap-4 mt-3 text-xs text-gray-500 dark:text-gray-500">
            <span>Updated {formatDistanceToNow(new Date(project.updatedAt), { addSuffix: true })}</span>
          </div>
        </div>

        <div className="ml-4">
          <svg
            className="w-5 h-5 text-gray-400 dark:text-gray-500 group-hover:text-blue-600 dark:group-hover:text-blue-400 transition-colors"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M9 5l7 7-7 7"
            />
          </svg>
        </div>
      </div>
    </Link>
  )
}
