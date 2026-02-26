'use client'

import Link from 'next/link'

interface Chapter {
  id: string
  title: string
  order: number
  collectionName: string
  commentCount: number
  reactionCount: number
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
  readerBaseUrl: string | null
}

const STATUS_COLORS: Record<string, string> = {
  draft: 'bg-gray-100 text-gray-700 dark:bg-gray-700 dark:text-gray-300',
  scheduled: 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300',
  published: 'bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300',
  archived: 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300'
}

export function ChapterOverview({ chapters, readerBaseUrl }: ChapterOverviewProps) {
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
              <th className="text-right py-2 pr-4 text-gray-500 dark:text-gray-400 font-medium">
                <span title="Reactions">Reactions</span>
              </th>
              <th className="text-right py-2 text-gray-500 dark:text-gray-400 font-medium">
                <span title="Comments">Comments</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {chapters.map((chapter, i) => {
              const status = chapter.publication?.publishStatus || 'draft'
              const isPublished = status === 'published'
              const chapterUrl = isPublished && readerBaseUrl
                ? `${readerBaseUrl}/${chapter.id}`
                : null

              return (
                <tr key={chapter.id} className="border-b border-gray-100 dark:border-gray-700/50 last:border-0">
                  <td className="py-2.5 pr-4 text-gray-400 dark:text-gray-500 tabular-nums">{i + 1}</td>
                  <td className="py-2.5 pr-4 font-medium">
                    {chapterUrl ? (
                      <Link
                        href={chapterUrl}
                        className="text-blue-600 dark:text-blue-400 hover:text-blue-700 dark:hover:text-blue-300 hover:underline transition-colors"
                      >
                        {chapter.title}
                      </Link>
                    ) : (
                      <span className="text-gray-900 dark:text-gray-100">{chapter.title}</span>
                    )}
                  </td>
                  <td className="py-2.5 pr-4">
                    <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_COLORS[status] || STATUS_COLORS.draft}`}>
                      {status}
                    </span>
                  </td>
                  <td className="py-2.5 pr-4 text-right text-gray-600 dark:text-gray-400 tabular-nums">
                    {chapter.publication?.viewCount?.toLocaleString() ?? '-'}
                  </td>
                  <td className="py-2.5 pr-4 text-right text-gray-600 dark:text-gray-400 tabular-nums">
                    {chapter.reactionCount > 0 ? chapter.reactionCount.toLocaleString() : '-'}
                  </td>
                  <td className="py-2.5 text-right text-gray-600 dark:text-gray-400 tabular-nums">
                    {chapter.commentCount > 0 ? chapter.commentCount.toLocaleString() : '-'}
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
