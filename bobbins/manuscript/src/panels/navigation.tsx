import { useState, useEffect, useMemo, useRef, useCallback } from 'react'
import { BobbinrySDK, PanelActions, fuzzyMatch } from '@bobbinry/sdk'
import {
  Toast,
  ToastContainer,
  Dialog,
  PALETTE_TOKENS,
  paletteClasses,
  isPaletteToken,
} from '@bobbinry/ui-components'
import {
  resolveChapterColor,
  resolveFeaturedCharacters,
  characterInitial,
  type CharactersById,
  type CharacterColorRef,
} from '../lib/chapterColors'

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
  /** Chapter-specific color fields. Only populated for content nodes. */
  pov_character_id?: string | null
  featured_character_ids?: string[]
  manual_color?: string | null
  /** Optimistic-locking version for chapter PUTs. */
  version?: number
}

interface DropTarget {
  nodeId: string
  position: 'before' | 'after' | 'inside'
}

function findNodeInTree(nodes: TreeNode[], nodeId: string): TreeNode | null {
  for (const node of nodes) {
    if (node.id === nodeId) return node
    if (node.children) {
      const found = findNodeInTree(node.children, nodeId)
      if (found) return found
    }
  }
  return null
}

/**
 * Broadcast an entity's bumped version after a server update so the editor's
 * optimistic-locking state stays in sync. Every update here (rename, reorder,
 * move, color change) bumps the entity version server-side; if the chapter is
 * open in the editor and this event isn't dispatched, the editor's cached
 * version goes stale and its next save or visibility check surfaces a phantom
 * "Editing conflict" dialog.
 */
function broadcastVersionChange(entityId: string, result: any) {
  const version = result?._meta?.version
  if (version == null || typeof window === 'undefined') return
  window.dispatchEvent(
    new CustomEvent('bobbinry:entity-version-changed', {
      detail: { entityId, version },
    })
  )
}

/**
 * Navigation Panel for Manuscript bobbin
 * Displays hierarchical tree of containers and content with drag/drop reorder
 */
