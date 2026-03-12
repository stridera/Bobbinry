import { useState, useEffect, useMemo } from 'react'
import {
  BobbinrySDK,
  PanelActions,
  PanelBody,
  PanelCard,
  PanelEmptyState,
  PanelFrame,
  PanelIconButton,
  PanelLoadingState,
  PanelPill,
  PanelSectionTitle,
} from '@bobbinry/sdk'

interface ProgressPanelProps {
  context?: {
    projectId?: string
    currentProject?: string
    currentView?: string
    apiToken?: string
  }
}

export default function ProgressPanel({ context }: ProgressPanelProps) {
  const [goals, setGoals] = useState<any[]>([])
  const [streak, setStreak] = useState<any | null>(null)
  const [todayWords, setTodayWords] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [sdk] = useState(() => new BobbinrySDK('goals'))
  const projectId = useMemo(() => context?.projectId || context?.currentProject, [context?.projectId, context?.currentProject])

  useEffect(() => {
    if (context?.apiToken) {
      sdk.api.setAuthToken(context.apiToken)
    }
  }, [context?.apiToken, sdk])

  useEffect(() => {
    if (projectId && context?.apiToken) {
      sdk.setProject(projectId)
      loadData()
    } else if (!projectId) {
      setLoading(false)
    }
  }, [projectId, context?.apiToken])

  async function loadData() {
    try {
      setLoading(true)
      setError(null)
      const [goalsRes, sessionsRes, streaksRes] = await Promise.all([
        sdk.entities.query({ collection: 'goals', limit: 100 }),
        sdk.entities.query({ collection: 'writing_sessions', limit: 1000 }),
        sdk.entities.query({ collection: 'streaks', limit: 1 })
      ])

      setGoals(((goalsRes.data as any[]) || []).filter(g => g.status === 'active'))

      // Calculate today's words
      const today = new Date().toISOString().split('T')[0]
      const todaySessions = ((sessionsRes.data as any[]) || [])
        .filter(s => s.start_time?.startsWith(today))
      setTodayWords(todaySessions.reduce((sum, s) => sum + (s.word_count || 0), 0))

      const streakData = (streaksRes.data as any[]) || []
      setStreak(streakData[0] || null)
    } catch (err) {
      console.error('[Progress Panel] Failed to load:', err)
      setError('Failed to load progress')
    } finally {
      setLoading(false)
    }
  }

  function openDashboard() {
    window.dispatchEvent(new CustomEvent('bobbinry:navigate', {
      detail: {
        entityType: 'goals',
        entityId: 'dashboard',
        bobbinId: 'goals',
        metadata: { view: 'dashboard' }
      }
    }))
  }

  if (loading) {
    return <PanelLoadingState label="Loading progress…" />
  }

  if (!projectId) {
    return <PanelEmptyState title="No project selected" description="Open a project to see writing goals and streaks." />
  }

  return (
    <PanelFrame>
      <PanelActions>
        <PanelIconButton
          onClick={openDashboard}
          title="Open goals dashboard"
        >
          <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M4 19h16M7 15l3-3 3 2 4-6" />
          </svg>
        </PanelIconButton>
        <PanelIconButton
          onClick={loadData}
          title="Refresh"
        >
          <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M4 4v6h6M20 20v-6h-6" />
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M20 9a8 8 0 00-13.66-4.95L4 10M4 15a8 8 0 0013.66 4.95L20 14" />
          </svg>
        </PanelIconButton>
      </PanelActions>

      <PanelBody className="space-y-3">
        <div className="flex items-center justify-between gap-3">
          <PanelSectionTitle>Overview</PanelSectionTitle>
          <PanelPill>{goals.length} active</PanelPill>
        </div>

        {error ? (
          <PanelCard className="text-xs text-red-700 dark:text-red-300">{error}</PanelCard>
        ) : null}

        <div className="grid grid-cols-2 gap-3">
          <PanelCard className="text-center">
            <div className="text-2xl font-semibold text-amber-500">{streak?.current_streak || 0}</div>
            <div className="mt-1 text-[11px] uppercase tracking-[0.14em] text-gray-500 dark:text-gray-400">Day streak</div>
          </PanelCard>
          <PanelCard className="text-center">
            <div className="text-2xl font-semibold text-blue-600 dark:text-blue-400">{todayWords.toLocaleString()}</div>
            <div className="mt-1 text-[11px] uppercase tracking-[0.14em] text-gray-500 dark:text-gray-400">Words today</div>
          </PanelCard>
        </div>

        <div className="space-y-2">
          <PanelSectionTitle>Active Goals</PanelSectionTitle>
          {goals.length === 0 ? (
            <PanelEmptyState
              title="No active goals"
              description="Create a goal in the dashboard to track progress here."
            />
          ) : (
            goals.map(goal => {
              const progress = goal.target_count > 0
                ? Math.min(100, Math.round(((goal.current_count || 0) / goal.target_count) * 100))
                : 0

              return (
                <PanelCard key={goal.id} className="space-y-2">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="truncate text-sm font-medium text-gray-900 dark:text-gray-100">{goal.name}</div>
                      <div className="text-xs text-gray-500 dark:text-gray-400">
                        {(goal.current_count || 0).toLocaleString()} / {(goal.target_count || 0).toLocaleString()}
                      </div>
                    </div>
                    <PanelPill>{progress}%</PanelPill>
                  </div>
                  <div className="h-2 overflow-hidden rounded-full bg-gray-200 dark:bg-gray-700">
                    <div
                      className="h-full rounded-full bg-blue-600 transition-all dark:bg-blue-400"
                      style={{ width: `${progress}%` }}
                    />
                  </div>
                </PanelCard>
              )
            })
          )}
        </div>
      </PanelBody>
    </PanelFrame>
  )
}
