import { useState, useEffect, useRef, useCallback } from 'react'
import type { BobbinrySDK } from '@bobbinry/sdk'
import { resolveEntityNames, type ResolvedEntity } from '../entity-names'

interface GraphViewProps {
  projectId: string
  bobbinId: string
  viewId: string
  sdk: BobbinrySDK
  metadata?: Record<string, any>
}

interface Node {
  id: string
  label: string
  collection: string
  x: number
  y: number
  vx: number
  vy: number
  color: string
}

interface Edge {
  source: string
  target: string
  type: string
  label?: string
  strength: string
  color: string
  bidirectional: boolean
}

const STRENGTH_WIDTH = { weak: 1, moderate: 2, strong: 3 }
const COLLECTION_COLORS: Record<string, string> = {
  characters: '#3b82f6',
  locations: '#22c55e',
  items: '#f59e0b',
  spells: '#8b5cf6',
  factions: '#ef4444',
}

export default function GraphView({
  sdk,
  projectId,
  metadata,
}: GraphViewProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const animRef = useRef<number>(0)
  const [nodes, setNodes] = useState<Node[]>([])
  const [edges, setEdges] = useState<Edge[]>([])
  const [relationships, setRelationships] = useState<any[]>([])
  const [entityNames, setEntityNames] = useState<Map<string, ResolvedEntity>>(new Map())
  const [loading, setLoading] = useState(true)
  const [selectedNode, setSelectedNode] = useState<string | null>(null)
  const [filterType, setFilterType] = useState<string | null>(metadata?.filterType || null)
  const [dragNode, setDragNode] = useState<string | null>(null)
  const [hoveredNode, setHoveredNode] = useState<string | null>(null)

  const nodesRef = useRef<Node[]>([])
  const edgesRef = useRef<Edge[]>([])
  // Mirror of dragNode state for synchronous reads inside the mouse handlers.
  // React's batched state updates mean setDragNode(id) inside mousedown isn't
  // visible to the immediately-following mousemove via closure — the ref is.
  const dragNodeRef = useRef<string | null>(null)
  // Pan/zoom transform. Stored in refs so the render loop reads them without
  // re-binding on each change. zoom = pixels per world unit; pan = world-space
  // origin offset (canvas pixels).
  const zoomRef = useRef<number>(1)
  const panRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 })
  // Pan-drag state: when the user mousedowns on empty canvas, we start panning.
  const panStartRef = useRef<{ mouseX: number; mouseY: number; panX: number; panY: number } | null>(null)
  // Preserve node positions across rebuilds so things like a names-loaded
  // refetch or filter change don't reshuffle the entire layout.
  const positionsRef = useRef<Map<string, { x: number; y: number }>>(new Map())
  // Nodes the user has dragged. Pinned nodes ignore physics — they stay where
  // dropped until removed.
  const pinnedRef = useRef<Set<string>>(new Set())

  useEffect(() => {
    loadData()
  }, [])

  async function loadData() {
    try {
      setLoading(true)
      const res = await sdk.entities.query({ collection: 'relationships', limit: 1000 })
      const rels = (res.data as any[]) || []
      setRelationships(rels)
      const names = await resolveEntityNames(sdk, rels)
      setEntityNames(names)
    } catch (err) {
      console.error('[Graph] Failed to load:', err)
    } finally {
      setLoading(false)
    }
  }

  function buildGraph(rels: any[]) {
    const filtered = filterType ? rels.filter(r => r.relationship_type === filterType) : rels
    const nodeMap = new Map<string, Node>()

    // Seed new node positions inside the current canvas bounds (with a 20%
    // margin) so nothing spawns off-screen on small viewports. Falls back to
    // a 600x400 box pre-mount.
    const cw = canvasRef.current?.width || 600
    const ch = canvasRef.current?.height || 400

    function makeNode(id: string, collection: string): Node {
      const cached = positionsRef.current.get(id)
      return {
        id,
        label: entityNames.get(id)?.name || `(${id.substring(0, 8)})`,
        collection,
        x: cached?.x ?? (cw * 0.2 + Math.random() * cw * 0.6),
        y: cached?.y ?? (ch * 0.2 + Math.random() * ch * 0.6),
        vx: 0,
        vy: 0,
        color: COLLECTION_COLORS[collection] || '#6b7280'
      }
    }

    for (const rel of filtered) {
      if (!nodeMap.has(rel.source_entity_id)) {
        nodeMap.set(rel.source_entity_id, makeNode(rel.source_entity_id, rel.source_collection))
      }
      if (!nodeMap.has(rel.target_entity_id)) {
        nodeMap.set(rel.target_entity_id, makeNode(rel.target_entity_id, rel.target_collection))
      }
    }

    const graphEdges: Edge[] = filtered.map(rel => ({
      source: rel.source_entity_id,
      target: rel.target_entity_id,
      type: rel.relationship_type,
      label: rel.label,
      strength: rel.strength || 'moderate',
      color: rel.color || '#6b7280',
      bidirectional: rel.bidirectional || false
    }))

    const graphNodes = Array.from(nodeMap.values())
    nodesRef.current = graphNodes
    edgesRef.current = graphEdges
    setNodes(graphNodes)
    setEdges(graphEdges)
  }

  useEffect(() => {
    buildGraph(relationships)
    // Rebuild when names arrive so the canvas swaps from short-id stubs to
    // the real labels without a manual refresh.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filterType, relationships, entityNames])

  // Simple force-directed physics
  const simulate = useCallback(() => {
    const ns = nodesRef.current
    const es = edgesRef.current
    if (ns.length === 0) return

    // Repulsion between all nodes
    for (let i = 0; i < ns.length; i++) {
      for (let j = i + 1; j < ns.length; j++) {
        const ni = ns[i]!
        const nj = ns[j]!
        const dx = nj.x - ni.x
        const dy = nj.y - ni.y
        const dist = Math.max(Math.sqrt(dx * dx + dy * dy), 1)
        const force = 5000 / (dist * dist)
        const fx = (dx / dist) * force
        const fy = (dy / dist) * force
        ni.vx -= fx
        ni.vy -= fy
        nj.vx += fx
        nj.vy += fy
      }
    }

    // Attraction along edges
    const nodeMap = new Map(ns.map(n => [n.id, n]))
    for (const edge of es) {
      const s = nodeMap.get(edge.source)
      const t = nodeMap.get(edge.target)
      if (!s || !t) continue
      const dx = t.x - s.x
      const dy = t.y - s.y
      const dist = Math.max(Math.sqrt(dx * dx + dy * dy), 1)
      const force = (dist - 150) * 0.01
      const fx = (dx / dist) * force
      const fy = (dy / dist) * force
      s.vx += fx
      s.vy += fy
      t.vx -= fx
      t.vy -= fy
    }

    // Center gravity
    for (const node of ns) {
      const canvas = canvasRef.current
      if (!canvas) continue
      const cx = canvas.width / 2
      const cy = canvas.height / 2
      node.vx += (cx - node.x) * 0.001
      node.vy += (cy - node.y) * 0.001
    }

    // Apply velocity with damping. Pinned nodes (dragged by the user) and the
    // currently-being-dragged node ignore physics and stay where put.
    for (const node of ns) {
      if (dragNodeRef.current && node.id === dragNodeRef.current) continue
      if (pinnedRef.current.has(node.id)) {
        node.vx = 0
        node.vy = 0
        continue
      }
      node.vx *= 0.9
      node.vy *= 0.9
      node.x += node.vx
      node.y += node.vy
      positionsRef.current.set(node.id, { x: node.x, y: node.y })
    }
    // simulate is intentionally stable — all dynamic state it reads (drag,
    // pinned) lives in refs so the render loop doesn't need to restart when
    // dragging starts/stops.
  }, [])

  // Render loop
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    // Sync buffer size to the canvas's CSS size every time we (re)start the
    // render loop. This makes sure the buffer matches the displayed area even
    // if the dedicated ResizeObserver effect hadn't fired yet — mismatched
    // buffer makes clicks miss everything because draw coords are scaled.
    {
      const parent = canvas.parentElement
      if (parent) {
        const pw = parent.clientWidth
        const ph = parent.clientHeight
        if (pw > 0 && ph > 0 && (canvas.width !== pw || canvas.height !== ph)) {
          canvas.width = pw
          canvas.height = ph
        }
      }
    }

    function render() {
      simulate()

      const w = canvas!.width
      const h = canvas!.height
      ctx!.clearRect(0, 0, w, h)

      // Apply pan + zoom around world space. Everything drawn below is in
      // world coords; the transform maps it to screen coords.
      ctx!.save()
      ctx!.translate(panRef.current.x, panRef.current.y)
      ctx!.scale(zoomRef.current, zoomRef.current)

      const ns = nodesRef.current
      const es = edgesRef.current
      const nodeMap = new Map(ns.map(n => [n.id, n]))

      // Draw edges
      for (const edge of es) {
        const s = nodeMap.get(edge.source)
        const t = nodeMap.get(edge.target)
        if (!s || !t) continue

        ctx!.beginPath()
        ctx!.moveTo(s.x, s.y)
        ctx!.lineTo(t.x, t.y)
        ctx!.strokeStyle = edge.color
        ctx!.lineWidth = STRENGTH_WIDTH[edge.strength as keyof typeof STRENGTH_WIDTH] || 1
        ctx!.stroke()

        // Edge label
        if (edge.label) {
          const mx = (s.x + t.x) / 2
          const my = (s.y + t.y) / 2
          ctx!.fillStyle = '#9ca3af'
          ctx!.font = '10px sans-serif'
          ctx!.textAlign = 'center'
          ctx!.fillText(edge.label, mx, my - 5)
        }
      }

      // Draw nodes
      for (const node of ns) {
        const isSelected = selectedNode === node.id

        ctx!.beginPath()
        ctx!.arc(node.x, node.y, isSelected ? 14 : 10, 0, Math.PI * 2)
        ctx!.fillStyle = node.color
        ctx!.fill()
        if (isSelected) {
          ctx!.strokeStyle = '#ffffff'
          ctx!.lineWidth = 2
          ctx!.stroke()
        }

        ctx!.fillStyle = '#e5e7eb'
        ctx!.font = '11px sans-serif'
        ctx!.textAlign = 'center'
        ctx!.fillText(node.label, node.x, node.y + 22)
      }

      ctx!.restore()
      animRef.current = requestAnimationFrame(render)
    }

    animRef.current = requestAnimationFrame(render)
    return () => cancelAnimationFrame(animRef.current)
  }, [nodes, edges, selectedNode, simulate])

  // Sync canvas buffer to its CSS size. The canvas is conditionally rendered
  // (only when nodes.length > 0), so a plain mount-time effect would no-op.
  // ResizeObserver fires on initial measurement and on every parent resize,
  // and rebinds whenever the canvas mounts/unmounts.
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const parent = canvas.parentElement
    if (!parent) return

    function sync() {
      if (!canvas || !parent) return
      const w = parent.clientWidth
      const h = parent.clientHeight
      if (w > 0 && h > 0 && (canvas.width !== w || canvas.height !== h)) {
        canvas.width = w
        canvas.height = h
      }
    }
    sync()

    const observer = new ResizeObserver(sync)
    observer.observe(parent)
    return () => observer.disconnect()
  }, [nodes.length === 0])

  // Screen (canvas-relative pixels) → world coords by inverting pan + zoom.
  function getCanvasCoords(e: React.MouseEvent<HTMLCanvasElement>) {
    const canvas = canvasRef.current
    if (!canvas) return null
    const rect = canvas.getBoundingClientRect()
    const sx = e.clientX - rect.left
    const sy = e.clientY - rect.top
    const z = zoomRef.current || 1
    return {
      x: (sx - panRef.current.x) / z,
      y: (sy - panRef.current.y) / z,
      sx, sy // raw screen coords for pan delta math
    }
  }

  function findNodeAt(x: number, y: number): Node | null {
    // x/y are in world coords; node hit radius shrinks proportionally so it
    // still matches the visible 10-14px circle on screen.
    const hitR = 14 / (zoomRef.current || 1)
    return nodesRef.current.find(n => {
      const dx = n.x - x
      const dy = n.y - y
      return Math.sqrt(dx * dx + dy * dy) < hitR
    }) || null
  }

  // Mousedown grabs a node for dragging if one is under the cursor; otherwise
  // starts panning the canvas.
  function handleMouseDown(e: React.MouseEvent<HTMLCanvasElement>) {
    const c = getCanvasCoords(e)
    if (!c) return
    const node = findNodeAt(c.x, c.y)
    if (node) {
      dragNodeRef.current = node.id
      setDragNode(node.id)
      setSelectedNode(node.id)
    } else {
      panStartRef.current = {
        mouseX: c.sx, mouseY: c.sy,
        panX: panRef.current.x, panY: panRef.current.y
      }
      setSelectedNode(null)
    }
  }

  function handleMouseMove(e: React.MouseEvent<HTMLCanvasElement>) {
    const c = getCanvasCoords(e)
    if (!c) return
    const dragging = dragNodeRef.current
    if (dragging) {
      // Update the live node position directly on the ref — state churn each
      // frame would tank the canvas FPS.
      const node = nodesRef.current.find(n => n.id === dragging)
      if (node) {
        node.x = c.x
        node.y = c.y
        positionsRef.current.set(node.id, { x: c.x, y: c.y })
      }
    } else if (panStartRef.current) {
      const p = panStartRef.current
      panRef.current = {
        x: p.panX + (c.sx - p.mouseX),
        y: p.panY + (c.sy - p.mouseY)
      }
    } else {
      const hovered = findNodeAt(c.x, c.y)
      setHoveredNode(prev => (prev === (hovered?.id || null) ? prev : hovered?.id || null))
    }
  }

  function endDrag() {
    const dragging = dragNodeRef.current
    if (dragging) {
      // Pin where the user dropped it so physics doesn't yank it back.
      pinnedRef.current.add(dragging)
      dragNodeRef.current = null
      setDragNode(null)
    }
    panStartRef.current = null
  }

  // Wheel zoom centered on the cursor — keeps whatever's under the pointer
  // stationary in screen space as the zoom changes.
  function handleWheel(e: React.WheelEvent<HTMLCanvasElement>) {
    e.preventDefault()
    const canvas = canvasRef.current
    if (!canvas) return
    const rect = canvas.getBoundingClientRect()
    const sx = e.clientX - rect.left
    const sy = e.clientY - rect.top

    const oldZoom = zoomRef.current || 1
    // negative deltaY (wheel up) zooms in; clamp to [0.2, 5]
    const factor = Math.exp(-e.deltaY * 0.001)
    const newZoom = Math.max(0.2, Math.min(5, oldZoom * factor))
    if (newZoom === oldZoom) return

    // Anchor the world point under the cursor: world = (screen - pan) / zoom
    // should be the same before and after. Solve for new pan.
    const worldX = (sx - panRef.current.x) / oldZoom
    const worldY = (sy - panRef.current.y) / oldZoom
    panRef.current = {
      x: sx - worldX * newZoom,
      y: sy - worldY * newZoom
    }
    zoomRef.current = newZoom
  }

  function resetView() {
    zoomRef.current = 1
    panRef.current = { x: 0, y: 0 }
  }

  function unpinNode(id: string) {
    pinnedRef.current.delete(id)
  }

  const types = [...new Set(relationships.map(r => r.relationship_type))].sort()

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-gray-600 dark:text-gray-400">Loading...</div>
      </div>
    )
  }

  return (
    <div className="flex flex-col h-full bg-gray-50 dark:bg-gray-900">
      {/* Header */}
      <div className="border-b border-gray-200 dark:border-gray-700 p-4 bg-white dark:bg-gray-800">
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">Relationship Graph</h1>
          <div className="flex items-center gap-2">
            <select
              value={filterType || ''}
              onChange={(e) => setFilterType(e.target.value || null)}
              className="px-3 py-1.5 text-sm border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100"
            >
              <option value="">All Types</option>
              {types.map(t => (
                <option key={t} value={t}>{t}</option>
              ))}
            </select>
            <button
              onClick={() => {
                window.dispatchEvent(new CustomEvent('bobbinry:navigate', {
                  detail: {
                    entityType: 'relationships',
                    entityId: 'new',
                    bobbinId: 'relationships',
                    metadata: { view: 'relationship-editor', isNew: true }
                  }
                }))
              }}
              className="px-4 py-1.5 bg-blue-600 dark:bg-blue-700 text-white rounded hover:bg-blue-700 dark:hover:bg-blue-600 font-medium text-sm"
            >
              + New
            </button>
          </div>
        </div>
        <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
          {nodes.length} node{nodes.length !== 1 ? 's' : ''}, {edges.length} edge{edges.length !== 1 ? 's' : ''}
        </p>
      </div>

      {/* Canvas */}
      <div className="flex-1 relative">
        {nodes.length === 0 ? (
          <div className="flex items-center justify-center h-full text-gray-500 dark:text-gray-400">
            <div className="text-center max-w-sm">
              <p className="text-lg mb-2">No relationships yet</p>
              <p className="text-sm mb-4">Connect characters, places, and other entities to see them mapped here.</p>
              <button
                onClick={() => {
                  window.dispatchEvent(new CustomEvent('bobbinry:navigate', {
                    detail: {
                      entityType: 'relationships',
                      entityId: 'new',
                      bobbinId: 'relationships',
                      metadata: { view: 'relationship-editor', isNew: true }
                    }
                  }))
                }}
                className="px-4 py-2 bg-blue-600 dark:bg-blue-700 text-white rounded-lg hover:bg-blue-700 dark:hover:bg-blue-600 font-medium text-sm"
              >
                + Create First Relationship
              </button>
            </div>
          </div>
        ) : (
          <>
            <canvas
              ref={canvasRef}
              onMouseDown={handleMouseDown}
              onMouseMove={handleMouseMove}
              onMouseUp={endDrag}
              onMouseLeave={endDrag}
              onWheel={handleWheel}
              className={`w-full h-full ${
                dragNode
                  ? 'cursor-grabbing'
                  : hoveredNode
                    ? 'cursor-grab'
                    : panStartRef.current
                      ? 'cursor-grabbing'
                      : 'cursor-default'
              }`}
            />

            {/* Zoom controls */}
            <div className="absolute bottom-3 right-4 flex items-center gap-1 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded shadow-sm">
              <button
                onClick={() => handleWheel({
                  preventDefault: () => {},
                  clientX: (canvasRef.current?.getBoundingClientRect().left ?? 0) + (canvasRef.current?.clientWidth ?? 0) / 2,
                  clientY: (canvasRef.current?.getBoundingClientRect().top ?? 0) + (canvasRef.current?.clientHeight ?? 0) / 2,
                  deltaY: -200,
                } as any)}
                className="px-2 py-1 text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700"
                title="Zoom in"
              >+</button>
              <button
                onClick={() => handleWheel({
                  preventDefault: () => {},
                  clientX: (canvasRef.current?.getBoundingClientRect().left ?? 0) + (canvasRef.current?.clientWidth ?? 0) / 2,
                  clientY: (canvasRef.current?.getBoundingClientRect().top ?? 0) + (canvasRef.current?.clientHeight ?? 0) / 2,
                  deltaY: 200,
                } as any)}
                className="px-2 py-1 text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700"
                title="Zoom out"
              >−</button>
              <button
                onClick={resetView}
                className="px-2 py-1 text-xs text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700 border-l border-gray-200 dark:border-gray-700"
                title="Reset view"
              >Reset</button>
            </div>

            {/* Selected node info overlay */}
            {selectedNode && (() => {
              const node = nodes.find(n => n.id === selectedNode)
              if (!node) return null
              const outgoing = relationships.filter(r => r.source_entity_id === node.id)
              const incoming = relationships.filter(r => r.target_entity_id === node.id)
              const isPinned = pinnedRef.current.has(node.id)
              return (
                <div className="absolute top-4 right-4 w-64 p-3 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg shadow-lg text-sm">
                  <div className="flex items-start gap-2 mb-2">
                    <span
                      className="inline-block w-3 h-3 rounded-full mt-1 flex-shrink-0"
                      style={{ backgroundColor: node.color }}
                    />
                    <div className="flex-1 min-w-0">
                      <div className="font-semibold text-gray-900 dark:text-gray-100 truncate" title={node.label}>
                        {node.label}
                      </div>
                      <div className="text-xs text-gray-500 dark:text-gray-400">{node.collection}</div>
                    </div>
                    <button
                      onClick={() => setSelectedNode(null)}
                      className="text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 -mt-1"
                      title="Close"
                    >×</button>
                  </div>
                  <div className="text-xs text-gray-600 dark:text-gray-400 mb-3">
                    {outgoing.length} outgoing, {incoming.length} incoming
                  </div>
                  <div className="flex gap-2">
                    <button
                      onClick={() => {
                        window.dispatchEvent(new CustomEvent('bobbinry:navigate', {
                          detail: {
                            entityType: node.collection,
                            entityId: node.id,
                            bobbinId: 'entities',
                            metadata: { view: 'entity-editor' }
                          }
                        }))
                      }}
                      className="flex-1 px-3 py-1.5 bg-blue-600 dark:bg-blue-700 text-white rounded text-xs font-medium hover:bg-blue-700 dark:hover:bg-blue-600"
                    >
                      Open entity
                    </button>
                    {isPinned && (
                      <button
                        onClick={() => { unpinNode(node.id); setSelectedNode(node.id) /* nudge re-render */ }}
                        className="px-3 py-1.5 border border-gray-300 dark:border-gray-600 rounded text-xs font-medium text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700"
                        title="Let physics move this node again"
                      >
                        Unpin
                      </button>
                    )}
                  </div>
                </div>
              )
            })()}

            {/* Hint */}
            <div className="absolute bottom-3 left-4 text-[11px] text-gray-400 dark:text-gray-500 select-none pointer-events-none">
              Drag nodes to arrange · drag empty space to pan · scroll to zoom
            </div>
          </>
        )}
      </div>
    </div>
  )
}
