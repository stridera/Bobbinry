'use client'

import { useEffect, useState } from 'react'
import { BobbinrySDK } from '@bobbinry/sdk'

interface TierDelay {
  id: string
  name: string
  tierLevel: number
  delayDays: number
}

interface PublishScheduleConfig {
  autoReleaseEnabled: boolean
  releaseFrequency: string
  releaseDays: string[]
  releaseTime: string
}

type ReleaseTimeMode = 'utc' | 'local'

interface ReleaseConfigProps {
  sdk: BobbinrySDK
  projectId: string
}

const DAY_OPTIONS = [
  { code: 'mon', label: 'Mon' },
  { code: 'tue', label: 'Tue' },
  { code: 'wed', label: 'Wed' },
  { code: 'thu', label: 'Thu' },
  { code: 'fri', label: 'Fri' },
  { code: 'sat', label: 'Sat' },
  { code: 'sun', label: 'Sun' },
]

const FREQUENCIES = [
  { value: 'manual', label: 'Manual only' },
  { value: 'daily', label: 'Daily' },
  { value: 'weekly', label: 'Selected weekdays' },
  { value: 'biweekly', label: 'Every 2 weeks' },
  { value: 'monthly', label: 'Monthly (1st)' },
]

function parseReleaseDays(value?: string | null): string[] {
  if (!value) return ['mon']
  return value
    .split(',')
    .map((part) => part.trim().toLowerCase())
    .filter((part) => DAY_OPTIONS.some((day) => day.code === part))
}

function padTime(value: number): string {
  return String(value).padStart(2, '0')
}

function convertUtcTimeToLocalTime(utcTime: string): string {
  const [hours, minutes] = utcTime.split(':').map(Number)
  if (Number.isNaN(hours) || Number.isNaN(minutes)) return utcTime

  const now = new Date()
  const localDate = new Date(Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    now.getUTCDate(),
    hours,
    minutes,
  ))

  return `${padTime(localDate.getHours())}:${padTime(localDate.getMinutes())}`
}

function convertLocalTimeToUtcTime(localTime: string): string {
  const [hours, minutes] = localTime.split(':').map(Number)
  if (Number.isNaN(hours) || Number.isNaN(minutes)) return localTime

  const now = new Date()
  const localDate = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate(),
    hours,
    minutes,
    0,
    0,
  )

  return `${padTime(localDate.getUTCHours())}:${padTime(localDate.getUTCMinutes())}`
}

