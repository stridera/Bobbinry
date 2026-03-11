'use client'

/**
 * Sortable Collection Component
 *
 * Allows drag & drop reordering of projects within a collection
 */

import { useState, useRef, useEffect } from 'react'
import Link from 'next/link'
import { ConfirmModal } from '@/components/ConfirmModal'
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  DragEndEvent,
} from '@dnd-kit/core'
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable'
import { SortableProjectCard } from './SortableProjectCard'

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

interface Collection {
  id: string
  name: string
  description: string | null
  coverImage: string | null
  colorTheme: string | null
  projects: Project[]
}

interface SortableCollectionProps {
  collection: Collection
  onReorder: (collectionId: string, projectIds: string[]) => Promise<void>
  onDeleteCollection?: (collectionId: string) => void
  onRemoveFromCollection?: (collectionId: string, projectId: string) => void
}

export function SortableCollection({ collection, onReorder, onDeleteCollection, onRemoveFromCollection }: SortableCollectionProps) {
  const [projects, setProjects] = useState(collection.projects)
  const [isDragging, setIsDragging] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- sync local drag state with parent prop
    setProjects(collection.projects)
  }, [collection.projects])
  const menuRef = useRef<HTMLDivElement>(null)

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 8, // 8px movement required before drag starts
      },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  )

  useEffect(() => {
    if (!menuOpen) return
    const handleClick = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [menuOpen])

  const handleDragStart = () => {
    setIsDragging(true)
  }

  const handleDragEnd = async (event: DragEndEvent) => {
    setIsDragging(false)
    const { active, over } = event

    if (over && active.id !== over.id) {
      const oldIndex = projects.findIndex((p) => p.id === active.id)
      const newIndex = projects.findIndex((p) => p.id === over.id)

      const newProjects = arrayMove(projects, oldIndex, newIndex)
      setProjects(newProjects)

      // Optimistically update UI, then call API
      try {
        await onReorder(
          collection.id,
          newProjects.map((p) => p.id)
        )
      } catch (error) {
        // Revert on error
        setProjects(projects)
        console.error('Failed to reorder projects:', error)
      }
    }
  }

  return (
    <>
    <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-6">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h2 className="text-xl font-bold text-gray-900 dark:text-gray-100">{collection.name}</h2>
          {collection.description && (
            <p className="text-sm text-gray-600 dark:text-gray-400 mt-1">{collection.description}</p>
          )}
        </div>
        <div className="flex items-center gap-2">
          <span className="text-sm text-gray-500 dark:text-gray-400">
            {projects.length} project{projects.length !== 1 ? 's' : ''}
          </span>
          <span className="text-xs text-gray-400 dark:text-gray-500">• Drag to reorder</span>

          {onDeleteCollection && (
            <div className="relative" ref={menuRef}>
              <button
                onClick={() => setMenuOpen(!menuOpen)}
                className="p-1.5 text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg transition-colors"
                aria-label="Collection actions"
              >
                <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
                  <circle cx="12" cy="5" r="1.5" />
                  <circle cx="12" cy="12" r="1.5" />
                  <circle cx="12" cy="19" r="1.5" />
                </svg>
              </button>

              {menuOpen && (
                <div className="absolute right-0 top-full mt-1 w-44 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-600 rounded-lg shadow-lg z-20 py-1">
                  <Link
                    href={`/projects/new?collectionId=${collection.id}`}
                    className="block px-3 py-2 text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700"
                    onClick={() => setMenuOpen(false)}
                  >
                    New Project
                  </Link>
                  <div className="border-t border-gray-100 dark:border-gray-700 my-1" />
                  <button
                    onClick={() => {
                      setMenuOpen(false)
                      setShowDeleteConfirm(true)
                    }}
                    className="w-full text-left px-3 py-2 text-sm text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20"
                  >
                    Move to Trash
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragStart={handleDragStart}
        onDragEnd={handleDragEnd}
      >
        <SortableContext items={projects.map((p) => p.id)} strategy={verticalListSortingStrategy}>
          <div className="space-y-3">
            {projects.map((project) => (
              <SortableProjectCard
                key={project.id}
                project={project}
                isDragging={isDragging}
                {...(onRemoveFromCollection && {
                  onRemoveFromCollection: (projectId: string) => onRemoveFromCollection(collection.id, projectId)
                })}
              />
            ))}
          </div>
        </SortableContext>
      </DndContext>
    </div>

    {onDeleteCollection && (
      <ConfirmModal
        open={showDeleteConfirm}
        title="Move to Trash"
        description={`"${collection.name}" will be moved to trash. Projects inside will not be deleted. Auto-deletes after 30 days.`}
        confirmLabel="Move to Trash"
        variant="danger"
        onConfirm={() => {
          setShowDeleteConfirm(false)
          onDeleteCollection(collection.id)
        }}
        onCancel={() => setShowDeleteConfirm(false)}
      />
    )}
    </>
  )
}
