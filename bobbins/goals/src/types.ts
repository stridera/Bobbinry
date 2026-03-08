/**
 * Type definitions for the Goals & Progress bobbin
 */

export type GoalType = 'daily' | 'session' | 'project' | 'custom'

export type GoalStatus = 'active' | 'completed' | 'paused' | 'failed'

export interface Goal {
  id: string
  projectId: string
  bobbinId: string
  name: string
  type: GoalType
  target_count: number
  current_count: number
  start_date: string | null
  end_date: string | null
  status: GoalStatus
  created_at: string
  updated_at: string
}

export interface WritingSession {
  id: string
  projectId: string
  bobbinId: string
  start_time: string
  end_time: string | null
  word_count: number
  notes: string | null
  goal_id: string | null
  created_at: string
  updated_at: string
}

export interface Streak {
  id: string
  projectId: string
  bobbinId: string
  current_streak: number
  longest_streak: number
  last_writing_date: string | null
}
