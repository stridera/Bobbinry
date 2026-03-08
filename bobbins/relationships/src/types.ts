/**
 * Type definitions for the Relationships bobbin
 */

export type RelationshipStrength = 'weak' | 'moderate' | 'strong'

export interface Relationship {
  id: string
  projectId: string
  bobbinId: string
  source_entity_id: string
  target_entity_id: string
  source_collection: string
  target_collection: string
  relationship_type: string
  label: string | null
  description: string | null
  bidirectional: boolean
  strength: RelationshipStrength
  color: string | null
  created_at: string
  updated_at: string
}

export interface GraphNode {
  id: string
  label: string
  collection: string
  x: number
  y: number
  vx: number
  vy: number
  color?: string
}

export interface GraphEdge {
  source: string
  target: string
  type: string
  label?: string
  strength: RelationshipStrength
  color?: string
  bidirectional: boolean
}
