'use client'

/**
 * Analytics Detail Panel
 *
 * Shows per-chapter analytics breakdown: device distribution,
 * reading progress buckets, and top referrers.
 * Contributed to shell.publishDashboard below publish-manager.
 */

import { useState, useEffect, useCallback } from 'react'

interface AnalyticsDetailProps {
  projectId: string
  apiToken?: string
  selectedChapterId?: string | null
  context?: {
    projectId: string
    apiToken?: string
    selectedChapterId?: string | null
  }
}

interface ChapterAnalytics {
  totalViews: number
  uniqueReaders: number
  completions: number
  completionRate: string
  avgReadTimeSeconds: number
  firstPublishedAt?: string
  lastPublishedAt?: string
}

interface AnalyticsBreakdown {
  devices: Record<string, number>
  progress: Record<string, number>
  referrers: Array<{ referrer: string; count: number }>
}

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000'

async function apiFetchLocal(path: string, token: string) {
  return fetch(`${API_URL}${path}`, {
    headers: { Authorization: `Bearer ${token}` },
  })
}

function formatReadTime(seconds: number): string {
  if (seconds < 60) return `${seconds}s`
  const minutes = Math.floor(seconds / 60)
  const secs = seconds % 60
  return secs > 0 ? `${minutes}m ${secs}s` : `${minutes}m`
}

function HorizontalBar({ value, max, color, label, count }: {
  value: number
  max: number
  color: string
  label: string
  count: number
}) {
  const pct = max > 0 ? (value / max) * 100 : 0
  return (
    <div className="flex items-center gap-2 py-0.5">
      <span className="text-[11px] text-gray-500 dark:text-gray-400 w-16 text-right flex-shrink-0">
        {label}
      </span>
      <div className="flex-1 h-3 bg-gray-100 dark:bg-gray-800 rounded-full overflow-hidden">
        <div
          className={`h-full rounded-full transition-all duration-500 ${color}`}
          style={{ width: `${Math.max(pct, pct > 0 ? 2 : 0)}%` }}
        />
      </div>
      <span className="text-[11px] text-gray-500 dark:text-gray-400 w-8 text-right tabular-nums flex-shrink-0">
        {count}
      </span>
    </div>
  )
}

function DeviceBar({ devices }: { devices: Record<string, number> }) {
  const total = Object.values(devices).reduce((s, c) => s + c, 0)
  if (total === 0) return <p className="text-xs text-gray-400 dark:text-gray-500">No data yet</p>

  const colors: Record<string, string> = {
    desktop: 'bg-blue-400 dark:bg-blue-500',
    mobile: 'bg-teal-400 dark:bg-teal-500',
    tablet: 'bg-amber-400 dark:bg-amber-500',
    unknown: 'bg-gray-300 dark:bg-gray-600',
  }

  const entries = Object.entries(devices).sort((a, b) => b[1] - a[1])

  return (
    <div>
      {/* Stacked bar */}
      <div className="h-4 bg-gray-100 dark:bg-gray-800 rounded-full overflow-hidden flex">
        {entries.map(([type, count]) => (
          <div
            key={type}
            className={`h-full ${colors[type] || colors.unknown} transition-all duration-500`}
            style={{ width: `${(count / total) * 100}%` }}
            title={`${type}: ${count}`}
          />
        ))}
      </div>
      {/* Legend */}
      <div className="flex flex-wrap gap-3 mt-1.5">
        {entries.map(([type, count]) => (
          <span key={type} className="flex items-center gap-1 text-[11px] text-gray-500 dark:text-gray-400">
            <span className={`w-2 h-2 rounded-full ${colors[type] || colors.unknown}`} />
            {type} ({count})
          </span>
        ))}
      </div>
    </div>
  )
}

