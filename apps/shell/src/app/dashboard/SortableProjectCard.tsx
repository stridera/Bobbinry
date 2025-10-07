/**
 * Sortable Project Card Component
 *
 * A draggable version of ProjectCard
 */

import { useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
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

interface SortableProjectCardProps {
  project: Project
  isDragging: boolean
}

export function SortableProjectCard({ project, isDragging }: SortableProjectCardProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging: isThisCardDragging,
  } = useSortable({ id: project.id })

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isThisCardDragging ? 0.5 : 1,
  }

  const projectUrl = project.shortUrl ? `/p/${project.shortUrl}` : `/projects/${project.id}`

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 rounded-lg transition-all ${
        isThisCardDragging ? 'shadow-2xl z-10' : 'hover:border-blue-300 dark:hover:border-blue-600 hover:shadow-md'
      }`}
    >
      <div className="flex items-center gap-3 p-4">
        {/* Drag handle */}
        <button
          {...attributes}
          {...listeners}
          className="cursor-grab active:cursor-grabbing text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-400 transition-colors p-1"
          aria-label="Drag to reorder"
        >
          <svg
            className="w-5 h-5"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M4 8h16M4 16h16"
            />
          </svg>
        </button>

        {/* Project content - same as ProjectCard */}
        <Link href={projectUrl} className="flex-1 min-w-0 group">
          <div className="flex items-start justify-between">
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <h3 className="font-semibold text-gray-900 dark:text-gray-100 group-hover:text-blue-600 dark:group-hover:text-blue-400 transition-colors truncate">
                  {project.name}
                </h3>
                {project.isArchived && (
                  <span className="px-2 py-0.5 bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-400 text-xs rounded-full whitespace-nowrap">
                    Archived
                  </span>
                )}
                {project.shortUrl && (
                  <span className="px-2 py-0.5 bg-blue-100 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400 text-xs rounded-full whitespace-nowrap">
                    /{project.shortUrl}
                  </span>
                )}
              </div>

              {project.description && (
                <p className="text-sm text-gray-600 dark:text-gray-400 mt-1 line-clamp-1">{project.description}</p>
              )}

              <div className="flex items-center gap-4 mt-3 text-xs text-gray-500 dark:text-gray-500">
                <span>
                  Updated {formatDistanceToNow(new Date(project.updatedAt), { addSuffix: true })}
                </span>
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
      </div>
    </div>
  )
}
