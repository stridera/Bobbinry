'use client'

/**
 * Recent Activity Panel Component
 *
 * Shows recent edits across all user's projects (Campfire-style)
 */

import { useState, useEffect } from 'react'
import Link from 'next/link'
import { formatDistanceToNow } from 'date-fns'

interface Activity {
  entity: {
    id: string
    projectId: string
    collectionName: string
    entityData: any
    lastEditedAt: string
  }
  projectName: string
  projectId: string
}

export function RecentActivityPanel({ userId }: { userId: string }) {
  const [activity, setActivity] = useState<Activity[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    loadActivity()
  }, [userId])

  const loadActivity = async () => {
    try {
      const response = await fetch(
        `${process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4100'}/api/users/me/recent-activity?userId=${userId}&limit=20`
      )

      if (response.ok) {
        const data = await response.json()
        setActivity(data.activity || [])
      }
    } catch (error) {
      console.error('Failed to load recent activity:', error)
    } finally {
      setLoading(false)
    }
  }

  const getEntityTitle = (entity: any) => {
    return entity.entityData?.title || entity.entityData?.name || `${entity.collectionName} #${entity.id.slice(0, 8)}`
  }

  const getEntityType = (collectionName: string) => {
    // Capitalize and make singular
    const singular = collectionName.endsWith('s') ? collectionName.slice(0, -1) : collectionName
    return singular.charAt(0).toUpperCase() + singular.slice(1)
  }

  if (loading) {
    return (
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-6">
        <h2 className="text-lg font-bold text-gray-900 dark:text-gray-100 mb-4">Recent Activity</h2>
        <div className="space-y-3">
          {[1, 2, 3].map((i) => (
            <div key={i} className="animate-pulse">
              <div className="h-4 bg-gray-200 dark:bg-gray-700 rounded w-3/4 mb-2"></div>
              <div className="h-3 bg-gray-200 dark:bg-gray-700 rounded w-1/2"></div>
            </div>
          ))}
        </div>
      </div>
    )
  }

  return (
    <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-6 sticky top-4">
      <h2 className="text-lg font-bold text-gray-900 dark:text-gray-100 mb-4">Recent Activity</h2>

      {activity.length === 0 ? (
        <p className="text-sm text-gray-500 dark:text-gray-400">No recent activity</p>
      ) : (
        <div className="space-y-4">
          {activity.map((item) => (
            <Link
              key={item.entity.id}
              href={`/projects/${item.projectId}`}
              className="block group"
            >
              <div className="text-sm">
                <div className="font-medium text-gray-900 dark:text-gray-100 group-hover:text-blue-600 dark:group-hover:text-blue-400 transition-colors line-clamp-1">
                  {getEntityTitle(item.entity)}
                </div>
                <div className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                  {getEntityType(item.entity.collectionName)} in {item.projectName}
                </div>
                <div className="text-xs text-gray-400 dark:text-gray-500 mt-1">
                  {formatDistanceToNow(new Date(item.entity.lastEditedAt), { addSuffix: true })}
                </div>
              </div>
            </Link>
          ))}
        </div>
      )}

      <div className="mt-6 pt-4 border-t border-gray-200 dark:border-gray-700">
        <Link
          href="/activity"
          className="text-sm text-blue-600 dark:text-blue-400 hover:text-blue-700 dark:hover:text-blue-300 font-medium"
        >
          View all activity →
        </Link>
      </div>
    </div>
  )
}
