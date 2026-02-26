/**
 * Project Card Component
 *
 * Displays a project card in the dashboard with warm literary styling
 * and dual action buttons for Dashboard and Write access.
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
  return (
    <div className="group border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 rounded-lg overflow-hidden hover:shadow-md hover:border-blue-300/50 dark:hover:border-blue-700/50 transition-all">
      <div className="flex">
        {/* Accent bar */}
        <div className="w-1 bg-blue-500/40 group-hover:bg-blue-500 dark:bg-blue-400/30 dark:group-hover:bg-blue-400 transition-colors" />

        <div className="flex-1 p-4">
          <div className="flex items-start justify-between">
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <h3 className="font-display font-semibold text-gray-900 dark:text-gray-100 truncate">
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

            {/* Action buttons */}
            <div className="ml-4 flex-shrink-0 flex items-center gap-2">
              <Link
                href={`/projects/${project.id}/settings`}
                className="px-3 py-1.5 text-xs font-medium text-gray-600 dark:text-gray-300 hover:text-gray-900 dark:hover:text-gray-100 border border-gray-200 dark:border-gray-600 rounded-lg hover:border-gray-300 dark:hover:border-gray-500 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
              >
                Dashboard
              </Link>
              <Link
                href={`/projects/${project.id}`}
                className="px-3 py-1.5 text-xs font-medium text-white bg-blue-600 hover:bg-blue-700 dark:bg-blue-700 dark:hover:bg-blue-600 rounded-lg transition-colors"
              >
                Write
              </Link>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
