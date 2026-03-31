'use client'

/**
 * Project Card Component
 *
 * Displays a project card in the dashboard with warm literary styling
 * and dual action buttons for Dashboard and Write access.
 */

import { useState, useRef, useEffect, useCallback } from 'react'
import { createPortal } from 'react-dom'
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

interface CollectionInfo {
  id: string
  name: string
}

interface ProjectCardProps {
  project: Project
  collections?: CollectionInfo[]
  currentCollectionId?: string
  onAddToCollection?: (collectionId: string, projectId: string) => void
  onRemoveFromCollection?: (collectionId: string, projectId: string) => void
}

export function ProjectCard({ project, collections, currentCollectionId, onAddToCollection, onRemoveFromCollection }: ProjectCardProps) {
  const [menuOpen, setMenuOpen] = useState(false)
  const buttonRef = useRef<HTMLButtonElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const [menuPos, setMenuPos] = useState({ top: 0, left: 0 })

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

  const hasMenuItems = collections && collections.length > 0 || currentCollectionId

  return (
    <div className="group border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 rounded-lg overflow-hidden hover:shadow-md hover:border-blue-300/50 dark:hover:border-blue-700/50 hover:-translate-y-0.5 transition-all duration-200">
      <div className="flex">
        {/* Cover thumbnail or accent bar */}
        {project.coverImage ? (
          <div className="w-20 flex-shrink-0 relative overflow-hidden">
            <OptimizedImage
              src={project.coverImage}
              variant="thumb"
              alt=""
              className="absolute inset-0 w-full h-full object-cover"
            />
          </div>
        ) : (
          <div className="w-1 bg-blue-500/40 group-hover:bg-blue-500 dark:bg-blue-400/30 dark:group-hover:bg-blue-400 transition-colors" />
        )}

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
                  <Link
                    href={`/p/${project.shortUrl}`}
                    className="flex-shrink-0 px-2 py-0.5 bg-blue-50 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400 hover:bg-blue-100 dark:hover:bg-blue-900/50 text-xs rounded-full transition-colors"
                    title="View published project"
                  >
                    /{project.shortUrl}
                  </Link>
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
                href={`/projects/${project.id}`}
                className="px-3 py-1.5 text-xs font-medium text-gray-600 dark:text-gray-300 hover:text-gray-900 dark:hover:text-gray-100 border border-gray-200 dark:border-gray-600 rounded-lg hover:border-gray-300 dark:hover:border-gray-500 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
              >
                Dashboard
              </Link>
              <Link
                href={`/projects/${project.id}/write`}
                className="px-3 py-1.5 text-xs font-medium text-white bg-blue-600 hover:bg-blue-700 dark:bg-blue-700 dark:hover:bg-blue-600 rounded-lg transition-colors"
              >
                Write
              </Link>

              {/* Context menu trigger */}
              {hasMenuItems && (
                <button
                  ref={buttonRef}
                  onClick={() => setMenuOpen(!menuOpen)}
                  className="p-1.5 text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg transition-colors"
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
          </div>
        </div>
      </div>

      {/* Dropdown rendered via portal to escape overflow clipping */}
      {menuOpen && createPortal(
        <div
          ref={menuRef}
          className="fixed w-52 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-600 rounded-lg shadow-lg z-[9999] py-1"
          style={{ top: menuPos.top, left: menuPos.left - 208 }}
        >
          {/* Add to Collection — inline list */}
          {collections && collections.length > 0 && (
            <>
              <div className="px-3 py-1.5 text-xs font-medium text-gray-400 dark:text-gray-500 uppercase tracking-wider">
                Add to Collection
              </div>
              <div className="max-h-48 overflow-y-auto">
                {collections.map((col) => (
                  <button
                    key={col.id}
                    onClick={() => {
                      onAddToCollection?.(col.id, project.id)
                      setMenuOpen(false)
                    }}
                    className="w-full text-left px-3 py-2 text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700 truncate"
                  >
                    {col.name}
                  </button>
                ))}
              </div>
            </>
          )}

          {/* Remove from Collection */}
          {currentCollectionId && onRemoveFromCollection && (
            <>
              {collections && collections.length > 0 && (
                <div className="border-t border-gray-100 dark:border-gray-700 my-1" />
              )}
              <button
                onClick={() => {
                  onRemoveFromCollection(currentCollectionId, project.id)
                  setMenuOpen(false)
                }}
                className="w-full text-left px-3 py-2 text-sm text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20"
              >
                Remove from Collection
              </button>
            </>
          )}
        </div>,
        document.body
      )}
    </div>
  )
}
