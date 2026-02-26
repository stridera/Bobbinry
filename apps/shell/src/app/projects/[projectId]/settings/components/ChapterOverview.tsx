'use client'

interface Chapter {
  id: string
  title: string
  order: number
  collectionName: string
  publication: {
    publishStatus: string
    publishedAt: string | null
    viewCount: number
    uniqueViewCount: number
    completionCount: number
    avgReadTimeSeconds: number | null
  } | null
}

interface ChapterOverviewProps {
  chapters: Chapter[]
}

const STATUS_COLORS: Record<string, string> = {
  draft: 'bg-gray-100 text-gray-700 dark:bg-gray-700 dark:text-gray-300',
  scheduled: 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300',
  published: 'bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300',
  archived: 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300'
}

function formatReadTime(seconds: number | null): string {
  if (!seconds) return '-'
  if (seconds < 60) return `${seconds}s`
  const mins = Math.round(seconds / 60)
  return `${mins}m`
}

export function ChapterOverview({ chapters }: ChapterOverviewProps) {
  if (chapters.length === 0) {
    return (
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700 p-6 animate-fade-in">
        <h2 className="font-display text-lg font-semibold text-gray-900 dark:text-gray-100 mb-4">Chapters</h2>
        <p className="text-sm text-gray-500 dark:text-gray-400 italic">No chapters yet. Start writing to see them here.</p>
      </div>
    )
  }

  return (
    <div className="bg-white dark:bg-gray-800 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700 p-6 animate-fade-in">
      <h2 className="font-display text-lg font-semibold text-gray-900 dark:text-gray-100 mb-4">Chapters</h2>
      <div className="overflow-x-auto -mx-6 px-6">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-200 dark:border-gray-700">
              <th className="text-left py-2 pr-4 text-gray-500 dark:text-gray-400 font-medium">#</th>
              <th className="text-left py-2 pr-4 text-gray-500 dark:text-gray-400 font-medium">Title</th>
              <th className="text-left py-2 pr-4 text-gray-500 dark:text-gray-400 font-medium">Status</th>
              <th className="text-right py-2 pr-4 text-gray-500 dark:text-gray-400 font-medium">Views</th>
              <th className="text-right py-2 pr-4 text-gray-500 dark:text-gray-400 font-medium">Completions</th>
              <th className="text-right py-2 text-gray-500 dark:text-gray-400 font-medium">Avg Read</th>
            </tr>
          </thead>
          <tbody>
            {chapters.map((chapter, i) => {
              const status = chapter.publication?.publishStatus || 'draft'
              return (
                <tr key={chapter.id} className="border-b border-gray-100 dark:border-gray-700/50 last:border-0">
                  <td className="py-2.5 pr-4 text-gray-400 dark:text-gray-500 tabular-nums">{i + 1}</td>
                  <td className="py-2.5 pr-4 text-gray-900 dark:text-gray-100 font-medium">{chapter.title}</td>
                  <td className="py-2.5 pr-4">
                    <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_COLORS[status] || STATUS_COLORS.draft}`}>
                      {status}
                    </span>
                  </td>
                  <td className="py-2.5 pr-4 text-right text-gray-600 dark:text-gray-400 tabular-nums">
                    {chapter.publication?.viewCount?.toLocaleString() ?? '-'}
                  </td>
                  <td className="py-2.5 pr-4 text-right text-gray-600 dark:text-gray-400 tabular-nums">
                    {chapter.publication?.completionCount?.toLocaleString() ?? '-'}
                  </td>
                  <td className="py-2.5 text-right text-gray-600 dark:text-gray-400 tabular-nums">
                    {formatReadTime(chapter.publication?.avgReadTimeSeconds ?? null)}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}
