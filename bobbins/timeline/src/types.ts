/**
 * Type definitions for the Timeline bobbin
 */

export type TimelineScale = 'years' | 'months' | 'days' | 'hours' | 'custom'

export interface Timeline {
  id: string
  projectId: string
  bobbinId: string
  name: string
  description: string | null
  scale: TimelineScale
  color: string | null
  created_at: string
  updated_at: string
}

export interface TimelineEvent {
  id: string
  projectId: string
  bobbinId: string
  title: string
  description: string | null
  date_label: string
  sort_order: number
  timeline_id: string
  linked_entities: LinkedEntity[]
  tags: string[]
  color: string | null
  icon: string | null
  duration_label: string | null
  created_at: string
  updated_at: string
}

export interface LinkedEntity {
  entityId: string
  collection: string
  bobbinId: string
  label: string
}