export default function NavigationPanel({ context }: NavigationPanelProps) {
  const [tree, setTree] = useState<TreeNode[]>([])
  const [loading, setLoading] = useState(true)
  const [charactersById, setCharactersById] = useState<CharactersById>(() => new Map())
  const [expandedNodes, setExpandedNodes] = useState<Set<string>>(new Set())
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null)
  const [showDropdown, setShowDropdown] = useState(false)
  const [filterQuery, setFilterQuery] = useState('')

  // Flattened match list for the type-ahead filter; tree expansion state is
  // left untouched so clearing the filter restores the previous view.
  const filterMatches = useMemo(() => {
    const query = filterQuery.trim()
    if (!query) return []
    const matches: { node: TreeNode; path: string }[] = []
    const walk = (nodes: TreeNode[], ancestors: string[]) => {
      for (const node of nodes) {
        if (fuzzyMatch(query, node.title)) {
          matches.push({ node, path: ancestors.join(' › ') })
        }
        if (node.children && node.children.length > 0) {
          walk(node.children, [...ancestors, node.title])
        }
      }
    }
    walk(tree, [])
    return matches.slice(0, 100)
  }, [filterQuery, tree])
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; nodeId: string; nodeType: 'container' | 'content' } | null>(null)
  const [contextMenuView, setContextMenuView] = useState<'main' | 'pov' | 'featured' | 'color'>('main')
  const [editingNodeId, setEditingNodeId] = useState<string | null>(null)
  const [editingValue, setEditingValue] = useState('')
  const [draggedNode, setDraggedNode] = useState<{ id: string; nodeType: 'container' | 'content' } | null>(null)
  const [dropTarget, setDropTarget] = useState<DropTarget | null>(null)
  const [toast, setToast] = useState<{ message: string; variant: 'danger' } | null>(null)
  const dismissToast = useCallback(() => setToast(null), [])
  const [pendingDelete, setPendingDelete] = useState<{ nodeId: string; nodeType: 'container' | 'content' } | null>(null)

  // Track auto-selection: only auto-navigate to first item once per mount
  const hasAutoSelectedRef = useRef(false)
  const selectedNodeIdRef = useRef<string | null>(null)

  // Map nodeId → parentId for quick lookup during drag operations
  const nodeParentMap = useRef(new Map<string, string | null>())

  const treeContainerRef = useRef<HTMLDivElement>(null)

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

  // Reload navigation tree when tab becomes visible again (handles
  // chapters created/reordered on another device while this tab was
  // in the background).
  useEffect(() => {
    let lastCheck = Date.now()

    function handleVisibilityChange() {
      if (document.visibilityState !== 'visible') return
      if (!projectId || !context?.apiToken) return
      // Throttle: skip if checked less than 10 seconds ago
      const now = Date.now()
      if (now - lastCheck < 10_000) return
      lastCheck = now

      if (!isLoadingRef.current) {
        isLoadingRef.current = true
        const scrollTop = treeContainerRef.current?.scrollTop ?? 0
        loadTree().finally(() => {
          isLoadingRef.current = false
          requestAnimationFrame(() => {
            if (treeContainerRef.current) {
              treeContainerRef.current.scrollTop = scrollTop
            }
          })
        })
      }
    }

    document.addEventListener('visibilitychange', handleVisibilityChange)
    return () => document.removeEventListener('visibilitychange', handleVisibilityChange)
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

  // Listen for chapter color/POV/featured changes coming from the editor's
  // inline pill. Mirrors the local patch we do inside `patchChapter` so the
  // nav stripe and chips stay in sync without a reload.
  useEffect(() => {
    function handleChapterColorChanged(e: Event) {
      const detail = (e as CustomEvent).detail
      if (!detail?.entityId || !detail?.patch) return
      const patch = detail.patch as {
        pov_character_id?: string | null
        featured_character_ids?: string[]
        manual_color?: string | null
      }
      setTree(prev => {
        const apply = (nodes: TreeNode[]): TreeNode[] =>
          nodes.map(n => {
            if (n.id === detail.entityId) {
              const next: TreeNode = { ...n }
              if (patch.pov_character_id !== undefined) next.pov_character_id = patch.pov_character_id
              if (patch.featured_character_ids !== undefined) next.featured_character_ids = patch.featured_character_ids
              if (patch.manual_color !== undefined) next.manual_color = patch.manual_color
              return next
            }
            if (n.children) return { ...n, children: apply(n.children) }
            return n
          })
        return apply(prev)
      })
    }
    window.addEventListener('bobbinry:chapter-color-changed', handleChapterColorChanged)
    return () => window.removeEventListener('bobbinry:chapter-color-changed', handleChapterColorChanged)
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

  // Keep selectedNodeId ref in sync for auto-selection logic,
  // and scroll the selected node into view.
  useEffect(() => {
    selectedNodeIdRef.current = selectedNodeId
    if (selectedNodeId && treeContainerRef.current) {
      requestAnimationFrame(() => {
        const el = treeContainerRef.current?.querySelector(
          `[data-node-id="${CSS.escape(selectedNodeId)}"]`
        )
        if (el) {
          el.scrollIntoView({ block: 'nearest' })
        }
      })
    }
  }, [selectedNodeId])

  // Sync sidebar highlight with the actual view the router navigated to.
  useEffect(() => {
    function handleViewContextChange(e: Event) {
      const detail = (e as CustomEvent).detail
      if (detail?.entityId) {
        selectedNodeIdRef.current = detail.entityId
        setSelectedNodeId(detail.entityId)
      }
    }

    window.addEventListener('bobbinry:view-context-change', handleViewContextChange)
    return () => window.removeEventListener('bobbinry:view-context-change', handleViewContextChange)
  }, [])

  // Global Alt+N shortcut to create new content
  useEffect(() => {
    function handleGlobalKeyDown(e: KeyboardEvent) {
      if (e.altKey && !e.ctrlKey && !e.metaKey && e.key === 'n') {
        // Don't fire while the user is typing in any input/editor
        const target = e.target as HTMLElement | null
        if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) return
        e.preventDefault()

        // Determine which container to create content in based on selection
        const selected = selectedNodeIdRef.current
        if (!selected) {
          createContent(null)
          return
        }

        const node = findNodeInTree(tree, selected)
        if (!node) {
          createContent(null)
          return
        }

        if (node.nodeType === 'container') {
          // Selected a container — create content inside it
          createContent(selected)
        } else {
          // Selected content — create sibling in same container
          const parentId = nodeParentMap.current.get(selected) ?? null
          createContent(parentId)
        }
      }
    }

    window.addEventListener('keydown', handleGlobalKeyDown)
    return () => window.removeEventListener('keydown', handleGlobalKeyDown)
  }, [tree])

  async function loadCharacters() {
    if (!sdk) return
    try {
      const res = await sdk.entities.query({ collection: 'characters', limit: 1000 })
      const charsMap: CharactersById = new Map()
      for (const c of (res.data as any[]) ?? []) {
        if (!c?.id) continue
        charsMap.set(c.id, {
          id: c.id,
          name: typeof c.name === 'string' ? c.name : undefined,
          color: isPaletteToken(c.color) ? c.color : null,
        })
      }
      setCharactersById(charsMap)
    } catch {
      // Characters collection may not exist for this project — leave the map empty.
    }
  }

  // Refresh the characters lookup whenever the entities module reports a change
  // to the characters collection (e.g. the author sets a color in the character
  // editor). This keeps the chapter stripes and chips in sync without a reload.
  useEffect(() => {
    function handleEntitiesChanged(e: Event) {
      const detail = (e as CustomEvent).detail
      if (detail?.collection !== 'characters') return
      void loadCharacters()
    }
    window.addEventListener('bobbinry:entities-changed', handleEntitiesChanged)
    return () => window.removeEventListener('bobbinry:entities-changed', handleEntitiesChanged)
  }, [sdk])

  async function loadTree() {
    if (!sdk) return

    try {
      setLoading(true)

      const [allContainers, allContent, allCharacters] = await Promise.all([
        sdk.entities.query({ collection: 'containers', limit: 1000 }),
        sdk.entities.query({ collection: 'content', limit: 1000 }),
        // Characters power the POV cascade — silently treat a missing
        // characters collection as "no characters available."
        sdk.entities.query({ collection: 'characters', limit: 1000 }).catch(() => ({ data: [] }))
      ])

      // Build characters lookup. Tolerant of older entities lacking a `color` field.
      const charsMap: CharactersById = new Map()
      for (const c of (allCharacters.data as any[]) ?? []) {
        if (!c?.id) continue
        const color = isPaletteToken(c.color) ? c.color : null
        charsMap.set(c.id, {
          id: c.id,
          name: typeof c.name === 'string' ? c.name : undefined,
          color,
        })
      }
      setCharactersById(charsMap)

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
            parentId: container.id,
            pov_character_id: content.pov_character_id ?? null,
            featured_character_ids: Array.isArray(content.featured_character_ids)
              ? content.featured_character_ids
              : [],
            manual_color: content.manual_color ?? null,
            version: typeof content.version === 'number' ? content.version : undefined,
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
          parentId: null,
          pov_character_id: content.pov_character_id ?? null,
          featured_character_ids: Array.isArray(content.featured_character_ids)
            ? content.featured_character_ids
            : [],
          manual_color: content.manual_color ?? null,
          version: typeof content.version === 'number' ? content.version : undefined,
        })
      }

      // Sort root level by order
      treeData.sort((a, b) => a.order - b.order)

      nodeParentMap.current = parentMap
      setTree(treeData)

      // Auto-select on initial load: prefer last-visited chapter from
      // localStorage, fall back to first content item in the tree.
      if (!hasAutoSelectedRef.current && treeData.length > 0) {
        hasAutoSelectedRef.current = true

        // Check if ViewRouter already restored a selection (e.g. from history state).
        // Also check window.history.state — on deep-link pages, ViewRouter writes
        // nav state to history synchronously before view-context-change fires, so
        // selectedNodeIdRef may still be null even though a chapter is targeted.
        const historyHasNav = typeof window !== 'undefined' && window.history.state?.entityId
        if (!selectedNodeIdRef.current && !historyHasNav) {
          // Try to restore the last-visited chapter from localStorage
          let targetNode: TreeNode | null = null
          try {
            const saved = localStorage.getItem(`bobbinry:lastNav:${projectId}`)
            if (saved) {
              const state = JSON.parse(saved)
              if (state?.entityId) {
                const findNode = (nodes: TreeNode[]): TreeNode | null => {
                  for (const node of nodes) {
                    if (node.id === state.entityId) return node
                    if (node.children) {
                      const found = findNode(node.children)
                      if (found) return found
                    }
                  }
                  return null
                }
                targetNode = findNode(treeData)
              }
            }
          } catch {}

          // Fall back to most recently updated content item
          if (!targetNode) {
            const contentIds = new Set<string>()
            const collectContentIds = (nodes: TreeNode[]) => {
              for (const node of nodes) {
                if (node.nodeType === 'content') contentIds.add(node.id)
                if (node.children) collectContentIds(node.children)
              }
            }
            collectContentIds(treeData)

            if (contentIds.size > 0) {
              let latestId: string | null = null
              let latestTime = ''
              for (const item of allContent.data as any[]) {
                if (!contentIds.has(item.id)) continue
                const updatedAt = item._meta?.updatedAt || item.updated_at || ''
                if (updatedAt > latestTime) {
                  latestTime = updatedAt
                  latestId = item.id
                }
              }
              if (latestId) {
                const findNode = (nodes: TreeNode[]): TreeNode | null => {
                  for (const node of nodes) {
                    if (node.id === latestId) return node
                    if (node.children) {
                      const found = findNode(node.children)
                      if (found) return found
                    }
                  }
                  return null
                }
                targetNode = findNode(treeData)
              }
            }
          }

          if (targetNode) {
            handleNodeClick(targetNode)
          }
        }
      }

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
      setToast({ message: 'Failed to create container: ' + (error instanceof Error ? error.message : 'Unknown error'), variant: 'danger' })
    }
  }

  async function createContent(containerId: string | null = null) {
    try {
      const newContent = await sdk.entities.create('content', {
        title: 'New Content',
        type: 'scene',
        content_type: 'chapter',
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

      // Auto-navigate to the new content so the editor loads it
      if (typeof window !== 'undefined') {
        window.dispatchEvent(
          new CustomEvent('bobbinry:navigate', {
            detail: {
              entityType: 'content',
              entityId: newContent.id,
              bobbinId: 'manuscript',
              metadata: {
                type: 'scene',
                parentId: containerId,
                focusTitle: true
              }
            }
          })
        )
      }
    } catch (error) {
      console.error('Failed to create content:', error)
      setToast({ message: 'Failed to create content: ' + (error instanceof Error ? error.message : 'Unknown error'), variant: 'danger' })
    }
  }

  async function handleRename(nodeId: string, nodeType: 'container' | 'content', newTitle: string) {
    if (!newTitle.trim()) {
      setEditingNodeId(null)
      return
    }

    try {
      const collection = nodeType === 'container' ? 'containers' : 'content'

      const result = await sdk.entities.update(collection, nodeId, {
        title: newTitle.trim(),
        updated_at: new Date().toISOString()
      }) as any

      // Dispatch version + title events before loadTree so the editor
      // picks up the new version before any visibility-change poll fires.
      const newVersion = result?._meta?.version
      if (newVersion != null) {
        window.dispatchEvent(
          new CustomEvent('bobbinry:entity-version-changed', {
            detail: { entityId: nodeId, version: newVersion }
          })
        )
      }
      window.dispatchEvent(
        new CustomEvent('bobbinry:entity-updated', {
          detail: {
            collection,
            entityId: nodeId,
            changes: { title: newTitle.trim() }
          }
        })
      )

      await loadTree()
      setEditingNodeId(null)
    } catch (error) {
      console.error('Failed to rename:', error)
      setToast({ message: 'Failed to rename: ' + (error instanceof Error ? error.message : 'Unknown error'), variant: 'danger' })
    }
  }

  function handleDelete(nodeId: string, nodeType: 'container' | 'content') {
    setPendingDelete({ nodeId, nodeType })
  }

  async function confirmDelete() {
    const target = pendingDelete
    if (!target) return
    setPendingDelete(null)
    const collection = target.nodeType === 'container' ? 'containers' : 'content'

    try {
      // Server now handles cascade delete for containers
      await sdk.entities.delete(collection, target.nodeId)

      await loadTree()
      setContextMenu(null)

      if (selectedNodeId === target.nodeId) {
        setSelectedNodeId(null)
      }
    } catch (error) {
      console.error('Failed to delete:', error)
      setToast({ message: 'Failed to delete: ' + (error instanceof Error ? error.message : 'Unknown error'), variant: 'danger' })
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

        const moveResult = await sdk.entities.update(collection, draggedNode.id, {
          [field]: targetId,
          order: Date.now(), // place at end
          updated_at: new Date().toISOString()
        })
        broadcastVersionChange(draggedNode.id, moveResult)

        await loadTree()
        setExpandedNodes(prev => new Set(prev).add(targetId))
      } else {
        // Reorder: insert before/after the target
        await performReorder(draggedNode.id, draggedNode.nodeType, targetId, position as 'before' | 'after')
      }
    } catch (error) {
      console.error('Failed to drop:', error)
      setToast({ message: 'Failed to move item: ' + (error instanceof Error ? error.message : 'Unknown error'), variant: 'danger' })
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

    // Persist: update parent and order for all items at the target level
    // When moving across containers, merge parent + order into one update for the dragged entity
    // to avoid two concurrent updates hitting the server's version check
    const updates: Promise<any>[] = []

    for (let i = 0; i < filtered.length; i++) {
      const nodeId = filtered[i]!
      const node = findNodeById(nodeId)
      if (!node) continue
      const collection = node.nodeType === 'container' ? 'containers' : 'content'

      if (!sameParent && nodeId === draggedId) {
        // Merge parent change + order into a single update
        const field = draggedType === 'container' ? 'parent_id' : 'container_id'
        updates.push(
          sdk.entities.update(collection, draggedId, {
            [field]: targetParentId,
            order: (i + 1) * 100,
            updated_at: new Date().toISOString()
          }).then(result => broadcastVersionChange(draggedId, result))
        )
      } else {
        updates.push(
          sdk.entities.update(collection, nodeId, {
            order: (i + 1) * 100,
            updated_at: new Date().toISOString()
          }).then(result => broadcastVersionChange(nodeId, result))
        )
      }
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
    const draggedId = draggedNode.id
    sdk.entities.update(collection, draggedId, {
      [field]: null,
      order: Date.now(),
      updated_at: new Date().toISOString()
    }).then(result => {
      broadcastVersionChange(draggedId, result)
      return loadTree()
    }).catch(error => {
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
    setContextMenuView('main')
  }

  function closeContextMenu() {
    setContextMenu(null)
    setContextMenuView('main')
  }

  /**
   * Patch a chapter's color/POV/featured fields on the server, then mirror the
   * change into local tree state so the UI updates without a full reload.
   * Tolerates a missing version (server applies the update without optimistic locking).
   */
  async function patchChapter(
    nodeId: string,
    patch: { pov_character_id?: string | null; featured_character_ids?: string[]; manual_color?: string | null }
  ) {
    const node = findNodeInTree(tree, nodeId)
    if (!node) return
    try {
      const updated = await sdk.entities.update('content', nodeId, patch, node.version)
      const nextVersion =
        typeof (updated as any)?._meta?.version === 'number' ? (updated as any)._meta.version : (node.version ?? 0) + 1
      setTree(prev => {
        const apply = (nodes: TreeNode[]): TreeNode[] =>
          nodes.map(n => {
            if (n.id === nodeId) {
              const next: TreeNode = { ...n, version: nextVersion }
              if (patch.pov_character_id !== undefined) next.pov_character_id = patch.pov_character_id
              if (patch.featured_character_ids !== undefined) next.featured_character_ids = patch.featured_character_ids
              if (patch.manual_color !== undefined) next.manual_color = patch.manual_color
              return next
            }
            if (n.children) return { ...n, children: apply(n.children) }
            return n
          })
        return apply(prev)
      })
      // Notify the editor view (and any other listeners) so its stripe updates
      // without requiring a chapter reload.
      if (typeof window !== 'undefined') {
        window.dispatchEvent(
          new CustomEvent('bobbinry:chapter-color-changed', {
            detail: { entityId: nodeId, patch },
          }),
        )
        window.dispatchEvent(
          new CustomEvent('bobbinry:entity-version-changed', {
            detail: { entityId: nodeId, version: nextVersion },
          }),
        )
      }
    } catch (err) {
      console.error('[NavigationPanel] Failed to update chapter color fields:', err)
      setToast({ message: 'Could not save chapter color', variant: 'danger' })
    }
  }

  function renderNode(node: TreeNode, depth: number = 0): React.JSX.Element {
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

    // Chapter color cascade: manual_color → POV character color → none.
    const colorToken = isContainer ? null : resolveChapterColor(node, charactersById)
    const colorClasses = paletteClasses(colorToken)
    const featuredCharacters = isContainer ? [] : resolveFeaturedCharacters(node, charactersById)

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
          data-node-id={node.id}
          draggable={!isEditing}
          onDragStart={(e) => handleDragStart(e, node.id, node.nodeType)}
          onDragOver={(e) => handleDragOverNode(e, node.id, isContainer)}
          onDragLeave={handleDragLeaveNode}
          onDrop={(e) => handleDropOnNode(e, node.id, isContainer)}
          onDragEnd={handleDragEnd}
          className={`relative pr-2 py-1 cursor-pointer hover:bg-gray-100 dark:hover:bg-gray-700 text-sm flex items-center gap-1.5 ${isSelected ? 'bg-gray-100 dark:bg-gray-700' : ''} ${isDropInside ? 'bg-blue-600' : ''} ${isDragging ? 'opacity-40' : ''}`}
          style={{ paddingLeft: `${depth * 16 + 8}px` }}
          onContextMenu={(e) => handleContextMenu(e, node.id, node.nodeType)}
        >
          {colorClasses && (
            <span
              aria-hidden
              className={`absolute top-1 bottom-1 w-[3px] rounded-r-sm pointer-events-none ${colorClasses.stripe}`}
              style={{ left: `${depth * 16}px` }}
            />
          )}

          {hasChildren && (
            <span
              className="text-gray-400 text-xs w-3 flex-shrink-0 hover:text-gray-600 dark:hover:text-gray-200"
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
            className={`flex-shrink-0 ${colorClasses?.iconText ?? ''}`}
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
              className="flex-1 px-1 py-0.5 bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded text-gray-900 dark:text-gray-100"
              onClick={(e) => e.stopPropagation()}
            />
          ) : (
            <span
              className="flex-1 text-gray-800 dark:text-gray-200 truncate"
              onClick={(e) => {
                e.stopPropagation()
                if (!isEditing) handleNodeClick(node)
              }}
            >
              {node.title}
            </span>
          )}

          {!isEditing && featuredCharacters.length > 0 && (
            <FeaturedChips characters={featuredCharacters} />
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
    <div className="h-full flex flex-col bg-white dark:bg-gray-800">
      <PanelActions>
        <button
          onClick={() => {
            setSelectedNodeId(null)
            if (typeof window !== 'undefined') {
              window.dispatchEvent(
                new CustomEvent('bobbinry:navigate', {
                  detail: {
                    entityType: 'container',
                    entityId: 'ROOT',
                    bobbinId: 'manuscript',
                    metadata: { type: 'root' }
                  }
                })
              )
            }
          }}
          className="text-xs text-gray-400 hover:text-gray-600 dark:hover:text-gray-200"
          title="View entire manuscript"
        >
          ⌂
        </button>
        <div className="relative dropdown-container">
          <button
            onClick={() => setShowDropdown(!showDropdown)}
            className="text-lg leading-none text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 w-6 h-6 flex items-center justify-center"
            title="Create new item (Alt+N)"
          >
            +
          </button>
          {showDropdown && (
            <div className="absolute right-0 top-full mt-1 bg-white dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded shadow-lg z-50 min-w-[150px]">
              <button
                onClick={() => {
                  createContainer(null)
                  setShowDropdown(false)
                }}
                className="w-full text-left px-3 py-2 text-sm whitespace-nowrap hover:bg-gray-100 dark:hover:bg-gray-600 text-gray-900 dark:text-gray-100"
              >
                📁 Create Container
              </button>
              <button
                onClick={() => {
                  createContent(null)
                  setShowDropdown(false)
                }}
                className="w-full text-left px-3 py-2 text-sm whitespace-nowrap hover:bg-gray-100 dark:hover:bg-gray-600 text-gray-900 dark:text-gray-100 border-t border-gray-200 dark:border-gray-600"
              >
                📝 Create Content
              </button>
            </div>
          )}
        </div>
        <button
          onClick={loadTree}
          className="text-xs text-gray-400 hover:text-gray-600 dark:hover:text-gray-200"
          title="Refresh"
        >
          ↻
        </button>
      </PanelActions>

      <div className="px-2 pt-2 pb-1">
        <div className="relative">
          <svg className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-gray-400 dark:text-gray-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" aria-hidden>
            <circle cx="11" cy="11" r="7" />
            <path d="M21 21l-4.4-4.4" />
          </svg>
          <input
            type="text"
            value={filterQuery}
            onChange={(e) => setFilterQuery(e.target.value)}
            placeholder="Filter manuscript…"
            aria-label="Filter manuscript items"
            className="w-full rounded-md border border-gray-200 bg-white py-1 pl-7 pr-7 text-xs text-gray-700 placeholder-gray-400 outline-none focus:border-blue-400 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-200 dark:placeholder-gray-500 dark:focus:border-blue-500"
          />
          {filterQuery && (
            <button
              onClick={() => setFilterQuery('')}
              title="Clear filter"
              className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded p-0.5 text-gray-400 hover:text-gray-600 dark:text-gray-500 dark:hover:text-gray-300"
            >
              <svg className="h-3 w-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" aria-hidden>
                <path d="M6 6l12 12M18 6L6 18" />
              </svg>
            </button>
          )}
        </div>
      </div>

      {filterQuery.trim() ? (
        <div className="flex-1 overflow-y-auto">
          {filterMatches.length === 0 ? (
            <div className="p-4 text-center text-sm text-gray-500 dark:text-gray-400">
              No matches for &ldquo;{filterQuery.trim()}&rdquo;
            </div>
          ) : (
            filterMatches.map(({ node, path }) => (
              <button
                key={node.id}
                onClick={() => handleNodeClick(node)}
                className={`flex w-full items-center gap-2 px-3 py-1.5 text-left transition-colors hover:bg-gray-50 dark:hover:bg-gray-700/50 ${
                  selectedNodeId === node.id ? 'bg-gray-100 dark:bg-gray-700' : ''
                }`}
              >
                <span className="shrink-0 text-sm leading-none">{node.nodeType === 'container' ? '📁' : '📝'}</span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm text-gray-800 dark:text-gray-100">{node.title}</span>
                  {path && (
                    <span className="block truncate text-[11px] text-gray-400 dark:text-gray-500">{path}</span>
                  )}
                </span>
              </button>
            ))
          )}
        </div>
      ) : (
      <div
        ref={treeContainerRef}
        className="flex-1 overflow-y-auto"
        onDragOver={(e) => {
          e.preventDefault()
          e.dataTransfer.dropEffect = 'move'
        }}
        onDrop={handleDropOnRoot}
      >
        {tree.length === 0 ? (
          <div className="p-4 text-center text-sm text-gray-500 dark:text-gray-400">
            <div className="mb-3">No content yet</div>
            <div className="flex items-center justify-center gap-2">
              <button
                onClick={() => createContainer(null)}
                className="px-3 py-1.5 text-xs bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 text-gray-700 dark:text-gray-200 rounded"
              >
                📁 New Container
              </button>
              <button
                onClick={() => createContent(null)}
                className="px-3 py-1.5 text-xs bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 text-gray-700 dark:text-gray-200 rounded"
              >
                📝 New Content
              </button>
            </div>
          </div>
        ) : (
          tree.map(node => renderNode(node))
        )}
      </div>
      )}

      {contextMenu && (() => {
        const menuNodeId = contextMenu.nodeId
        const menuNodeType = contextMenu.nodeType
        const isContainer = menuNodeType === 'container'
        const node = findNodeInTree(tree, menuNodeId)
        const characterList: CharacterColorRef[] = Array.from(charactersById.values()).sort((a, b) =>
          (a.name ?? '').localeCompare(b.name ?? ''),
        )

        const baseMenuClass =
          'fixed bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded shadow-lg z-50 context-menu'
        const rowClass = 'w-full text-left px-3 py-2 text-sm hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-900 dark:text-gray-100 flex items-center gap-2'

        // ------------------------------- POV submenu -------------------------------
        if (!isContainer && contextMenuView === 'pov' && node) {
          const currentPov = node.pov_character_id ?? null
          return (
            <div
              className={`${baseMenuClass} min-w-[200px] max-h-80 overflow-y-auto`}
              style={{ left: contextMenu.x, top: contextMenu.y }}
            >
              <button
                onClick={() => setContextMenuView('main')}
                className="w-full text-left px-3 py-2 text-xs text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700 border-b border-gray-200 dark:border-gray-700"
              >
                ← Set POV character
              </button>
              <button
                onClick={() => { void patchChapter(menuNodeId, { pov_character_id: null }); closeContextMenu() }}
                className={`${rowClass} ${currentPov === null ? 'font-semibold' : ''}`}
              >
                <span className="h-3 w-3 rounded-full border border-gray-300 dark:border-gray-600" />
                <span className="italic text-gray-500 dark:text-gray-400">(none)</span>
              </button>
              {characterList.length === 0 && (
                <div className="px-3 py-2 text-xs text-gray-500 dark:text-gray-400 italic">No characters yet</div>
              )}
              {characterList.map(char => {
                const cls = paletteClasses(char.color)
                const isCurrent = char.id === currentPov
                return (
                  <button
                    key={char.id}
                    onClick={() => { void patchChapter(menuNodeId, { pov_character_id: char.id, manual_color: null }); closeContextMenu() }}
                    className={`${rowClass} ${isCurrent ? 'font-semibold' : ''}`}
                  >
                    <span className={`h-3 w-3 rounded-full ${cls?.swatchBg ?? 'bg-gray-300 dark:bg-gray-600'}`} />
                    <span className="truncate">{char.name ?? 'Unnamed'}</span>
                  </button>
                )
              })}
            </div>
          )
        }

        // ---------------------------- Featured submenu ----------------------------
        if (!isContainer && contextMenuView === 'featured' && node) {
          const featured = new Set(node.featured_character_ids ?? [])
          return (
            <div
              className={`${baseMenuClass} min-w-[220px] max-h-80 overflow-y-auto`}
              style={{ left: contextMenu.x, top: contextMenu.y }}
            >
              <button
                onClick={() => setContextMenuView('main')}
                className="w-full text-left px-3 py-2 text-xs text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700 border-b border-gray-200 dark:border-gray-700"
              >
                ← Featured characters
              </button>
              {characterList.length === 0 && (
                <div className="px-3 py-2 text-xs text-gray-500 dark:text-gray-400 italic">No characters yet</div>
              )}
              {characterList.map(char => {
                const cls = paletteClasses(char.color)
                const isOn = featured.has(char.id)
                return (
                  <button
                    key={char.id}
                    onClick={() => {
                      const next = new Set(featured)
                      if (isOn) next.delete(char.id)
                      else next.add(char.id)
                      void patchChapter(menuNodeId, { featured_character_ids: Array.from(next) })
                    }}
                    className={rowClass}
                  >
                    <span className={`inline-flex items-center justify-center h-3.5 w-3.5 rounded border ${isOn ? 'bg-gray-900 dark:bg-gray-100 border-gray-900 dark:border-gray-100 text-white dark:text-gray-900' : 'border-gray-400 dark:border-gray-500'}`}>
                      {isOn && <span className="text-[10px] leading-none">✓</span>}
                    </span>
                    <span className={`h-3 w-3 rounded-full ${cls?.swatchBg ?? 'bg-gray-300 dark:bg-gray-600'}`} />
                    <span className="truncate flex-1">{char.name ?? 'Unnamed'}</span>
                  </button>
                )
              })}
              <button
                onClick={closeContextMenu}
                className="w-full text-left px-3 py-2 text-xs text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700 border-t border-gray-200 dark:border-gray-700"
              >
                Done
              </button>
            </div>
          )
        }

        // ----------------------------- Color submenu -----------------------------
        if (!isContainer && contextMenuView === 'color' && node) {
          const current = isPaletteToken(node.manual_color) ? node.manual_color : null
          return (
            <div
              className={`${baseMenuClass} min-w-[220px]`}
              style={{ left: contextMenu.x, top: contextMenu.y }}
            >
              <button
                onClick={() => setContextMenuView('main')}
                className="w-full text-left px-3 py-2 text-xs text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700 border-b border-gray-200 dark:border-gray-700"
              >
                ← Custom color
              </button>
              <div className="px-3 py-2 text-[11px] text-gray-500 dark:text-gray-400">
                Overrides POV character color.
              </div>
              <div className="px-3 pb-3 grid grid-cols-6 gap-2">
                {PALETTE_TOKENS.map(token => {
                  const cls = paletteClasses(token)
                  if (!cls) return null
                  const isCurrent = token === current
                  return (
                    <button
                      key={token}
                      title={cls.label}
                      onClick={() => { void patchChapter(menuNodeId, { manual_color: token }); closeContextMenu() }}
                      className={`h-6 w-6 rounded-full ${cls.swatchBg} ring-offset-2 ring-offset-white dark:ring-offset-gray-800 transition ${isCurrent ? 'ring-2 ring-gray-900 dark:ring-gray-100' : 'hover:ring-2 hover:ring-gray-300 dark:hover:ring-gray-500'}`}
                    />
                  )
                })}
              </div>
              <button
                onClick={() => { void patchChapter(menuNodeId, { manual_color: null }); closeContextMenu() }}
                className="w-full text-left px-3 py-2 text-sm text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700 border-t border-gray-200 dark:border-gray-700"
              >
                Clear custom color
              </button>
            </div>
          )
        }

        // ------------------------------- Main menu -------------------------------
        return (
          <div
            className={`${baseMenuClass} min-w-[170px]`}
            style={{ left: contextMenu.x, top: contextMenu.y }}
          >
            {isContainer && (
              <>
                <button
                  onClick={() => {
                    createContainer(menuNodeId)
                    closeContextMenu()
                  }}
                  className="w-full text-left px-3 py-2 text-sm hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-900 dark:text-gray-100"
                >
                  📁 Add Container
                </button>
                <button
                  onClick={() => {
                    createContent(menuNodeId)
                    closeContextMenu()
                  }}
                  className="w-full text-left px-3 py-2 text-sm hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-900 dark:text-gray-100 border-t border-gray-200 dark:border-gray-700"
                >
                  📝 Add Content
                </button>
                <div className="border-t border-gray-200 dark:border-gray-700"></div>
              </>
            )}
            {!isContainer && (
              <>
                <button
                  onClick={() => setContextMenuView('pov')}
                  className="w-full text-left px-3 py-2 text-sm hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-900 dark:text-gray-100 flex items-center justify-between gap-2"
                >
                  <span>🎭 Set POV character</span>
                  <span className="text-gray-400">▸</span>
                </button>
                <button
                  onClick={() => setContextMenuView('featured')}
                  className="w-full text-left px-3 py-2 text-sm hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-900 dark:text-gray-100 border-t border-gray-200 dark:border-gray-700 flex items-center justify-between gap-2"
                >
                  <span>👥 Featured characters</span>
                  <span className="text-gray-400">▸</span>
                </button>
                <button
                  onClick={() => setContextMenuView('color')}
                  className="w-full text-left px-3 py-2 text-sm hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-900 dark:text-gray-100 border-t border-gray-200 dark:border-gray-700 flex items-center justify-between gap-2"
                >
                  <span>🎨 Custom color</span>
                  <span className="text-gray-400">▸</span>
                </button>
                <div className="border-t border-gray-200 dark:border-gray-700"></div>
              </>
            )}
            <button
              onClick={() => {
                setEditingNodeId(menuNodeId)
                const target = findNodeInTree(tree, menuNodeId)
                if (target) {
                  setEditingValue(target.title)
                }
                closeContextMenu()
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
      {toast && (
        <ToastContainer position="bottom-center">
          <Toast message={toast.message} variant={toast.variant} duration={4000} onDismiss={dismissToast} />
        </ToastContainer>
      )}
      <Dialog
        open={pendingDelete !== null}
        title={pendingDelete?.nodeType === 'container' ? 'Delete this container?' : 'Delete this item?'}
        message={
          pendingDelete?.nodeType === 'container'
            ? 'Everything inside this container will also be deleted. This cannot be undone.'
            : 'This cannot be undone.'
        }
        variant="danger"
        confirmLabel="Delete"
        onConfirm={confirmDelete}
        onCancel={() => setPendingDelete(null)}
      />
    </div>
  )
}

const MAX_VISIBLE_CHIPS = 4

function FeaturedChips({ characters }: { characters: CharacterColorRef[] }) {
  const visible = characters.slice(0, MAX_VISIBLE_CHIPS)
  const overflow = characters.length - visible.length

  return (
    <span className="flex-shrink-0 flex items-center gap-0.5" aria-label="Featured characters">
      {visible.map(char => {
        const classes = paletteClasses(char.color)
        const bg = classes?.chipBg ?? 'bg-gray-300 dark:bg-gray-600'
        return (
          <span
            key={char.id}
            title={char.name ?? 'Unnamed character'}
            className={`inline-flex items-center justify-center h-3.5 w-3.5 rounded-full text-[8px] font-semibold text-white ring-1 ring-white dark:ring-gray-800 ${bg}`}
          >
            {characterInitial(char.name)}
          </span>
        )
      })}
      {overflow > 0 && (
        <span
          title={`${overflow} more`}
          className="inline-flex items-center justify-center h-3.5 px-1 rounded-full text-[8px] font-semibold text-gray-600 dark:text-gray-300 bg-gray-200 dark:bg-gray-700 ring-1 ring-white dark:ring-gray-800"
        >
          +{overflow}
        </span>
      )}
    </span>
  )
}
