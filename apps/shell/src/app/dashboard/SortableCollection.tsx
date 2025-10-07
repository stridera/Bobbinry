'use client'

/**
 * Sortable Collection Component
 *
 * Allows drag & drop reordering of projects within a collection
 */

import { useState } from 'react'
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
}

export function SortableCollection({ collection, onReorder }: SortableCollectionProps) {
  const [projects, setProjects] = useState(collection.projects)
  const [isDragging, setIsDragging] = useState(false)

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
              />
            ))}
          </div>
        </SortableContext>
      </DndContext>
    </div>
  )
}