export default function ReleaseConfig({ sdk, projectId }: ReleaseConfigProps) {
  const [scheduleConfig, setScheduleConfig] = useState<PublishScheduleConfig>({
    autoReleaseEnabled: false,
    releaseFrequency: 'manual',
    releaseDays: ['mon', 'wed', 'fri'],
    releaseTime: '12:00',
  })
  const [tierDelays, setTierDelays] = useState<TierDelay[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null)
  const [releaseTimeMode, setReleaseTimeMode] = useState<ReleaseTimeMode>('local')

  useEffect(() => {
    void loadSettings()
  }, [projectId])

  useEffect(() => {
    const storedMode = window.localStorage.getItem('bobbinry.publisher.release-time-mode')
    if (storedMode === 'utc' || storedMode === 'local') {
      setReleaseTimeMode(storedMode)
    }
  }, [])

  useEffect(() => {
    window.localStorage.setItem('bobbinry.publisher.release-time-mode', releaseTimeMode)
  }, [releaseTimeMode])

  const loadSettings = async () => {
    setLoading(true)

    try {
      const [publishConfigRes, projectResult] = await Promise.all([
        fetch(`${sdk.api.apiBaseUrl}/projects/${projectId}/publish-config`, {
          headers: sdk.api.getAuthHeaders()
        }),
        sdk.api.getProject(projectId)
      ])

      if (publishConfigRes.ok) {
        const publishConfigData = await publishConfigRes.json()
        const config = publishConfigData.config || {}
        setScheduleConfig({
          autoReleaseEnabled: !!config.autoReleaseEnabled,
          releaseFrequency: config.releaseFrequency || 'manual',
          releaseDays: parseReleaseDays(config.releaseDay || 'mon,wed,fri'),
          releaseTime: config.releaseTime || '12:00',
        })
      }

      const ownerId = projectResult?.project?.ownerId
      if (ownerId) {
        const tiersResult = await sdk.publishing.getAuthorTiers(ownerId)
        const tiers = Array.isArray(tiersResult.tiers) ? tiersResult.tiers : []
        setTierDelays(
          tiers
            .filter((tier: any) => tier?.isActive !== false)
            .map((tier: any) => ({
              id: tier.id,
              name: tier.name || `Tier ${tier.tierLevel}`,
              tierLevel: Number(tier.tierLevel) || 0,
              delayDays: Number(tier.chapterDelayDays) || 0,
            }))
            .sort((a: TierDelay, b: TierDelay) => a.tierLevel - b.tierLevel)
        )
      } else {
        setTierDelays([])
      }
    } catch (err) {
      console.error('Failed to load release settings:', err)
    } finally {
      setLoading(false)
    }
  }

  const toggleReleaseDay = (dayCode: string) => {
    setScheduleConfig((current) => {
      const alreadySelected = current.releaseDays.includes(dayCode)
      if (alreadySelected && current.releaseDays.length === 1) {
        return current
      }

      return {
        ...current,
        releaseDays: alreadySelected
          ? current.releaseDays.filter((value) => value !== dayCode)
          : [...current.releaseDays, dayCode]
      }
    })
  }

  const save = async () => {
    setSaving(true)
    setMessage(null)

    try {
      const releaseDay = scheduleConfig.releaseDays.join(',')

      const publishConfigResponse = await fetch(`${sdk.api.apiBaseUrl}/projects/${projectId}/publish-config`, {
        method: 'PUT',
        headers: sdk.api.getAuthHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({
          autoReleaseEnabled: scheduleConfig.autoReleaseEnabled,
          releaseFrequency: scheduleConfig.releaseFrequency,
          releaseDay,
          releaseTime: scheduleConfig.releaseTime,
        })
      })

      if (!publishConfigResponse.ok) {
        const errorData = await publishConfigResponse.json().catch(() => ({ error: 'Failed to save publish schedule' }))
        throw new Error(errorData.error || 'Failed to save publish schedule')
      }

      setMessage({ type: 'success', text: 'Release settings saved.' })
      setTimeout(() => setMessage(null), 3000)
    } catch (err: any) {
      setMessage({ type: 'error', text: err.message || 'Failed to save release settings' })
    } finally {
      setSaving(false)
    }
  }

  if (loading) {
    return <div className="p-6 text-gray-500 dark:text-gray-400">Loading release settings...</div>
  }

  const releaseTimeInputValue = releaseTimeMode === 'utc'
    ? scheduleConfig.releaseTime
    : convertUtcTimeToLocalTime(scheduleConfig.releaseTime)

  return (
    <div className="p-6">
      <div className="mb-6">
        <h2 className="text-xl font-semibold text-gray-900 dark:text-gray-100">Release Settings</h2>
        <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
          Set the project-wide cadence for automatic chapter scheduling and scheduled releases.
        </p>
      </div>

      {message ? (
        <div className={`mb-4 rounded p-3 text-sm ${
          message.type === 'success'
            ? 'bg-green-50 text-green-700 dark:bg-green-900/20 dark:text-green-300'
            : 'bg-red-50 text-red-700 dark:bg-red-900/20 dark:text-red-300'
        }`}>
          {message.text}
        </div>
      ) : null}

      <div className="space-y-6">
        <div className="rounded-xl border border-gray-200 bg-gray-50/80 p-4 dark:border-gray-700 dark:bg-gray-900/30">
          <div className="mb-4">
            <h3 className="text-sm font-medium text-gray-900 dark:text-gray-100">Auto-schedule completed chapters</h3>
            <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
              When enabled, completed manuscript chapters are scheduled into the next open release slot automatically.
            </p>
          </div>

          <label className="flex items-center gap-3">
            <input
              type="checkbox"
              checked={scheduleConfig.autoReleaseEnabled}
              onChange={(event) => setScheduleConfig((current) => ({
                ...current,
                autoReleaseEnabled: event.target.checked,
                releaseFrequency: event.target.checked && current.releaseFrequency === 'manual'
                  ? 'weekly'
                  : current.releaseFrequency,
              }))}
              className="rounded border-gray-300 dark:border-gray-600"
            />
            <span className="text-sm text-gray-700 dark:text-gray-300">
              Automatically assign the next release date when a chapter is marked complete
            </span>
          </label>

          <div className="mt-4">
            <label className="mb-2 block text-sm font-medium text-gray-700 dark:text-gray-300">
              Release cadence
            </label>
            <div className="space-y-2">
              {FREQUENCIES.map((frequency) => (
                <button
                  key={frequency.value}
                  onClick={() => setScheduleConfig((current) => ({
                    ...current,
                    releaseFrequency: frequency.value,
                    autoReleaseEnabled: frequency.value === 'manual' ? false : current.autoReleaseEnabled,
                  }))}
                  className={`flex w-full items-start justify-between gap-3 rounded-lg border px-3 py-3 text-left text-sm transition-colors ${
                    scheduleConfig.releaseFrequency === frequency.value
                      ? 'border-blue-500 bg-blue-50 text-blue-700 dark:bg-blue-950/30 dark:text-blue-300'
                      : 'border-gray-200 text-gray-600 hover:bg-gray-50 dark:border-gray-700 dark:text-gray-400 dark:hover:bg-gray-900/30'
                  }`}
                >
                  <span className="min-w-0">
                    <span className="block font-medium">{frequency.label}</span>
                    <span className="mt-0.5 block text-xs text-gray-500 dark:text-gray-400">
                      {frequency.value === 'manual'
                        ? 'No automatic scheduling. Manage each chapter yourself.'
                        : frequency.value === 'daily'
                          ? 'Assign each completed chapter to the next daily release slot.'
                          : frequency.value === 'weekly'
                            ? 'Use selected weekdays like Mon, Wed, and Fri.'
                            : frequency.value === 'biweekly'
                              ? 'Use selected weekdays on an every-other-week cadence.'
                              : 'Release on the first day of each month.'}
                    </span>
                  </span>
                  <span
                    className={`mt-0.5 h-4 w-4 flex-shrink-0 rounded-full border ${
                      scheduleConfig.releaseFrequency === frequency.value
                        ? 'border-blue-500 bg-blue-500'
                        : 'border-gray-300 dark:border-gray-600'
                    }`}
                  />
                </button>
              ))}
            </div>
          </div>

          {scheduleConfig.releaseFrequency === 'weekly' || scheduleConfig.releaseFrequency === 'biweekly' ? (
            <div className="mt-4">
              <label className="mb-2 block text-sm font-medium text-gray-700 dark:text-gray-300">
                Release days
              </label>
              <div className="flex flex-wrap gap-2">
                {DAY_OPTIONS.map((day) => {
                  const selected = scheduleConfig.releaseDays.includes(day.code)
                  return (
                    <button
                      key={day.code}
                      onClick={() => toggleReleaseDay(day.code)}
                      className={`rounded-full border px-3 py-1.5 text-xs font-medium transition-colors ${
                        selected
                          ? 'border-blue-500 bg-blue-50 text-blue-700 dark:bg-blue-950/30 dark:text-blue-300'
                          : 'border-gray-200 text-gray-600 hover:bg-gray-100 dark:border-gray-700 dark:text-gray-400 dark:hover:bg-gray-800/70'
                      }`}
                    >
                      {day.label}
                    </button>
                  )
                })}
              </div>
            </div>
          ) : null}

          <div className="mt-4 max-w-xs">
            <div className="mb-2 flex items-center justify-between gap-3">
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">Release time</label>
              <div className="inline-flex rounded-lg border border-gray-200 bg-white p-1 dark:border-gray-700 dark:bg-gray-900/40">
                <button
                  type="button"
                  onClick={() => setReleaseTimeMode('local')}
                  className={`rounded-md px-2.5 py-1 text-xs font-medium transition-colors ${
                    releaseTimeMode === 'local'
                      ? 'bg-blue-600 text-white'
                      : 'text-gray-500 hover:bg-gray-50 dark:text-gray-400 dark:hover:bg-gray-800'
                  }`}
                >
                  Local
                </button>
                <button
                  type="button"
                  onClick={() => setReleaseTimeMode('utc')}
                  className={`rounded-md px-2.5 py-1 text-xs font-medium transition-colors ${
                    releaseTimeMode === 'utc'
                      ? 'bg-blue-600 text-white'
                      : 'text-gray-500 hover:bg-gray-50 dark:text-gray-400 dark:hover:bg-gray-800'
                  }`}
                >
                  UTC
                </button>
              </div>
            </div>
            <input
              type="time"
              value={releaseTimeInputValue}
              onChange={(event) => setScheduleConfig((current) => ({
                ...current,
                releaseTime: releaseTimeMode === 'utc'
                  ? event.target.value
                  : convertLocalTimeToUtcTime(event.target.value),
              }))}
              className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900 dark:border-gray-600 dark:bg-gray-900/50 dark:text-gray-100"
            />
            <p className="mt-2 text-xs text-gray-500 dark:text-gray-400">
              {releaseTimeMode === 'utc'
                ? 'Editing the canonical UTC release time.'
                : 'Editing in your current browser local time. The schedule is still stored in UTC.'}
            </p>
          </div>

          <p className="mt-3 text-xs text-gray-500 dark:text-gray-400">
            Scheduled chapters are placed into the next free slot, so a Mon/Wed/Fri cadence can queue an entire finished book automatically.
          </p>
        </div>

        <div className="rounded-xl border border-gray-200 bg-gray-50/80 p-4 dark:border-gray-700 dark:bg-gray-900/30">
          <div className="mb-2 flex items-center justify-between gap-4">
            <div>
              <h3 className="text-sm font-medium text-gray-900 dark:text-gray-100">Subscriber Access Timing</h3>
              <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                These delays come from your monetization tiers and are enforced by the reader.
              </p>
            </div>
            <a
              href="/settings/monetization"
              className="text-xs text-blue-600 hover:underline dark:text-blue-400"
            >
              Edit tiers
            </a>
          </div>

          {tierDelays.length === 0 ? (
            <p className="text-sm italic text-gray-400 dark:text-gray-500">
              No active subscription tiers yet. Published chapters will be public immediately.
            </p>
          ) : (
            <div className="space-y-2">
              {tierDelays.map((tier) => (
                <div
                  key={tier.id}
                  className="flex items-center justify-between rounded-lg bg-white px-3 py-2 text-sm dark:bg-gray-800/70"
                >
                  <div className="min-w-0">
                    <div className="font-medium text-gray-900 dark:text-gray-100">
                      Level {tier.tierLevel}: {tier.name}
                    </div>
                  </div>
                  <div className="text-xs text-gray-500 dark:text-gray-400">
                    {tier.delayDays === 0 ? 'Immediate access' : `${tier.delayDays} day delay`}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

      </div>

      <div className="mt-6 flex justify-end">
        <button
          onClick={save}
          disabled={saving}
          className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {saving ? 'Saving…' : 'Save Settings'}
        </button>
      </div>
    </div>
  )
}
