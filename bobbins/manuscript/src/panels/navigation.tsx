import { useState, useEffect, useMemo } from 'react'
import { BobbinrySDK } from '@bobbinry/sdk'

interface NavigationPanelProps {
  context?: {
    projectId?: string
    currentProject?: string
    currentView?: string
  }
}

interface TreeNode {
  id: string
  title: string
  nodeType: 'container' | 'content'
  type: string
  icon?: string
  children?: TreeNode[]
  parentId?: string | null
}

/**
 * Navigation Panel for Manuscript bobbin
 * Displays hierarchical tree of containers and content with drag/drop support
 */
export default function NavigationPanel({ context }: NavigationPanelProps) {
  const [tree, setTree] = useState<TreeNode[]>([])
  const [loading, setLoading] = useState(true)
  const [expandedNodes, setExpandedNodes] = useState<Set<string>>(new Set())
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null)
  const [showDropdown, setShowDropdown] = useState(false)
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; nodeId: string; nodeType: 'container' | 'content' } | null>(null)
  const [editingNodeId, setEditingNodeId] = useState<string | null>(null)
  const [editingValue, setEditingValue] = useState('')
  const [draggedNode, setDraggedNode] = useState<{ id: string; nodeType: 'container' | 'content' } | null>(null)
  const [dragOverNode, setDragOverNode] = useState<string | null>(null)

  const [sdk] = useState(() => new BobbinrySDK('manuscript'))
  const projectId = useMemo(() => context?.projectId || context?.currentProject, [context?.projectId, context?.currentProject])

  const [isLoadingRef] = useState({ current: false })

  useEffect(() => {
    if (projectId) {
      sdk.setProject(projectId)
      
      if (!isLoadingRef.current) {
        isLoadingRef.current = true
        loadTree().finally(() => {
          isLoadingRef.current = false
        })
      }
    } else {
      setLoading(false)
      setTree([])
    }
  }, [projectId])

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      const target = e.target as HTMLElement
      if (!target.closest('.dropdown-container')) {
        setShowDropdown(false)
      }
      if (!target.closest('.context-menu')) {
        setContextMenu(null)
      }
    }

    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  async function loadTree() {
    if (!sdk) return

    try {
      setLoading(true)

      const [allContainers, allContent] = await Promise.all([
        sdk.entities.query({ collection: 'containers', limit: 1000 }),
        sdk.entities.query({ collection: 'content', limit: 1000 })
      ])

      const containerMap = new Map<string, any>()
      const childrenMap = new Map<string, any[]>()
      const contentByContainer = new Map<string, any[]>()

      for (const container of allContainers.data as any[]) {
        containerMap.set(container.id, container)
        childrenMap.set(container.id, [])
      }

      for (const container of allContainers.data as any[]) {
        const parentId = container.parent_id || container.parentId || 'ROOT'
        if (!childrenMap.has(parentId)) {
          childrenMap.set(parentId, [])
        }
        childrenMap.get(parentId)!.push(container)
      }

      for (const content of allContent.data as any[]) {
        const containerId = content.containerId || content.container_id
        if (!contentByContainer.has(containerId)) {
          contentByContainer.set(containerId, [])
        }
        contentByContainer.get(containerId)!.push(content)
      }

      function buildNode(container: any): TreeNode {
        const node: TreeNode = {
          id: container.id,
          title: container.title || 'Untitled',
          nodeType: 'container',
          type: container.type || 'folder',
          icon: container.icon,
          children: [],
          parentId: container.parent_id
        }

        const childContainers = childrenMap.get(container.id) || []
        for (const child of childContainers) {
          node.children!.push(buildNode(child))
        }

        const contentItems = contentByContainer.get(container.id) || []
        for (const content of contentItems) {
          node.children!.push({
            id: content.id,
            title: content.title || 'Untitled',
            nodeType: 'content',
            type: content.type || 'scene',
            parentId: container.id
          })
        }

        return node
      }

      const rootContainers = childrenMap.get('ROOT') || []
      const treeData = rootContainers.map(buildNode)

      setTree(treeData)

      const allNodeIds = new Set<string>()
      const collectIds = (nodes: TreeNode[]) => {
        nodes.forEach(node => {
          allNodeIds.add(node.id)
          if (node.children) collectIds(node.children)
        })
      }
      collectIds(treeData)
      setExpandedNodes(allNodeIds)
    } catch (error) {
      console.error('[NavigationPanel] Failed to load tree:', error)
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

  function handleNodeClick(node: TreeNode) {
    setSelectedNodeId(node.id)

    if (typeof window !== 'undefined') {
      window.dispatchEvent(
        new CustomEvent('bobbinry:navigate', {
          detail: {
            entityType: node.nodeType === 'container' ? 'container' : 'content',
            entityId: node.id,
            bobbinId: 'manuscript',
            metadata: {
              type: node.type,
              parentId: node.parentId
            }
          }
        })
      )
    }
  }

  async function createContainer(parentId: string | null = null) {
    try {
      const newContainer = await sdk.entities.create('containers', {
        title: 'New Container',
        type: 'folder',
        parent_id: parentId,
        order: Date.now(),
        icon: '📁',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      }) as any

      await loadTree()

      if (parentId) {
        setExpandedNodes(prev => new Set(prev).add(parentId))
      }

      setSelectedNodeId(newContainer.id)
      setEditingNodeId(newContainer.id)
      setEditingValue('New Container')
    } catch (error) {
      console.error('Failed to create container:', error)
      alert('Failed to create container: ' + (error instanceof Error ? error.message : 'Unknown error'))
    }
  }

  async function createContent(containerId: string) {
    try {
      const newContent = await sdk.entities.create('content', {
        title: 'New Content',
        type: 'scene',
        container_id: containerId,
        order: Date.now(),
        word_count: 0,
        status: 'draft',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      }) as any

      await loadTree()
      setExpandedNodes(prev => new Set(prev).add(containerId))

      setSelectedNodeId(newContent.id)
      setEditingNodeId(newContent.id)
      setEditingValue('New Content')
    } catch (error) {
      console.error('Failed to create content:', error)
      alert('Failed to create content: ' + (error instanceof Error ? error.message : 'Unknown error'))
    }
  }

  async function handleRename(nodeId: string, nodeType: 'container' | 'content', newTitle: string) {
    if (!newTitle.trim()) {
      setEditingNodeId(null)
      return
    }

    try {
      const collection = nodeType === 'container' ? 'containers' : 'content'
      
      await sdk.entities.update(collection, nodeId, { 
        title: newTitle.trim(), 
        updated_at: new Date().toISOString() 
      })
      await loadTree()
      setEditingNodeId(null)
    } catch (error) {
      console.error('Failed to rename:', error)
      alert('Failed to rename: ' + (error instanceof Error ? error.message : 'Unknown error'))
    }
  }

  async function handleDelete(nodeId: string, nodeType: 'container' | 'content') {
    const collection = nodeType === 'container' ? 'containers' : 'content'
    const itemType = nodeType === 'container' ? 'container' : 'content item'
    
    if (!confirm(`Are you sure you want to delete this ${itemType}? This cannot be undone.`)) {
      return
    }

    try {
      // Server now handles cascade delete for containers
      await sdk.entities.delete(collection, nodeId)
      
      await loadTree()
      setContextMenu(null)
      
      if (selectedNodeId === nodeId) {
        setSelectedNodeId(null)
      }
    } catch (error) {
      console.error('Failed to delete:', error)
      alert('Failed to delete: ' + (error instanceof Error ? error.message : 'Unknown error'))
    }
  }

  async function handleDrop(draggedId: string, draggedType: 'container' | 'content', targetId: string | null) {
    try {
      const collection = draggedType === 'container' ? 'containers' : 'content'
      
      if (draggedType === 'container') {
        await sdk.entities.update(collection, draggedId, {
          parent_id: targetId,
          updated_at: new Date().toISOString()
        })
      } else {
        if (!targetId) {
          alert('Content must be placed inside a container')
          return
        }
        
        await sdk.entities.update(collection, draggedId, {
          container_id: targetId,
          updated_at: new Date().toISOString()
        })
      }
      
      await loadTree()
      
      if (targetId) {
        setExpandedNodes(prev => new Set(prev).add(targetId))
      }
    } catch (error) {
      console.error('Failed to move item:', error)
      alert('Failed to move item: ' + (error instanceof Error ? error.message : 'Unknown error'))
    }
  }

  function handleDragStart(e: React.DragEvent, nodeId: string, nodeType: 'container' | 'content') {
    e.stopPropagation()
    setDraggedNode({ id: nodeId, nodeType })
    e.dataTransfer.effectAllowed = 'move'
  }

  function handleDragOver(e: React.DragEvent, nodeId: string, isContainer: boolean) {
    e.preventDefault()
    e.stopPropagation()
    
    if (isContainer) {
      setDragOverNode(nodeId)
      e.dataTransfer.dropEffect = 'move'
    }
  }

  function handleDragLeave(e: React.DragEvent) {
    e.preventDefault()
    e.stopPropagation()
    setDragOverNode(null)
  }

  function handleDropOnNode(e: React.DragEvent, targetId: string, targetIsContainer: boolean) {
    e.preventDefault()
    e.stopPropagation()
    
    if (!draggedNode) return
    
    if (draggedNode.id === targetId) {
      setDraggedNode(null)
      setDragOverNode(null)
      return
    }
    
    if (targetIsContainer) {
      handleDrop(draggedNode.id, draggedNode.nodeType, targetId)
    }
    
    setDraggedNode(null)
    setDragOverNode(null)
  }

  function handleDropOnRoot(e: React.DragEvent) {
    e.preventDefault()
    e.stopPropagation()
    
    if (!draggedNode) return
    
    if (draggedNode.nodeType === 'content') {
      alert('Content must be placed inside a container')
      setDraggedNode(null)
      setDragOverNode(null)
      return
    }
    
    handleDrop(draggedNode.id, draggedNode.nodeType, null)
    setDraggedNode(null)
    setDragOverNode(null)
  }

  function handleContextMenu(e: React.MouseEvent, nodeId: string, nodeType: 'container' | 'content') {
    e.preventDefault()
    e.stopPropagation()
    setContextMenu({ x: e.clientX, y: e.clientY, nodeId, nodeType })
  }

  function renderNode(node: TreeNode, depth: number = 0): JSX.Element {
    const isExpanded = expandedNodes.has(node.id)
    const hasChildren = node.children && node.children.length > 0
    const isSelected = selectedNodeId === node.id
    const isContainer = node.nodeType === 'container'
    const isEditing = editingNodeId === node.id
    const isDragOver = dragOverNode === node.id && isContainer
    const isDragging = draggedNode?.id === node.id

    const icon = node.icon || (isContainer ? '📁' : '📝')

    return (
      <div key={node.id}>
        <div
          draggable={!isEditing}
          onDragStart={(e) => handleDragStart(e, node.id, node.nodeType)}
          onDragOver={(e) => handleDragOver(e, node.id, isContainer)}
          onDragLeave={handleDragLeave}
          onDrop={(e) => handleDropOnNode(e, node.id, isContainer)}
          className={`pr-2 py-1 cursor-pointer hover:bg-gray-700 text-sm flex items-center gap-1.5 ${isSelected ? 'bg-gray-700' : ''} ${isDragOver ? 'bg-blue-600' : ''} ${isDragging ? 'opacity-50' : ''}`}
          style={{ paddingLeft: `${depth * 16 + 8}px` }}
          onContextMenu={(e) => handleContextMenu(e, node.id, node.nodeType)}
        >
          {hasChildren && (
            <span 
              className="text-gray-400 text-xs w-3 flex-shrink-0 hover:text-gray-200"
              onClick={(e) => {
                e.stopPropagation()
                toggleNode(node.id)
              }}
            >
              {isExpanded ? '▼' : '▶'}
            </span>
          )}
          {!hasChildren && <span className="w-3 flex-shrink-0"></span>}
          
          <span 
            className="flex-shrink-0"
            onClick={(e) => {
              e.stopPropagation()
              if (!isEditing) handleNodeClick(node)
            }}
          >
            {icon}
          </span>
          
          {isEditing ? (
            <input
              type="text"
              value={editingValue}
              onChange={(e) => setEditingValue(e.target.value)}
              onBlur={() => handleRename(node.id, node.nodeType, editingValue)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  handleRename(node.id, node.nodeType, editingValue)
                } else if (e.key === 'Escape') {
                  setEditingNodeId(null)
                }
              }}
              autoFocus
              onFocus={(e) => e.target.select()}
              className="flex-1 px-1 py-0.5 bg-gray-800 border border-gray-600 rounded text-gray-100"
              onClick={(e) => e.stopPropagation()}
            />
          ) : (
            <span 
              className="flex-1 text-gray-200 truncate"
              onClick={(e) => {
                e.stopPropagation()
                if (!isEditing) handleNodeClick(node)
              }}
            >
              {node.title}
            </span>
          )}
        </div>

        {hasChildren && isExpanded && (
          <>
            {node.children!.map(child => renderNode(child, depth + 1))}
          </>
        )}
      </div>
    )
  }

  if (loading) {
    return (
      <div className="p-4 text-center text-sm text-gray-500 dark:text-gray-400">
        <div className="animate-pulse">Loading...</div>
      </div>
    )
  }

  if (!projectId) {
    return (
      <div className="p-4 text-center text-sm text-gray-500 dark:text-gray-400">
        No project selected
      </div>
    )
  }

  return (
    <div className="h-full flex flex-col bg-gray-800">
      <div className="px-3 py-2 border-b border-gray-700 flex justify-between items-center">
        <div className="flex items-center gap-2">
          <h3 className="text-sm font-semibold text-gray-200">📝 Manuscript</h3>
          <div className="relative dropdown-container">
            <button
              onClick={() => setShowDropdown(!showDropdown)}
              className="text-lg leading-none text-gray-400 hover:text-gray-200 w-6 h-6 flex items-center justify-center"
              title="Create new item"
            >
              +
            </button>
            {showDropdown && (
              <div className="absolute left-0 top-full mt-1 bg-gray-700 border border-gray-600 rounded shadow-lg z-10 min-w-[150px]">
                <button
                  onClick={() => {
                    createContainer(null)
                    setShowDropdown(false)
                  }}
                  className="w-full text-left px-3 py-2 text-sm hover:bg-gray-600 text-gray-100"
                >
                  📁 Create Container
                </button>
                {tree.length > 0 && tree[0] && (
                  <button
                    onClick={() => {
                      createContent(tree[0]!.id)
                      setShowDropdown(false)
                    }}
                    className="w-full text-left px-3 py-2 text-sm hover:bg-gray-600 text-gray-100 border-t border-gray-600"
                  >
                    📝 Create Content
                  </button>
                )}
              </div>
            )}
          </div>
        </div>
        <button
          onClick={loadTree}
          className="text-xs text-gray-400 hover:text-gray-200"
          title="Refresh"
        >
          ↻
        </button>
      </div>

      <div 
        className="flex-1 overflow-y-auto"
        onDragOver={(e) => {
          e.preventDefault()
          e.dataTransfer.dropEffect = 'move'
        }}
        onDrop={handleDropOnRoot}
      >
        {tree.length === 0 ? (
          <div className="p-4 text-center text-sm text-gray-400">
            <div className="mb-3">No content yet</div>
            <button
              onClick={() => createContainer(null)}
              className="px-3 py-1.5 text-xs bg-gray-700 hover:bg-gray-600 text-gray-200 rounded"
            >
              Create Your First Container
            </button>
          </div>
        ) : (
          tree.map(node => renderNode(node))
        )}
      </div>

      {contextMenu && (() => {
        const menuNodeId = contextMenu.nodeId
        const menuNodeType = contextMenu.nodeType
        const isContainer = menuNodeType === 'container'
        
        return (
          <div
            className="fixed bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded shadow-lg z-50 min-w-[150px] context-menu"
            style={{ left: contextMenu.x, top: contextMenu.y }}
          >
            {isContainer && (
              <>
                <button
                  onClick={() => {
                    createContainer(menuNodeId)
                    setContextMenu(null)
                  }}
                  className="w-full text-left px-3 py-2 text-sm hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-900 dark:text-gray-100"
                >
                  📁 Add Container
                </button>
                <button
                  onClick={() => {
                    createContent(menuNodeId)
                    setContextMenu(null)
                  }}
                  className="w-full text-left px-3 py-2 text-sm hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-900 dark:text-gray-100 border-t border-gray-200 dark:border-gray-700"
                >
                  📝 Add Content
                </button>
                <div className="border-t border-gray-200 dark:border-gray-700"></div>
              </>
            )}
            <button
              onClick={() => {
                setEditingNodeId(menuNodeId)
                const findNode = (nodes: TreeNode[]): TreeNode | null => {
                  for (const node of nodes) {
                    if (node.id === menuNodeId) return node
                    if (node.children) {
                      const found = findNode(node.children)
                      if (found) return found
                    }
                  }
                  return null
                }
                const node = findNode(tree)
                if (node) {
                  setEditingValue(node.title)
                }
                setContextMenu(null)
              }}
              className="w-full text-left px-3 py-2 text-sm hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-900 dark:text-gray-100"
            >
              ✏️ Rename
            </button>
            <button
              onClick={() => handleDelete(menuNodeId, menuNodeType)}
              className="w-full text-left px-3 py-2 text-sm hover:bg-gray-100 dark:hover:bg-gray-700 text-red-600 dark:text-red-400 border-t border-gray-200 dark:border-gray-700"
            >
              🗑️ Delete
            </button>
          </div>
        )
      })()}
    </div>
  )
}
