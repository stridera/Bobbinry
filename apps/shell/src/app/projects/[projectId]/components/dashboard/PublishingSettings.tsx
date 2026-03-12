'use client'

import Link from 'next/link'

interface PublishConfig {
  projectId: string
  publishingMode: string
  defaultVisibility: string
  autoReleaseEnabled: boolean
  releaseFrequency: string
  releaseDay?: string
  releaseTime?: string
  slugPrefix?: string
  seoDescription?: string
  ogImageUrl?: string
  enableComments: boolean
  enableReactions: boolean
  moderationMode: string
}

interface PublishingSettingsProps {
  projectId: string
  config: PublishConfig
  authorUsername?: string | null
  readerSlug?: string | null
}

function formatCadence(config: PublishConfig): string {
  if (!config.autoReleaseEnabled || config.releaseFrequency === 'manual') {
    return 'Manual chapter scheduling'
  }

  const timeLabel = config.releaseTime ? ` at ${config.releaseTime} UTC` : ''

  switch (config.releaseFrequency) {
    case 'daily':
      return `Auto-schedule daily${timeLabel}`
    case 'weekly':
      return `Auto-schedule on ${config.releaseDay || 'selected days'}${timeLabel}`
    case 'biweekly':
      return `Auto-schedule every 2 weeks on ${config.releaseDay || 'selected days'}${timeLabel}`
    case 'monthly':
      return `Auto-schedule monthly on the 1st${timeLabel}`
    default:
      return 'Manual chapter scheduling'
  }
}

export function PublishingSettings({ projectId, config, authorUsername, readerSlug }: PublishingSettingsProps) {
  const isLive = config.publishingMode === 'live'
  const readerUrl = isLive && authorUsername && readerSlug
    ? `/read/${authorUsername}/${readerSlug}`
    : null

  return (
    <div className="bg-white dark:bg-gray-800 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700 animate-fade-in">
      <div className="p-6">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="font-display text-lg font-semibold text-gray-900 dark:text-gray-100">Publishing</h2>
            <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
              Use the Publisher for release cadence, scheduled releases, and chapter-level publishing controls.
            </p>
          </div>
          <span
            className={`inline-flex items-center rounded-full px-2.5 py-1 text-xs font-medium ${
              isLive
                ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300'
                : 'bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-300'
            }`}
          >
            {isLive ? 'Live' : 'Not live'}
          </span>
        </div>

        <div className="mt-5 grid gap-4 md:grid-cols-3">
          <div className="rounded-lg border border-gray-100 bg-gray-50/80 p-4 dark:border-gray-700 dark:bg-gray-900/30">
            <p className="text-xs uppercase tracking-wide text-gray-400 dark:text-gray-500">Reader URL</p>
            {readerUrl ? (
              <Link
                href={readerUrl}
                className="mt-2 block break-all text-sm font-medium text-blue-600 hover:underline dark:text-blue-400"
              >
                {readerUrl}
              </Link>
            ) : (
              <p className="mt-2 text-sm text-gray-600 dark:text-gray-300">
                Publish this project to claim a public reader URL.
              </p>
            )}
          </div>

          <div className="rounded-lg border border-gray-100 bg-gray-50/80 p-4 dark:border-gray-700 dark:bg-gray-900/30">
            <p className="text-xs uppercase tracking-wide text-gray-400 dark:text-gray-500">Release cadence</p>
            <p className="mt-2 text-sm font-medium text-gray-900 dark:text-gray-100">
              {formatCadence(config)}
            </p>
          </div>

          <div className="rounded-lg border border-gray-100 bg-gray-50/80 p-4 dark:border-gray-700 dark:bg-gray-900/30">
            <p className="text-xs uppercase tracking-wide text-gray-400 dark:text-gray-500">Reader experience</p>
            <p className="mt-2 text-sm font-medium text-gray-900 dark:text-gray-100">
              {config.enableComments ? 'Comments on' : 'Comments off'}
              {' '}·{' '}
              {config.enableReactions ? 'Reactions on' : 'Reactions off'}
            </p>
            <p className="mt-1 text-xs text-gray-500 dark:text-gray-400 capitalize">
              Default visibility: {config.defaultVisibility.replace('_', ' ')}
            </p>
          </div>
        </div>

        <div className="mt-5 flex flex-wrap items-center gap-3">
          <Link
            href={`/publish?project=${projectId}`}
            className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-blue-700"
          >
            Open Publisher
          </Link>
          {readerUrl ? (
            <Link
              href={readerUrl}
              className="inline-flex items-center gap-2 rounded-lg border border-gray-200 px-4 py-2 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-50 dark:border-gray-600 dark:text-gray-200 dark:hover:bg-gray-700/50"
            >
              Open Reader
            </Link>
          ) : null}
        </div>
      </div>
    </div>
  )
}
