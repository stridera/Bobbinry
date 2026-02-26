import { useState, useEffect, useMemo, useRef } from 'react'
import { BobbinrySDK } from '@bobbinry/sdk'

interface NavigationPanelProps {
  context?: {
    projectId?: string
    currentProject?: string
    currentView?: string
    apiToken?: string
  }
}

interface TreeNode {
  id: string
  title: string
  nodeType: 'container' | 'content'
  type: string
  icon?: string
  order: number
  children?: TreeNode[]
  parentId?: string | null
}

interface DropTarget {
  nodeId: string
  position: 'before' | 'after' | 'inside'
}

/**
 * Navigation Panel for Manuscript bobbin
 * Displays hierarchical tree of containers and content with drag/drop reorder
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
  const [dropTarget, setDropTarget] = useState<DropTarget | null>(null)

  // Map nodeId → parentId for quick lookup during drag operations
  const nodeParentMap = useRef(new Map<string, string | null>())

  const [sdk] = useState(() => new BobbinrySDK('manuscript'))
  const projectId = useMemo(() => context?.projectId || context?.currentProject, [context?.projectId, context?.currentProject])

  const [isLoadingRef] = useState({ current: false })

  // Set auth token on SDK when available from context
  useEffect(() => {
    if (context?.apiToken) {
      sdk.api.setAuthToken(context.apiToken)
    }
  }, [context?.apiToken, sdk])

  useEffect(() => {
    if (projectId && context?.apiToken) {
      sdk.setProject(projectId)

      if (!isLoadingRef.current) {
        isLoadingRef.current = true
        loadTree().finally(() => {
          isLoadingRef.current = false
        })
      }
    } else if (!projectId) {
      setLoading(false)
      setTree([])
    }
  }, [projectId, context?.apiToken])

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

  // Listen for entity updates (e.g. title changes from the editor)
  useEffect(() => {
    function handleEntityUpdated(e: Event) {
      const detail = (e as CustomEvent).detail
      if (!detail?.entityId || !detail?.changes?.title) return

      setTree(prev => {
        const updateNode = (nodes: TreeNode[]): TreeNode[] =>
          nodes.map(node => {
            if (node.id === detail.entityId) {
              return { ...node, title: detail.changes.title }
            }
            if (node.children) {
              return { ...node, children: updateNode(node.children) }
            }
            return node
          })
        return updateNode(prev)
      })
    }

    window.addEventListener('bobbinry:entity-updated', handleEntityUpdated)
    return () => window.removeEventListener('bobbinry:entity-updated', handleEntityUpdated)
  }, [])

  // Sync sidebar highlight with the actual view the router navigated to.
  useEffect(() => {
    function handleViewContextChange(e: Event) {
      const detail = (e as CustomEvent).detail
      if (detail?.entityId) {
        setSelectedNodeId(detail.entityId)
      }
    }

    window.addEventListener('bobbinry:view-context-change', handleViewContextChange)
    return () => window.removeEventListener('bobbinry:view-context-change', handleViewContextChange)
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

      // Build parent map for drag-and-drop
      const parentMap = new Map<string, string | null>()

      function buildNode(container: any): TreeNode {
        const parentId = container.parent_id || container.parentId || null
        parentMap.set(container.id, parentId)

        const node: TreeNode = {
          id: container.id,
          title: container.title || 'Untitled',
          nodeType: 'container',
          type: container.type || 'folder',
          icon: container.icon,
          order: container.order || 0,
          children: [],
          parentId
        }

        const childContainers = (childrenMap.get(container.id) || [])
          .sort((a: any, b: any) => (a.order || 0) - (b.order || 0))
        for (const child of childContainers) {
          node.children!.push(buildNode(child))
        }

        const contentItems = (contentByContainer.get(container.id) || [])
          .sort((a: any, b: any) => (a.order || 0) - (b.order || 0))
        for (const content of contentItems) {
          parentMap.set(content.id, container.id)
          node.children!.push({
            id: content.id,
            title: content.title || 'Untitled',
            nodeType: 'content',
            type: content.type || 'scene',
            order: content.order || 0,
            parentId: container.id
          })
        }

        // Sort all children together by order
        node.children!.sort((a, b) => a.order - b.order)

        return node
      }

      const rootContainers = (childrenMap.get('ROOT') || [])
        .sort((a: any, b: any) => (a.order || 0) - (b.order || 0))
      const treeData: TreeNode[] = rootContainers.map(buildNode)

      // Include root-level content (no container_id)
      const rootContent = (allContent.data as any[])
        .filter((c: any) => !c.containerId && !c.container_id)
        .sort((a: any, b: any) => (a.order || 0) - (b.order || 0))
      for (const content of rootContent) {
        parentMap.set(content.id, null)
        treeData.push({
          id: content.id,
          title: content.title || 'Untitled',
          nodeType: 'content',
          type: content.type || 'scene',
          order: content.order || 0,
          parentId: null
        })
      }

      // Sort root level by order
      treeData.sort((a, b) => a.order - b.order)

      nodeParentMap.current = parentMap
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

  async function createContent(containerId: string | null = null) {
    try {
      const newContent = await sdk.entities.create('content', {
        title: 'New Content',
        type: 'scene',
        ...(containerId ? { container_id: containerId } : {}),
        order: Date.now(),
        word_count: 0,
        status: 'draft',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      }) as any

      await loadTree()
      if (containerId) {
        setExpandedNodes(prev => new Set(prev).add(containerId))
      }

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

  // ============================================
  // DRAG AND DROP — supports both reorder & move
  // ============================================

  function handleDragStart(e: React.DragEvent, nodeId: string, nodeType: 'container' | 'content') {
    e.stopPropagation()
    setDraggedNode({ id: nodeId, nodeType })
    e.dataTransfer.effectAllowed = 'move'
    e.dataTransfer.setData('text/plain', nodeId)
  }

  function handleDragOverNode(e: React.DragEvent, nodeId: string, isContainer: boolean) {
    e.preventDefault()
    e.stopPropagation()

    if (!draggedNode || draggedNode.id === nodeId) {
      setDropTarget(null)
      return
    }

    e.dataTransfer.dropEffect = 'move'

    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
    const y = e.clientY - rect.top
    const height = rect.height

    if (isContainer) {
      // For containers: top 25% = before, bottom 25% = after, middle = inside
      if (y < height * 0.25) {
        setDropTarget({ nodeId, position: 'before' })
      } else if (y > height * 0.75) {
        setDropTarget({ nodeId, position: 'after' })
      } else {
        setDropTarget({ nodeId, position: 'inside' })
      }
    } else {
      // For content: top half = before, bottom half = after
      if (y < height * 0.5) {
        setDropTarget({ nodeId, position: 'before' })
      } else {
        setDropTarget({ nodeId, position: 'after' })
      }
    }
  }

  function handleDragLeaveNode(e: React.DragEvent) {
    e.preventDefault()
    e.stopPropagation()
    // Only clear if leaving the actual element (not entering a child)
    const related = e.relatedTarget as HTMLElement | null
    if (!related || !e.currentTarget.contains(related)) {
      setDropTarget(null)
    }
  }

  /** Find siblings of a node by looking up its parent in the tree */
  function findSiblings(parentId: string | null): TreeNode[] {
    if (!parentId) {
      return tree // root containers
    }
    const findInTree = (nodes: TreeNode[]): TreeNode[] | null => {
      for (const node of nodes) {
        if (node.id === parentId && node.children) {
          return node.children
        }
        if (node.children) {
          const found = findInTree(node.children)
          if (found) return found
        }
      }
      return null
    }
    return findInTree(tree) || []
  }

  async function handleDropOnNode(e: React.DragEvent, targetId: string, targetIsContainer: boolean) {
    e.preventDefault()
    e.stopPropagation()

    if (!draggedNode || !dropTarget) {
      setDraggedNode(null)
      setDropTarget(null)
      return
    }

    if (draggedNode.id === targetId) {
      setDraggedNode(null)
      setDropTarget(null)
      return
    }

    const { position } = dropTarget

    try {
      if (position === 'inside' && targetIsContainer) {
        // Move into container
        const collection = draggedNode.nodeType === 'container' ? 'containers' : 'content'
        const field = draggedNode.nodeType === 'container' ? 'parent_id' : 'container_id'

        await sdk.entities.update(collection, draggedNode.id, {
          [field]: targetId,
          order: Date.now(), // place at end
          updated_at: new Date().toISOString()
        })

        await loadTree()
        setExpandedNodes(prev => new Set(prev).add(targetId))
      } else {
        // Reorder: insert before/after the target
        await performReorder(draggedNode.id, draggedNode.nodeType, targetId, position as 'before' | 'after')
      }
    } catch (error) {
      console.error('Failed to drop:', error)
      alert('Failed to move item: ' + (error instanceof Error ? error.message : 'Unknown error'))
    } finally {
      setDraggedNode(null)
      setDropTarget(null)
    }
  }

  async function performReorder(
    draggedId: string,
    draggedType: 'container' | 'content',
    targetId: string,
    position: 'before' | 'after'
  ) {
    // Find target's parent
    const targetParentId = nodeParentMap.current.get(targetId) ?? null
    const draggedParentId = nodeParentMap.current.get(draggedId) ?? null
    const sameParent = targetParentId === draggedParentId

    // Get siblings at the target location
    const siblings = findSiblings(targetParentId)
    const siblingIds = siblings.map(s => s.id)

    // Build new order: remove dragged, insert at position
    const filtered = siblingIds.filter(id => id !== draggedId)
    const targetIndex = filtered.indexOf(targetId)
    const insertAt = position === 'before' ? targetIndex : targetIndex + 1
    filtered.splice(insertAt, 0, draggedId)

    // Persist: update parent if moving across containers, then update order for all siblings
    const updates: Promise<any>[] = []

    if (!sameParent) {
      const collection = draggedType === 'container' ? 'containers' : 'content'
      const field = draggedType === 'container' ? 'parent_id' : 'container_id'
      updates.push(
        sdk.entities.update(collection, draggedId, {
          [field]: targetParentId,
          updated_at: new Date().toISOString()
        })
      )
    }

    // Update order for all items at the target level
    for (let i = 0; i < filtered.length; i++) {
      const nodeId = filtered[i]!
      // Look up the node to determine its collection
      const node = findNodeById(nodeId)
      if (!node) continue
      const collection = node.nodeType === 'container' ? 'containers' : 'content'
      updates.push(
        sdk.entities.update(collection, nodeId, {
          order: (i + 1) * 100,
          updated_at: new Date().toISOString()
        })
      )
    }

    await Promise.all(updates)
    await loadTree()

    if (targetParentId) {
      setExpandedNodes(prev => new Set(prev).add(targetParentId))
    }
  }

  function findNodeById(nodeId: string): TreeNode | null {
    const search = (nodes: TreeNode[]): TreeNode | null => {
      for (const node of nodes) {
        if (node.id === nodeId) return node
        if (node.children) {
          const found = search(node.children)
          if (found) return found
        }
      }
      return null
    }
    return search(tree)
  }

  function handleDropOnRoot(e: React.DragEvent) {
    e.preventDefault()
    e.stopPropagation()

    if (!draggedNode) return

    // Move any item to root level
    const collection = draggedNode.nodeType === 'container' ? 'containers' : 'content'
    const field = draggedNode.nodeType === 'container' ? 'parent_id' : 'container_id'
    sdk.entities.update(collection, draggedNode.id, {
      [field]: null,
      order: Date.now(),
      updated_at: new Date().toISOString()
    }).then(() => loadTree()).catch(error => {
      console.error('Failed to move to root:', error)
    })

    setDraggedNode(null)
    setDropTarget(null)
  }

  function handleDragEnd() {
    setDraggedNode(null)
    setDropTarget(null)
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
    const isDragging = draggedNode?.id === node.id

    const isDropBefore = dropTarget?.nodeId === node.id && dropTarget.position === 'before'
    const isDropAfter = dropTarget?.nodeId === node.id && dropTarget.position === 'after'
    const isDropInside = dropTarget?.nodeId === node.id && dropTarget.position === 'inside'

    const icon = node.icon || (isContainer ? '📁' : '📝')

    return (
      <div key={node.id}>
        {/* Drop indicator line — before */}
        {isDropBefore && (
          <div
            className="h-0.5 bg-blue-400 mx-2 rounded-full"
            style={{ marginLeft: `${depth * 16 + 8}px` }}
          />
        )}

        <div
          draggable={!isEditing}
          onDragStart={(e) => handleDragStart(e, node.id, node.nodeType)}
          onDragOver={(e) => handleDragOverNode(e, node.id, isContainer)}
          onDragLeave={handleDragLeaveNode}
          onDrop={(e) => handleDropOnNode(e, node.id, isContainer)}
          onDragEnd={handleDragEnd}
          className={`pr-2 py-1 cursor-pointer hover:bg-gray-700 text-sm flex items-center gap-1.5 ${isSelected ? 'bg-gray-700' : ''} ${isDropInside ? 'bg-blue-600' : ''} ${isDragging ? 'opacity-40' : ''}`}
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

        {/* Drop indicator line — after (only when no expanded children) */}
        {isDropAfter && (!hasChildren || !isExpanded) && (
          <div
            className="h-0.5 bg-blue-400 mx-2 rounded-full"
            style={{ marginLeft: `${depth * 16 + 8}px` }}
          />
        )}

        {hasChildren && isExpanded && (
          <>
            {node.children!.map(child => renderNode(child, depth + 1))}
            {/* Drop indicator after last child */}
            {isDropAfter && (
              <div
                className="h-0.5 bg-blue-400 mx-2 rounded-full"
                style={{ marginLeft: `${(depth + 1) * 16 + 8}px` }}
              />
            )}
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
                <button
                  onClick={() => {
                    createContent(null)
                    setShowDropdown(false)
                  }}
                  className="w-full text-left px-3 py-2 text-sm hover:bg-gray-600 text-gray-100 border-t border-gray-600"
                >
                  📝 Create Content
                </button>
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
