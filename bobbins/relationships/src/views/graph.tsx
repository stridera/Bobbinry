import { useState, useEffect, useRef, useCallback } from 'react'
import type { BobbinrySDK } from '@bobbinry/sdk'

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
  const [loading, setLoading] = useState(true)
  const [selectedNode, setSelectedNode] = useState<string | null>(null)
  const [filterType, setFilterType] = useState<string | null>(metadata?.filterType || null)
  const [dragNode, setDragNode] = useState<string | null>(null)

  const nodesRef = useRef<Node[]>([])
  const edgesRef = useRef<Edge[]>([])

  useEffect(() => {
    loadData()
  }, [])

  async function loadData() {
    try {
      setLoading(true)
      const res = await sdk.entities.query({ collection: 'relationships', limit: 1000 })
      const rels = (res.data as any[]) || []
      setRelationships(rels)
      buildGraph(rels)
    } catch (err) {
      console.error('[Graph] Failed to load:', err)
    } finally {
      setLoading(false)
    }
  }

  function buildGraph(rels: any[]) {
    const filtered = filterType ? rels.filter(r => r.relationship_type === filterType) : rels
    const nodeMap = new Map<string, Node>()

    for (const rel of filtered) {
      if (!nodeMap.has(rel.source_entity_id)) {
        nodeMap.set(rel.source_entity_id, {
          id: rel.source_entity_id,
          label: rel.source_entity_id.substring(0, 8),
          collection: rel.source_collection,
          x: Math.random() * 600 + 100,
          y: Math.random() * 400 + 100,
          vx: 0,
          vy: 0,
          color: COLLECTION_COLORS[rel.source_collection] || '#6b7280'
        })
      }
      if (!nodeMap.has(rel.target_entity_id)) {
        nodeMap.set(rel.target_entity_id, {
          id: rel.target_entity_id,
          label: rel.target_entity_id.substring(0, 8),
          collection: rel.target_collection,
          x: Math.random() * 600 + 100,
          y: Math.random() * 400 + 100,
          vx: 0,
          vy: 0,
          color: COLLECTION_COLORS[rel.target_collection] || '#6b7280'
        })
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
  }, [filterType, relationships])

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

    // Apply velocity with damping
    for (const node of ns) {
      if (dragNode && node.id === dragNode) continue
      node.vx *= 0.9
      node.vy *= 0.9
      node.x += node.vx
      node.y += node.vy
    }
  }, [dragNode])

  // Render loop
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    function render() {
      simulate()

      const w = canvas!.width
      const h = canvas!.height
      ctx!.clearRect(0, 0, w, h)

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

      animRef.current = requestAnimationFrame(render)
    }

    animRef.current = requestAnimationFrame(render)
    return () => cancelAnimationFrame(animRef.current)
  }, [nodes, edges, selectedNode, simulate])

  // Resize canvas
  useEffect(() => {
    function handleResize() {
      const canvas = canvasRef.current
      if (!canvas) return
      const parent = canvas.parentElement
      if (!parent) return
      canvas.width = parent.clientWidth
      canvas.height = parent.clientHeight
    }
    handleResize()
    window.addEventListener('resize', handleResize)
    return () => window.removeEventListener('resize', handleResize)
  }, [])

  function handleCanvasClick(e: React.MouseEvent<HTMLCanvasElement>) {
    const canvas = canvasRef.current
    if (!canvas) return
    const rect = canvas.getBoundingClientRect()
    const x = e.clientX - rect.left
    const y = e.clientY - rect.top

    const clicked = nodesRef.current.find(n => {
      const dx = n.x - x
      const dy = n.y - y
      return Math.sqrt(dx * dx + dy * dy) < 14
    })

    setSelectedNode(clicked?.id || null)
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
            <div className="text-center">
              <p className="text-lg mb-2">No relationships to visualize</p>
              <p className="text-sm">Create relationships between entities to see the graph</p>
            </div>
          </div>
        ) : (
          <canvas
            ref={canvasRef}
            onClick={handleCanvasClick}
            className="w-full h-full cursor-crosshair"
          />
        )}
      </div>
    </div>
  )
}