export default function AnalyticsDetailPanel(props: AnalyticsDetailProps) {
  const projectId = props.projectId || props.context?.projectId
  const apiToken = props.apiToken || props.context?.apiToken
  const selectedChapterId = props.selectedChapterId ?? props.context?.selectedChapterId

  const [analytics, setAnalytics] = useState<ChapterAnalytics | null>(null)
  const [breakdown, setBreakdown] = useState<AnalyticsBreakdown | null>(null)
  const [loading, setLoading] = useState(false)

  const loadData = useCallback(async () => {
    if (!projectId || !apiToken || !selectedChapterId) return
    setLoading(true)

    try {
      const [analyticsRes, breakdownRes] = await Promise.all([
        apiFetchLocal(`/api/projects/${projectId}/chapters/${selectedChapterId}/analytics`, apiToken),
        apiFetchLocal(`/api/projects/${projectId}/chapters/${selectedChapterId}/analytics/breakdown`, apiToken),
      ])

      if (analyticsRes.ok) {
        const data = await analyticsRes.json()
        setAnalytics(data.analytics)
      }

      if (breakdownRes.ok) {
        const data = await breakdownRes.json()
        setBreakdown(data.breakdown)
      }
    } catch (err) {
      console.error('AnalyticsDetailPanel: Failed to load data', err)
    } finally {
      setLoading(false)
    }
  }, [projectId, apiToken, selectedChapterId])

  useEffect(() => {
    if (selectedChapterId) {
      loadData()
    } else {
      setAnalytics(null)
      setBreakdown(null)
    }
  }, [selectedChapterId, loadData])

  if (!selectedChapterId) {
    return (
      <div className="px-5 py-4">
        <p className="text-xs text-gray-400 dark:text-gray-500 text-center py-2">
          Click a chapter above for detailed analytics
        </p>
      </div>
    )
  }

  if (loading) {
    return (
      <div className="px-5 py-4">
        <div className="space-y-3 animate-pulse">
          <div className="h-3 w-32 bg-gray-100 dark:bg-gray-800 rounded" />
          <div className="grid grid-cols-5 gap-2">
            {[...Array(5)].map((_, i) => (
              <div key={i} className="h-12 bg-gray-100 dark:bg-gray-800 rounded-lg" />
            ))}
          </div>
          <div className="h-20 bg-gray-100 dark:bg-gray-800 rounded-lg" />
        </div>
      </div>
    )
  }

  if (!analytics) return null

  const publishedDate = analytics.firstPublishedAt
    ? new Date(analytics.firstPublishedAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
    : null

  const progressMax = breakdown
    ? Math.max(...Object.values(breakdown.progress), 1)
    : 1

  const progressLabels: Record<string, string> = {
    '0-25': '0-25%',
    '25-50': '25-50%',
    '50-75': '50-75%',
    '75-100': '75-100%',
    completed: 'Finished',
  }

  const progressColors: Record<string, string> = {
    '0-25': 'bg-red-300 dark:bg-red-500',
    '25-50': 'bg-orange-300 dark:bg-orange-500',
    '50-75': 'bg-yellow-300 dark:bg-yellow-500',
    '75-100': 'bg-blue-300 dark:bg-blue-500',
    completed: 'bg-green-400 dark:bg-green-500',
  }

  return (
    <div className="px-5 py-4 space-y-4 border-t border-gray-100 dark:border-gray-800">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h4 className="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
          Chapter Analytics
        </h4>
        {publishedDate && (
          <span className="text-[11px] text-gray-400 dark:text-gray-500">
            Published {publishedDate}
          </span>
        )}
      </div>

      {/* Stats row */}
      <div className="grid grid-cols-5 gap-2">
        <div className="bg-gray-50 dark:bg-gray-800/50 rounded-lg p-2.5 border border-gray-100 dark:border-gray-700/50">
          <div className="text-base font-semibold text-gray-900 dark:text-gray-100 tabular-nums leading-tight">
            {analytics.totalViews?.toLocaleString() ?? 0}
          </div>
          <div className="text-[10px] text-gray-500 dark:text-gray-400 mt-0.5">views</div>
        </div>
        <div className="bg-gray-50 dark:bg-gray-800/50 rounded-lg p-2.5 border border-gray-100 dark:border-gray-700/50">
          <div className="text-base font-semibold text-gray-900 dark:text-gray-100 tabular-nums leading-tight">
            {analytics.uniqueReaders?.toLocaleString() ?? 0}
          </div>
          <div className="text-[10px] text-gray-500 dark:text-gray-400 mt-0.5">readers</div>
        </div>
        <div className="bg-gray-50 dark:bg-gray-800/50 rounded-lg p-2.5 border border-gray-100 dark:border-gray-700/50">
          <div className="text-base font-semibold text-gray-900 dark:text-gray-100 tabular-nums leading-tight">
            {analytics.completions?.toLocaleString() ?? 0}
          </div>
          <div className="text-[10px] text-gray-500 dark:text-gray-400 mt-0.5">completions</div>
        </div>
        <div className="bg-gray-50 dark:bg-gray-800/50 rounded-lg p-2.5 border border-gray-100 dark:border-gray-700/50">
          <div className="text-base font-semibold text-gray-900 dark:text-gray-100 tabular-nums leading-tight">
            {analytics.completionRate ?? 0}%
          </div>
          <div className="text-[10px] text-gray-500 dark:text-gray-400 mt-0.5">finish rate</div>
        </div>
        <div className="bg-gray-50 dark:bg-gray-800/50 rounded-lg p-2.5 border border-gray-100 dark:border-gray-700/50">
          <div className="text-base font-semibold text-gray-900 dark:text-gray-100 tabular-nums leading-tight">
            {analytics.avgReadTimeSeconds ? formatReadTime(analytics.avgReadTimeSeconds) : '-'}
          </div>
          <div className="text-[10px] text-gray-500 dark:text-gray-400 mt-0.5">avg time</div>
        </div>
      </div>

      {breakdown && (
        <div className="grid grid-cols-2 gap-4">
          {/* Device breakdown */}
          <div>
            <h5 className="text-[11px] font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-2">
              Devices
            </h5>
            <DeviceBar devices={breakdown.devices} />
          </div>

          {/* Reading progress */}
          <div>
            <h5 className="text-[11px] font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-2">
              Reading Progress
            </h5>
            <div className="space-y-0.5">
              {['0-25', '25-50', '50-75', '75-100', 'completed'].map(bucket => (
                <HorizontalBar
                  key={bucket}
                  value={breakdown.progress[bucket] || 0}
                  max={progressMax}
                  color={progressColors[bucket] || 'bg-gray-300'}
                  label={progressLabels[bucket] || bucket}
                  count={breakdown.progress[bucket] || 0}
                />
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Referrers */}
      {breakdown && breakdown.referrers.length > 0 && (
        <div>
          <h5 className="text-[11px] font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-1.5">
            Top Referrers
          </h5>
          <div className="space-y-1">
            {breakdown.referrers.map((r, i) => (
              <div key={i} className="flex items-center justify-between py-0.5">
                <span className="text-xs text-gray-700 dark:text-gray-300 truncate">
                  {r.referrer}
                </span>
                <span className="text-[11px] text-gray-400 dark:text-gray-500 tabular-nums ml-2 flex-shrink-0">
                  {r.count}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
