import { useState, useEffect } from 'react'
import type { BobbinrySDK } from '@bobbinry/sdk'

interface OutlineViewProps {
  projectId: string
  bobbinId: string
  viewId: string
  sdk: BobbinrySDK
  entityId?: string
}

/**
 * Outline View for Manuscript bobbin
 * Displays container hierarchy
 */
export default function OutlineView({ projectId, bobbinId, sdk, entityId }: OutlineViewProps) {
  const [container, setContainer] = useState<any>(null)
  const [children, setChildren] = useState<any[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!entityId) {
      setLoading(false)
      return
    }

    loadContainerData()
  }, [entityId, projectId])

  async function loadContainerData() {
    if (!sdk || !entityId) return

    try {
      setLoading(true)

      // Load the container details
      const containerData = await sdk.entities.get('containers', entityId)
      setContainer(containerData)

      // Load all child containers
      const childContainers = await sdk.entities.query({
        collection: 'containers',
        filter: { parent_id: entityId },
        sort: [{ field: 'order', direction: 'asc' }],
        limit: 1000
      })

      // Load all content items in this container
      const contentItems = await sdk.entities.query({
        collection: 'content',
        filter: { container_id: entityId },
        sort: [{ field: 'order', direction: 'asc' }],
        limit: 1000
      })

      // Combine and sort by order
      const allChildren = [
        ...(childContainers.data || []).map((c: any) => ({ ...c, _type: 'container' })),
        ...(contentItems.data || []).map((c: any) => ({ ...c, _type: 'content' }))
      ].sort((a, b) => (a.order || 0) - (b.order || 0))

      setChildren(allChildren)
    } catch (error) {
      console.error('[OutlineView] Failed to load container:', error)
    } finally {
      setLoading(false)
    }
  }

  function handleItemClick(item: any) {
    if (typeof window !== 'undefined') {
      window.dispatchEvent(
        new CustomEvent('bobbinry:navigate', {
          detail: {
            entityType: item._type,
            entityId: item.id,
            bobbinId: 'manuscript',
            metadata: {
              type: item.type,
              parentId: item._type === 'container' ? item.parent_id : item.container_id
            }
          }
        })
      )
    }
  }

  if (loading) {
    return (
      <div className="p-8 text-center">
        <div className="text-gray-500 dark:text-gray-400">Loading...</div>
      </div>
    )
  }

  if (!entityId || !container) {
    return (
      <div className="p-8 text-center">
        <div className="text-gray-500 dark:text-gray-400">
          <p className="mb-4">Select a folder from the navigation panel to view its contents.</p>
        </div>
      </div>
    )
  }

  return (
    <div className="h-full flex flex-col bg-white dark:bg-gray-900">
      {/* Header */}
      <div className="px-6 py-4 border-b border-gray-200 dark:border-gray-700">
        <div className="flex items-center gap-3">
          <span className="text-2xl">{container.icon || '📁'}</span>
          <div>
            <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">
              {container.title}
            </h1>
            <p className="text-sm text-gray-500 dark:text-gray-400">
              {children.length} {children.length === 1 ? 'item' : 'items'}
            </p>
          </div>
        </div>
      </div>

      {/* Content List */}
      <div className="flex-1 overflow-y-auto p-6">
        {children.length === 0 ? (
          <div className="text-center py-12 text-gray-500 dark:text-gray-400">
            <p>This folder is empty.</p>
            <p className="text-sm mt-2">Use the navigation panel to add items.</p>
          </div>
        ) : (
          <div className="space-y-2">
            {children.map((item) => (
              <div
                key={item.id}
                onClick={() => handleItemClick(item)}
                className="p-4 border border-gray-200 dark:border-gray-700 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-800 cursor-pointer transition-colors"
              >
                <div className="flex items-center gap-3">
                  <span className="text-xl">
                    {item._type === 'container' 
                      ? (item.icon || '📁') 
                      : '📝'}
                  </span>
                  <div className="flex-1">
                    <h3 className="font-medium text-gray-900 dark:text-gray-100">
                      {item.title}
                    </h3>
                    <div className="flex gap-3 mt-1 text-xs text-gray-500 dark:text-gray-400">
                      <span className="capitalize">{item.type}</span>
                      {item._type === 'content' && item.word_count > 0 && (
                        <>
                          <span>•</span>
                          <span>{item.word_count} words</span>
                        </>
                      )}
                      {item._type === 'content' && item.status && (
                        <>
                          <span>•</span>
                          <span className="capitalize">{item.status}</span>
                        </>
                      )}
                    </div>
                  </div>
                  <span className="text-gray-400 dark:text-gray-500">→</span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
