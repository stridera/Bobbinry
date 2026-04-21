'use client'

import { useState, useEffect, useCallback } from 'react'
import { useSession } from 'next-auth/react'
import { redirect } from 'next/navigation'
import Link from 'next/link'
import { apiFetch } from '@/lib/api'
import { SiteNav } from '@/components/SiteNav'
import { SkeletonPanel } from '@/components/LoadingState'

interface NotificationPrefs {
  emailNewChapter: boolean
  emailNewFollower: boolean
  emailNewSubscriber: boolean
  emailNewComment: boolean
  emailDigestFrequency: 'instant' | 'daily' | 'weekly' | 'never'
  pushNewChapter: boolean
  pushNewComment: boolean
}

interface FollowedProject {
  projectId: string
  muted: boolean
  createdAt: string
  projectName: string
  projectShortUrl: string | null
  authorUsername: string | null
}

const defaultPrefs: NotificationPrefs = {
  emailNewChapter: true,
  emailNewFollower: true,
  emailNewSubscriber: true,
  emailNewComment: true,
  emailDigestFrequency: 'daily',
  pushNewChapter: false,
  pushNewComment: false,
}

function Toggle({
  enabled,
  onToggle,
  label,
  description,
}: {
  enabled: boolean
  onToggle: () => void
  label: string
  description?: string
}) {
  return (
    <div className="flex items-center justify-between py-3">
      <div className="flex-1 min-w-0 pr-4">
        <p className="text-sm font-medium text-gray-900 dark:text-gray-100">{label}</p>
        {description && (
          <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">{description}</p>
        )}
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={enabled}
        onClick={onToggle}
        className={`relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 dark:focus:ring-offset-gray-800 ${
          enabled ? 'bg-blue-600' : 'bg-gray-200 dark:bg-gray-600'
        }`}
      >
        <span
          className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${
            enabled ? 'translate-x-5' : 'translate-x-0'
          }`}
        />
      </button>
    </div>
  )
}

export default function NotificationsSettingsPage() {
  const { data: session, status } = useSession()
  const apiToken = session?.apiToken
  const sessionUserId = session?.user?.id
  const [prefs, setPrefs] = useState<NotificationPrefs>(defaultPrefs)
  const [follows, setFollows] = useState<FollowedProject[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [success, setSuccess] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [togglingMute, setTogglingMute] = useState<string | null>(null)

  const loadData = useCallback(async () => {
    if (!apiToken || !sessionUserId) return
    setLoading(true)
    try {
      const [prefsRes, followsRes] = await Promise.all([
        apiFetch(`/api/users/${sessionUserId}/notification-preferences`, apiToken),
        apiFetch(`/api/users/${sessionUserId}/follows`, apiToken),
      ])

      if (prefsRes.ok) {
        const data = await prefsRes.json()
        setPrefs({ ...defaultPrefs, ...data.preferences })
      }
      if (followsRes.ok) {
        const data = await followsRes.json()
        setFollows(data.follows || [])
      }
    } catch (err) {
      console.error('Failed to load notification settings:', err)
    } finally {
      setLoading(false)
    }
  }, [apiToken, sessionUserId])

  useEffect(() => {
    if (sessionUserId && apiToken) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- initial fetch
      loadData()
    }
  }, [sessionUserId, apiToken, loadData])

  const savePrefs = async (updated: NotificationPrefs) => {
    if (!session?.apiToken || !session?.user?.id) return
    setSaving(true)
    setError(null)
    setSuccess(null)
    try {
      const res = await apiFetch(`/api/users/${session.user.id}/notification-preferences`, session.apiToken, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updated),
      })
      if (res.ok) {
        const data = await res.json()
        setPrefs({ ...defaultPrefs, ...data.preferences })
        setSuccess('Preferences saved')
        setTimeout(() => setSuccess(null), 3000)
      } else {
        const data = await res.json().catch(() => ({}))
        setError(data.error || 'Failed to save preferences')
      }
    } catch {
      setError('Failed to save preferences')
    } finally {
      setSaving(false)
    }
  }

  const togglePref = (key: keyof NotificationPrefs) => {
    const updated = { ...prefs, [key]: !prefs[key] }
    setPrefs(updated)
    savePrefs(updated)
  }

  const setDigestFrequency = (freq: NotificationPrefs['emailDigestFrequency']) => {
    const updated = { ...prefs, emailDigestFrequency: freq }
    setPrefs(updated)
    savePrefs(updated)
  }

  const toggleMute = async (projectId: string, currentMuted: boolean) => {
    if (!session?.apiToken) return
    setTogglingMute(projectId)
    try {
      const res = await apiFetch(`/api/projects/${projectId}/follow`, session.apiToken, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ muted: !currentMuted }),
      })
      if (res.ok) {
        setFollows(prev =>
          prev.map(f => f.projectId === projectId ? { ...f, muted: !currentMuted } : f)
        )
      }
    } catch (err) {
      console.error('Failed to toggle mute:', err)
    } finally {
      setTogglingMute(null)
    }
  }

  if (status === 'loading') {
    return (
      <div className="min-h-screen bg-gray-50 dark:bg-gray-950">
        <SiteNav />
        <header className="bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700">
          <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-4">
            <div className="h-7 bg-gray-100 dark:bg-gray-700 rounded w-48 animate-pulse" />
          </div>
        </header>
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-6">
          <SkeletonPanel />
          <SkeletonPanel />
        </div>
      </div>
    )
  }

  if (!session?.user) {
    redirect('/login')
  }

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-950">
      <SiteNav />

      <header className="bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-4">
          <div className="flex items-center gap-3">
            <Link
              href="/settings"
              className="text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-300 transition-colors"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
              </svg>
            </Link>
            <h1 className="font-display text-2xl font-bold text-gray-900 dark:text-gray-100">Notification Settings</h1>
          </div>
        </div>
      </header>

      <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-6 animate-fade-in">
        {success && (
          <div className="bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-lg p-4">
            <p className="text-sm text-green-700 dark:text-green-300">{success}</p>
          </div>
        )}
        {error && (
          <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-4">
            <p className="text-sm text-red-700 dark:text-red-300">{error}</p>
          </div>
        )}

        {/* Global Email Preferences */}
        <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-200 dark:border-gray-700 p-6">
          <h2 className="font-display text-lg font-semibold text-gray-900 dark:text-gray-100 mb-1">Email Notifications</h2>
          <p className="text-sm text-gray-500 dark:text-gray-400 mb-4">Choose which emails you receive from Bobbinry.</p>

          {loading ? (
            <div className="space-y-4">
              {[1, 2, 3, 4].map(i => (
                <div key={i} className="h-10 bg-gray-100 dark:bg-gray-700 rounded animate-pulse" />
              ))}
            </div>
          ) : (
            <div className="divide-y divide-gray-100 dark:divide-gray-700">
              <Toggle
                enabled={prefs.emailNewChapter}
                onToggle={() => togglePref('emailNewChapter')}
                label="New chapters"
                description="When authors you follow publish new chapters"
              />
              <Toggle
                enabled={prefs.emailNewFollower}
                onToggle={() => togglePref('emailNewFollower')}
                label="New followers"
                description="When someone follows your projects"
              />
              <Toggle
                enabled={prefs.emailNewSubscriber}
                onToggle={() => togglePref('emailNewSubscriber')}
                label="New subscribers"
                description="When someone subscribes to your tiers"
              />
              <Toggle
                enabled={prefs.emailNewComment}
                onToggle={() => togglePref('emailNewComment')}
                label="New comments"
                description="When someone comments on your chapters"
              />

              {/* Digest frequency */}
              <div className="py-3">
                <div className="flex items-center justify-between">
                  <div className="flex-1 min-w-0 pr-4">
                    <p className="text-sm font-medium text-gray-900 dark:text-gray-100">Email digest</p>
                    <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">How often to batch notification emails</p>
                  </div>
                  <select
                    value={prefs.emailDigestFrequency}
                    onChange={e => setDigestFrequency(e.target.value as NotificationPrefs['emailDigestFrequency'])}
                    className="block w-32 rounded-lg border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-900/50 text-gray-900 dark:text-gray-100 text-sm py-2 px-3 focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  >
                    <option value="instant">Instant</option>
                    <option value="daily">Daily</option>
                    <option value="weekly">Weekly</option>
                    <option value="never">Never</option>
                  </select>
                </div>
              </div>
            </div>
          )}

          {saving && (
            <p className="text-xs text-gray-400 dark:text-gray-500 mt-2">Saving...</p>
          )}
        </div>

        {/* Followed Projects */}
        <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-200 dark:border-gray-700 p-6">
          <h2 className="font-display text-lg font-semibold text-gray-900 dark:text-gray-100 mb-1">Followed Projects</h2>
          <p className="text-sm text-gray-500 dark:text-gray-400 mb-4">Mute individual projects to stop email notifications without unfollowing.</p>

          {loading ? (
            <div className="space-y-3">
              {[1, 2, 3].map(i => (
                <div key={i} className="h-12 bg-gray-100 dark:bg-gray-700 rounded animate-pulse" />
              ))}
            </div>
          ) : follows.length === 0 ? (
            <p className="text-sm text-gray-500 dark:text-gray-400 italic">
              You aren&apos;t following any projects yet. Browse the <Link href="/explore" className="text-blue-600 dark:text-blue-400 hover:underline">explore page</Link> to find stories.
            </p>
          ) : (
            <div className="divide-y divide-gray-100 dark:divide-gray-700">
              {follows.map(follow => (
                <div key={follow.projectId} className="flex items-center justify-between py-3">
                  <div className="flex-1 min-w-0 pr-4">
                    <Link
                      href={follow.authorUsername && follow.projectShortUrl
                        ? `/read/${follow.authorUsername}/${follow.projectShortUrl}`
                        : `/read`}
                      className="text-sm font-medium text-gray-900 dark:text-gray-100 hover:text-blue-600 dark:hover:text-blue-400 transition-colors"
                    >
                      {follow.projectName || 'Untitled Project'}
                    </Link>
                  </div>
                  <button
                    type="button"
                    onClick={() => toggleMute(follow.projectId, follow.muted)}
                    disabled={togglingMute === follow.projectId}
                    className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                      follow.muted
                        ? 'bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400 hover:bg-amber-200 dark:hover:bg-amber-900/50'
                        : 'bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-600'
                    } disabled:opacity-50`}
                  >
                    {togglingMute === follow.projectId
                      ? '...'
                      : follow.muted
                        ? 'Muted'
                        : 'Mute'}
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
