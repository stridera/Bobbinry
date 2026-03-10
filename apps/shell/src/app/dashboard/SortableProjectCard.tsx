'use client'

/**
 * Sortable Project Card Component
 *
 * A draggable version of ProjectCard with remove-from-collection action
 */

import { useState, useRef, useEffect, useCallback } from 'react'
import { createPortal } from 'react-dom'
import { useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import Link from 'next/link'
import { formatDistanceToNow } from 'date-fns'
import { OptimizedImage } from '@/components/OptimizedImage'

interface Project {
  id: string
  name: string
  description: string | null
  coverImage: string | null
  shortUrl: string | null
  isArchived: boolean
  createdAt: string
  updatedAt: string
}

interface SortableProjectCardProps {
  project: Project
  isDragging: boolean
  onRemoveFromCollection?: (projectId: string) => void
}

export function SortableProjectCard({ project, onRemoveFromCollection }: SortableProjectCardProps) {
  const [menuOpen, setMenuOpen] = useState(false)
  const buttonRef = useRef<HTMLButtonElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const [menuPos, setMenuPos] = useState({ top: 0, left: 0 })

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

  const updateMenuPosition = useCallback(() => {
    if (!buttonRef.current) return
    const rect = buttonRef.current.getBoundingClientRect()
    setMenuPos({
      top: rect.bottom + 4,
      left: rect.right,
    })
  }, [])

  useEffect(() => {
    if (!menuOpen) return
    updateMenuPosition()
    const handleClick = (e: MouseEvent) => {
      if (
        menuRef.current && !menuRef.current.contains(e.target as Node) &&
        buttonRef.current && !buttonRef.current.contains(e.target as Node)
      ) {
        setMenuOpen(false)
      }
    }
    const handleScroll = () => setMenuOpen(false)
    document.addEventListener('mousedown', handleClick)
    window.addEventListener('scroll', handleScroll, true)
    return () => {
      document.removeEventListener('mousedown', handleClick)
      window.removeEventListener('scroll', handleScroll, true)
    }
  }, [menuOpen, updateMenuPosition])

  const projectUrl = `/projects/${project.id}`

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

        {/* Cover thumbnail */}
        {project.coverImage && (
          <div className="w-12 h-12 flex-shrink-0 rounded-md overflow-hidden">
            <OptimizedImage
              src={project.coverImage}
              variant="thumb"
              alt=""
              className="w-full h-full object-cover"
            />
          </div>
        )}

        {/* Project content */}
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

        {/* Remove from collection */}
        {onRemoveFromCollection && (
          <button
            ref={buttonRef}
            onClick={() => setMenuOpen(!menuOpen)}
            className="flex-shrink-0 p-1.5 text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg transition-colors"
            aria-label="Project actions"
          >
            <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
              <circle cx="12" cy="5" r="1.5" />
              <circle cx="12" cy="12" r="1.5" />
              <circle cx="12" cy="19" r="1.5" />
            </svg>
          </button>
        )}
      </div>

      {menuOpen && onRemoveFromCollection && createPortal(
        <div
          ref={menuRef}
          className="fixed w-52 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-600 rounded-lg shadow-lg z-[9999] py-1"
          style={{ top: menuPos.top, left: menuPos.left - 208 }}
        >
          <button
            onClick={() => {
              onRemoveFromCollection(project.id)
              setMenuOpen(false)
            }}
            className="w-full text-left px-3 py-2 text-sm text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20"
          >
            Remove from Collection
          </button>
        </div>,
        document.body
      )}
    </div>
  )
}
