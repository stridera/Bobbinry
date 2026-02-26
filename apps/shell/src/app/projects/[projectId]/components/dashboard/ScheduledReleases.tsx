'use client'

interface ScheduledRelease {
  chapterId: string
  chapterTitle: string
  scheduledDate: string | null
  publishStatus: string
}

interface ScheduledReleasesProps {
  releases: ScheduledRelease[]
}

export function ScheduledReleases({ releases }: ScheduledReleasesProps) {
  if (releases.length === 0) return null

  return (
    <div className="bg-white dark:bg-gray-800 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700 p-6 animate-fade-in">
      <h2 className="font-display text-lg font-semibold text-gray-900 dark:text-gray-100 mb-4">Scheduled Releases</h2>
      <div className="space-y-3">
        {releases.map((release) => (
          <div
            key={release.chapterId}
            className="flex items-center justify-between p-3 bg-amber-50 dark:bg-amber-900/10 border border-amber-200 dark:border-amber-800/30 rounded-lg"
          >
            <div>
              <p className="text-sm font-medium text-gray-900 dark:text-gray-100">{release.chapterTitle}</p>
              <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                {release.scheduledDate
                  ? new Date(release.scheduledDate).toLocaleDateString('en-US', {
                      weekday: 'short',
                      month: 'short',
                      day: 'numeric',
                      year: 'numeric',
                      hour: 'numeric',
                      minute: '2-digit'
                    })
                  : 'Date pending'}
              </p>
            </div>
            <span className="inline-block px-2 py-0.5 rounded-full text-xs font-medium bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300">
              {release.publishStatus}
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}
