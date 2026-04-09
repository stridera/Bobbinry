import { useState, useEffect } from 'react'
import type { BobbinrySDK } from '@bobbinry/sdk'
import { Dialog } from '@bobbinry/ui-components'

interface DashboardViewProps {
  projectId: string
  bobbinId: string
  viewId: string
  sdk: BobbinrySDK
  metadata?: Record<string, any>
}

export default function DashboardView({
  sdk,
  projectId,
}: DashboardViewProps) {
  const [goals, setGoals] = useState<any[]>([])
  const [sessions, setSessions] = useState<any[]>([])
  const [streak, setStreak] = useState<any | null>(null)
  const [loading, setLoading] = useState(true)
  const [logSessionOpen, setLogSessionOpen] = useState(false)

  useEffect(() => {
    loadData()
  }, [])

  async function loadData() {
    try {
      setLoading(true)
      const [goalsRes, sessionsRes, streaksRes] = await Promise.all([
        sdk.entities.query({ collection: 'goals', limit: 1000 }),
        sdk.entities.query({ collection: 'writing_sessions', limit: 1000 }),
        sdk.entities.query({ collection: 'streaks', limit: 1 })
      ])

      setGoals((goalsRes.data as any[]) || [])
      setSessions(((sessionsRes.data as any[]) || []).sort((a, b) =>
        new Date(b.start_time).getTime() - new Date(a.start_time).getTime()
      ))
      const streakData = (streaksRes.data as any[]) || []
      setStreak(streakData[0] || null)
    } catch (err) {
      console.error('[Goals Dashboard] Failed to load:', err)
    } finally {
      setLoading(false)
    }
  }

  function openGoalEditor(goalId?: string) {
    window.dispatchEvent(new CustomEvent('bobbinry:navigate', {
      detail: {
        entityType: 'goals',
        entityId: goalId || 'new',
        bobbinId: 'goals',
        metadata: { view: 'goal-editor', isNew: !goalId }
      }
    }))
  }

  function logQuickSession() {
    setLogSessionOpen(true)
  }

  async function submitQuickSession(value?: string) {
    setLogSessionOpen(false)
    if (!value || isNaN(Number(value))) return
    const wordCount = value

    try {
      await sdk.entities.create('writing_sessions', {
        start_time: new Date().toISOString(),
        end_time: new Date().toISOString(),
        word_count: parseInt(wordCount),
        notes: '',
        goal_id: null,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      })

      // Update active goals
      const activeGoals = goals.filter(g => g.status === 'active')
      for (const goal of activeGoals) {
        const newCount = (goal.current_count || 0) + parseInt(wordCount)
        await sdk.entities.update('goals', goal.id, {
          current_count: newCount,
          status: newCount >= goal.target_count ? 'completed' : 'active',
          updated_at: new Date().toISOString()
        })
      }

      // Update streak
      await updateStreak()
      await loadData()
    } catch (err) {
      console.error('[Goals] Failed to log session:', err)
    }
  }

  async function updateStreak() {
    const today = new Date().toISOString().split('T')[0]

    if (streak) {
      const lastDate = streak.last_writing_date?.split('T')[0]
      const yesterday = new Date(Date.now() - 86400000).toISOString().split('T')[0]

      let newStreak = streak.current_streak || 0
      if (lastDate === today) {
        // Already wrote today
      } else if (lastDate === yesterday) {
        newStreak += 1
      } else {
        newStreak = 1
      }

      await sdk.entities.update('streaks', streak.id, {
        current_streak: newStreak,
        longest_streak: Math.max(newStreak, streak.longest_streak || 0),
        last_writing_date: new Date().toISOString()
      })
    } else {
      await sdk.entities.create('streaks', {
        current_streak: 1,
        longest_streak: 1,
        last_writing_date: new Date().toISOString()
      })
    }
  }

  const activeGoals = goals.filter(g => g.status === 'active')
  const completedGoals = goals.filter(g => g.status === 'completed')
  const totalWords = sessions.reduce((sum, s) => sum + (s.word_count || 0), 0)
  const totalSessions = sessions.length

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
          <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">Goals & Progress</h1>
          <div className="flex gap-2">
            <button
              onClick={logQuickSession}
              className="px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 font-medium text-sm"
            >
              Log Words
            </button>
            <button
              onClick={() => openGoalEditor()}
              className="px-4 py-2 bg-blue-600 dark:bg-blue-700 text-white rounded-lg hover:bg-blue-700 dark:hover:bg-blue-600 font-medium text-sm"
            >
              + New Goal
            </button>
          </div>
        </div>
      </div>

      <div className="flex-1 overflow-auto p-6 space-y-6">
        {/* Streak & Totals */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg p-4">
            <div className="text-3xl font-bold text-orange-500">{streak?.current_streak || 0}</div>
            <div className="text-sm text-gray-600 dark:text-gray-400">Day Streak</div>
          </div>
          <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg p-4">
            <div className="text-3xl font-bold text-purple-500">{streak?.longest_streak || 0}</div>
            <div className="text-sm text-gray-600 dark:text-gray-400">Best Streak</div>
          </div>
          <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg p-4">
            <div className="text-3xl font-bold text-blue-500">{totalWords.toLocaleString()}</div>
            <div className="text-sm text-gray-600 dark:text-gray-400">Total Words</div>
          </div>
          <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg p-4">
            <div className="text-3xl font-bold text-green-500">{totalSessions}</div>
            <div className="text-sm text-gray-600 dark:text-gray-400">Sessions</div>
          </div>
        </div>

        {/* Active Goals */}
        <div>
          <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-3">Active Goals</h2>
          {activeGoals.length === 0 ? (
            <div className="text-center text-gray-500 dark:text-gray-400 py-6 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg">
              <p>No active goals</p>
              <button
                onClick={() => openGoalEditor()}
                className="mt-2 text-sm text-blue-600 dark:text-blue-400 hover:underline"
              >
                Create your first goal
              </button>
            </div>
          ) : (
            <div className="space-y-3">
              {activeGoals.map(goal => {
                const progress = goal.target_count > 0
                  ? Math.min(100, Math.round(((goal.current_count || 0) / goal.target_count) * 100))
                  : 0

                return (
                  <div
                    key={goal.id}
                    onClick={() => openGoalEditor(goal.id)}
                    className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg p-4 cursor-pointer hover:shadow-md transition-shadow"
                  >
                    <div className="flex items-center justify-between mb-2">
                      <h3 className="font-medium text-gray-900 dark:text-gray-100">{goal.name}</h3>
                      <span className="text-sm text-gray-500 dark:text-gray-400">
                        {(goal.current_count || 0).toLocaleString()} / {goal.target_count.toLocaleString()}
                      </span>
                    </div>
                    <div className="w-full bg-gray-200 dark:bg-gray-700 rounded-full h-3">
                      <div
                        className="bg-blue-600 dark:bg-blue-500 h-3 rounded-full transition-all"
                        style={{ width: `${progress}%` }}
                      />
                    </div>
                    <div className="flex items-center justify-between mt-1">
                      <span className="text-xs text-gray-500 dark:text-gray-400 capitalize">{goal.type || 'custom'}</span>
                      <span className="text-xs font-medium text-blue-600 dark:text-blue-400">{progress}%</span>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>

        {/* Completed Goals */}
        {completedGoals.length > 0 && (
          <div>
            <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-3">Completed Goals</h2>
            <div className="space-y-2">
              {completedGoals.map(goal => (
                <div
                  key={goal.id}
                  onClick={() => openGoalEditor(goal.id)}
                  className="bg-white dark:bg-gray-800 border border-green-200 dark:border-green-800 rounded-lg p-3 cursor-pointer hover:shadow-md transition-shadow flex items-center justify-between"
                >
                  <div className="flex items-center gap-2">
                    <span className="text-green-500">✓</span>
                    <span className="text-gray-900 dark:text-gray-100">{goal.name}</span>
                  </div>
                  <span className="text-sm text-gray-500 dark:text-gray-400">
                    {goal.target_count.toLocaleString()} words
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Recent Sessions */}
        <div>
          <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-3">Recent Sessions</h2>
          {sessions.length === 0 ? (
            <div className="text-center text-gray-500 dark:text-gray-400 py-6 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg">
              No writing sessions logged yet
            </div>
          ) : (
            <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg divide-y divide-gray-200 dark:divide-gray-700">
              {sessions.slice(0, 10).map(session => (
                <div key={session.id} className="p-3 flex items-center justify-between">
                  <div>
                    <span className="text-sm text-gray-900 dark:text-gray-100 font-medium">
                      {session.word_count.toLocaleString()} words
                    </span>
                    {session.notes && (
                      <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">{session.notes}</p>
                    )}
                  </div>
                  <span className="text-xs text-gray-500 dark:text-gray-400">
                    {new Date(session.start_time).toLocaleDateString()}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
      <Dialog
        open={logSessionOpen}
        title="Log a writing session"
        message="How many words did you write?"
        inputType="number"
        inputPlaceholder="500"
        confirmLabel="Log"
        onConfirm={submitQuickSession}
        onCancel={() => setLogSessionOpen(false)}
      />
    </div>
  )
}
