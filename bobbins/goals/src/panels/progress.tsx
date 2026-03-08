import { useState, useEffect, useMemo } from 'react'
import { BobbinrySDK, PanelActions } from '@bobbinry/sdk'

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
      <PanelActions>
        <button
          onClick={openDashboard}
          className="text-xs text-gray-400 hover:text-gray-200"
          title="Open Dashboard"
        >
          📊
        </button>
        <button
          onClick={loadData}
          className="text-xs text-gray-400 hover:text-gray-200"
          title="Refresh"
        >
          ↻
        </button>
      </PanelActions>

      <div className="flex-1 overflow-y-auto p-3 space-y-3">
        {/* Streak */}
        <div className="bg-gray-700/50 rounded-lg p-3 text-center">
          <div className="text-2xl font-bold text-orange-400">{streak?.current_streak || 0}</div>
          <div className="text-xs text-gray-400">Day Streak</div>
        </div>

        {/* Today's Words */}
        <div className="bg-gray-700/50 rounded-lg p-3 text-center">
          <div className="text-xl font-bold text-blue-400">{todayWords.toLocaleString()}</div>
          <div className="text-xs text-gray-400">Words Today</div>
        </div>

        {/* Active Goals */}
        {goals.length > 0 && (
          <div className="space-y-2">
            <div className="text-xs text-gray-400 uppercase tracking-wide">Active Goals</div>
            {goals.map(goal => {
              const progress = goal.target_count > 0
                ? Math.min(100, Math.round(((goal.current_count || 0) / goal.target_count) * 100))
                : 0

              return (
                <div key={goal.id} className="bg-gray-700/50 rounded-lg p-2">
                  <div className="text-xs text-gray-200 truncate mb-1">{goal.name}</div>
                  <div className="w-full bg-gray-600 rounded-full h-2">
                    <div
                      className="bg-blue-500 h-2 rounded-full transition-all"
                      style={{ width: `${progress}%` }}
                    />
                  </div>
                  <div className="text-[10px] text-gray-400 mt-0.5 text-right">{progress}%</div>
                </div>
              )
            })}
          </div>
        )}

        {goals.length === 0 && (
          <div className="text-center text-xs text-gray-500 py-2">
            No active goals
          </div>
        )}
      </div>
    </div>
  )
}
