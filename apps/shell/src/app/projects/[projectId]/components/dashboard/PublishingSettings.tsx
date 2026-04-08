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

export function PublishingSettings({ projectId, config, authorUsername, readerSlug }: PublishingSettingsProps) {
  const isLive = config.publishingMode === 'live'
  const readerUrl = isLive && authorUsername && readerSlug
    ? `/read/${authorUsername}/${readerSlug}`
    : null

  return (
    <div className="bg-white dark:bg-gray-800 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700 p-6 animate-fade-in">
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <h2 className="font-display text-lg font-semibold text-gray-900 dark:text-gray-100">Publishing</h2>
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
        <Link
          href={`/publish/${projectId}`}
          className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-blue-700"
        >
          Open Publisher
        </Link>
      </div>
      {readerUrl && (
        <p className="mt-3 font-mono text-xs text-gray-400 dark:text-gray-500">
          <Link href={readerUrl} className="text-blue-600 hover:underline dark:text-blue-400">
            {readerUrl}
          </Link>
        </p>
      )}
      {!isLive && (
        <p className="mt-3 text-sm text-gray-500 dark:text-gray-400">
          Set up publishing in the Publisher to claim a reader URL and start releasing chapters.
        </p>
      )}
    </div>
  )
}
