import { useState, useEffect } from 'react'
import { BobbinrySDK } from '@bobbinry/sdk'

interface NavigationPanelProps {
  context?: {
    projectId?: string
    currentProject?: string
    currentView?: string
  }
}

interface OutlineNode {
  id: string
  title: string
  type: 'book' | 'chapter' | 'scene'
  children?: OutlineNode[]
  wordCount?: number
  chapterId?: string
}

/**
 * Navigation Panel for Manuscript bobbin
 * Displays hierarchical tree in the shell's left panel
 * Allows navigation to scenes in the editor
 */
export default function NavigationPanel({ context }: NavigationPanelProps) {
  const [outline, setOutline] = useState<OutlineNode[]>([])
  const [loading, setLoading] = useState(true)
  const [expandedNodes, setExpandedNodes] = useState<Set<string>>(new Set())
  const [selectedSceneId, setSelectedSceneId] = useState<string | null>(null)
  
  // Create SDK instance for the panel
  const [sdk] = useState(() => new BobbinrySDK('manuscript'))
  
  // Get projectId from context
  const projectId = context?.projectId || context?.currentProject
  
  console.log('[NavigationPanel] Render - projectId:', projectId, 'loading:', loading, 'context:', context)

  useEffect(() => {
    console.log('[NavigationPanel] useEffect - projectId:', projectId)
    if (projectId) {
      sdk.setProject(projectId)
      loadOutline()
    } else {
      // No project selected, stop loading
      setLoading(false)
      setOutline([])
    }
  }, [projectId, sdk])

  async function loadOutline() {
    if (!sdk) {
      console.log('[NavigationPanel] loadOutline - SDK not available')
      return
    }

    console.log('[NavigationPanel] loadOutline - Starting to load outline')

    try {
      setLoading(true)

      // Fetch books
      const books = await sdk.entities.query({
        collection: 'books',
        sort: [{ field: 'created_at', direction: 'asc' }]
      })

      const outlineData: OutlineNode[] = []

      for (const book of books.data as any[]) {
        const bookNode: OutlineNode = {
          id: book.id,
          title: book.title || 'Untitled Book',
          type: 'book',
          children: []
        }

        // Fetch chapters for this book
        const chapters = await sdk.entities.query({
          collection: 'chapters',
          filters: { book_id: book.id },
          sort: [{ field: 'order', direction: 'asc' }]
        })

        for (const chapter of chapters.data as any[]) {
          const chapterNode: OutlineNode = {
            id: chapter.id,
            title: chapter.title || 'Untitled Chapter',
            type: 'chapter',
            children: []
          }

          // Fetch scenes for this chapter
          const scenes = await sdk.entities.query({
            collection: 'scenes',
            filters: { chapter_id: chapter.id },
            sort: [{ field: 'order', direction: 'asc' }]
          })

          for (const scene of scenes.data as any[]) {
            chapterNode.children!.push({
              id: scene.id,
              title: scene.title || 'Untitled Scene',
              type: 'scene',
              wordCount: scene.word_count,
              chapterId: chapter.id
            })
          }

          bookNode.children!.push(chapterNode)
        }

        outlineData.push(bookNode)
      }

      setOutline(outlineData)

      // Auto-expand all nodes on first load
      const allNodeIds = new Set<string>()
      const collectIds = (nodes: OutlineNode[]) => {
        nodes.forEach(node => {
          allNodeIds.add(node.id)
          if (node.children) collectIds(node.children)
        })
      }
      collectIds(outlineData)
      setExpandedNodes(allNodeIds)
    } catch (error) {
      console.error('[NavigationPanel] Failed to load outline:', error)
    } finally {
      setLoading(false)
    }
  }

  function toggleNode(nodeId: string) {
    setExpandedNodes(prev => {
      const next = new Set(prev)
      if (next.has(nodeId)) {
        next.delete(nodeId)
      } else {
        next.add(nodeId)
      }
      return next
    })
  }

  function handleSceneClick(sceneId: string, chapterId: string) {
    setSelectedSceneId(sceneId)

    // Emit new universal navigation event
    if (typeof window !== 'undefined') {
      window.dispatchEvent(
        new CustomEvent('bobbinry:navigate', {
          detail: {
            entityType: 'scene',
            entityId: sceneId,
            bobbinId: 'manuscript',
            metadata: {
              chapterId
            }
          }
        })
      )

      // Keep old event for backward compatibility during transition
      window.dispatchEvent(
        new CustomEvent('manuscript:navigate-to-scene', {
          detail: { sceneId }
        })
      )
    }
  }

  function renderNode(node: OutlineNode, depth: number = 0): JSX.Element {
    const isExpanded = expandedNodes.has(node.id)
    const hasChildren = node.children && node.children.length > 0
    const isSelected = node.type === 'scene' && selectedSceneId === node.id

    return (
      <div key={node.id}>
        <div
          className={`
            flex items-center gap-1 px-2 py-1.5 text-sm cursor-pointer
            hover:bg-gray-100 rounded
            ${isSelected ? 'bg-blue-50 text-blue-700' : 'text-gray-700'}
          `}
          style={{ paddingLeft: `${depth * 12 + 8}px` }}
          onClick={() => {
            if (node.type === 'scene') {
              handleSceneClick(node.id, node.chapterId!)
            } else if (node.type === 'chapter') {
              // Emit chapter navigation event
              if (typeof window !== 'undefined') {
                window.dispatchEvent(
                  new CustomEvent('bobbinry:navigate', {
                    detail: {
                      entityType: 'chapter',
                      entityId: node.id,
                      bobbinId: 'manuscript'
                    }
                  })
                )
              }
              toggleNode(node.id)
            } else if (node.type === 'book') {
              // Emit book navigation event
              if (typeof window !== 'undefined') {
                window.dispatchEvent(
                  new CustomEvent('bobbinry:navigate', {
                    detail: {
                      entityType: 'book',
                      entityId: node.id,
                      bobbinId: 'manuscript'
                    }
                  })
                )
              }
              toggleNode(node.id)
            } else if (hasChildren) {
              toggleNode(node.id)
            }
          }}
        >
          {hasChildren && (
            <span className="w-4 text-gray-400 flex-shrink-0">
              {isExpanded ? '▼' : '▶'}
            </span>
          )}
          {!hasChildren && <span className="w-4" />}

          <span className="flex-shrink-0">
            {node.type === 'book' && '📚'}
            {node.type === 'chapter' && '📑'}
            {node.type === 'scene' && '📝'}
          </span>

          <span className="flex-1 truncate" title={node.title}>
            {node.title}
          </span>

          {node.type === 'scene' && node.wordCount !== undefined && (
            <span className="text-xs text-gray-500 flex-shrink-0">
              {node.wordCount}
            </span>
          )}
        </div>

        {hasChildren && isExpanded && (
          <div>
            {node.children!.map(child => renderNode(child, depth + 1))}
          </div>
        )}
      </div>
    )
  }

  if (loading) {
    return (
      <div className="p-4 text-center text-sm text-gray-500">
        <div className="animate-pulse">Loading...</div>
      </div>
    )
  }

  if (!projectId) {
    return (
      <div className="p-4 text-center text-sm text-gray-500">
        No project selected
      </div>
    )
  }

  if (outline.length === 0) {
    return (
      <div className="p-4 text-center text-sm text-gray-500">
        <div className="mb-2">No content yet</div>
        <div className="text-xs">Create a book in the Outline view</div>
      </div>
    )
  }

  return (
    <div className="h-full flex flex-col bg-white">
      <div className="p-3 border-b border-gray-200 flex justify-between items-center">
        <h3 className="text-sm font-semibold text-gray-700">Manuscript</h3>
        <button
          onClick={loadOutline}
          className="text-xs text-gray-500 hover:text-gray-700"
          title="Refresh"
        >
          ↻
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-2">
        {outline.map(node => renderNode(node))}
      </div>
    </div>
  )
}
