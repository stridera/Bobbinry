'use client'

import Link from 'next/link'

interface ActivityChapter {
  id: string
  slug?: string | null
  title: string
  archivedAt: string | null
  commentCount: number
  reactionCount: number
  annotationCount: number
  publication: {
    publishStatus: string
    viewCount: number
  } | null
}

interface ReaderActivityProps {
  projectId: string
  chapters: ActivityChapter[]
  isLive: boolean
  enableAnnotations: boolean
  hasAnnotationInbox: boolean
  annotationStats?: {
    open: number
    acknowledged: number
    resolved: number
    total: number
  } | undefined
  /** Public reader URL for the project, or null when it has none yet. */
  readerBaseUrl: string | null
}

const MAX_ROWS = 5

/**
 * What readers are doing with the manuscript. Phase 1 works from the counts
 * the dashboard already carries per chapter; a recent-activity feed (latest
 * comments and annotations) is the planned follow-up once the API serves it.
 */
export function ReaderActivity({
  projectId,
  chapters,
  isLive,
  enableAnnotations,
  hasAnnotationInbox,
  annotationStats,
  readerBaseUrl,
}: ReaderActivityProps) {
  const active = chapters.filter(c => !c.archivedAt)
  const totalComments = active.reduce((sum, c) => sum + c.commentCount, 0)
  const commentedChapters = active.filter(c => c.commentCount > 0).length
  const openFeedback = (annotationStats?.open ?? 0) + (annotationStats?.acknowledged ?? 0)
  const resolvedFeedback = annotationStats?.resolved ?? 0

  const discussed = active
    .filter(c => c.commentCount + c.reactionCount + c.annotationCount > 0)
    .sort((a, b) =>
      (b.commentCount + b.annotationCount) - (a.commentCount + a.annotationCount)
      || b.reactionCount - a.reactionCount
    )
    .slice(0, MAX_ROWS)

  const inboxHref = `/projects/${projectId}/feedback`
  const showInboxLink = enableAnnotations && hasAnnotationInbox

  return (
    <section className="bg-white dark:bg-gray-800 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700 p-6 animate-fade-in">
      <div className="flex items-center justify-between gap-3 mb-4">
        <h2 className="font-display text-lg font-semibold text-gray-900 dark:text-gray-100">Reader activity</h2>
        {showInboxLink && (
          <Link
            href={inboxHref}
            className="inline-flex items-center gap-1.5 text-xs font-medium text-blue-600 dark:text-blue-400 hover:underline"
          >
            Feedback inbox
            {openFeedback > 0 && (
              <span className="rounded-full bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300 px-1.5 py-px text-[11px] tabular-nums leading-4">
                {openFeedback}
              </span>
            )}
          </Link>
        )}
      </div>

      {!isLive ? (
        <EmptyLine>
          Publish this project to start hearing from readers.{' '}
          <Link href={`/publish/${projectId}`} className="text-blue-600 dark:text-blue-400 hover:underline">Open Publisher &rarr;</Link>
        </EmptyLine>
      ) : discussed.length === 0 ? (
        <EmptyLine>
          No comments or feedback yet.{' '}
          {!enableAnnotations && (
            <>
              Let readers mark errors and leave notes on your chapters.{' '}
              <Link href={`/publish/${projectId}`} className="text-blue-600 dark:text-blue-400 hover:underline">Enable feedback &rarr;</Link>
            </>
          )}
          {enableAnnotations && !hasAnnotationInbox && (
            <>
              Install the Reader Feedback bobbin to triage annotations in the editor.{' '}
              <Link href={`/projects/${projectId}/bobbins`} className="text-blue-600 dark:text-blue-400 hover:underline">Browse bobbins &rarr;</Link>
            </>
          )}
        </EmptyLine>
      ) : (
        <>
          <p className="text-[11px] font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400 mb-2">Most discussed</p>
          <table className="w-full text-sm">
            <thead className="sr-only">
              <tr>
                <th>Chapter</th>
                <th>Reads</th>
                <th>Comments</th>
                <th>Reactions</th>
                <th>Feedback</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 dark:divide-gray-700/60">
              {discussed.map(c => {
                const isPublished = c.publication?.publishStatus === 'published'
                const href = isPublished && readerBaseUrl ? `${readerBaseUrl}/${c.slug ?? c.id}` : null
                return (
                  <tr key={c.id} className="group">
                    <td className="py-2 pr-3 min-w-0">
                      {href ? (
                        <Link href={href} className="block truncate text-gray-900 dark:text-gray-100 hover:text-blue-600 dark:hover:text-blue-400 transition-colors">
                          {c.title}
                        </Link>
                      ) : (
                        <span className="block truncate text-gray-900 dark:text-gray-100">{c.title}</span>
                      )}
                    </td>
                    <Stat value={c.publication?.viewCount ?? 0} label="reads" />
                    <Stat value={c.commentCount} label="comments" />
                    <Stat value={c.reactionCount} label="reactions" />
                    <Stat value={c.annotationCount} label="feedback" />
                  </tr>
                )
              })}
            </tbody>
          </table>

          <p className="mt-4 pt-3 border-t border-gray-100 dark:border-gray-700 text-xs text-gray-500 dark:text-gray-400">
            {totalComments.toLocaleString()} {totalComments === 1 ? 'comment' : 'comments'} across {commentedChapters} {commentedChapters === 1 ? 'chapter' : 'chapters'}
            {enableAnnotations && (
              <>
                {' '}&middot; {openFeedback.toLocaleString()} open feedback &middot; {resolvedFeedback.toLocaleString()} resolved
              </>
            )}
          </p>
        </>
      )}
    </section>
  )
}

function Stat({ value, label }: { value: number; label: string }) {
  return (
    <td className="py-2 pl-3 text-right whitespace-nowrap">
      <span className={`tabular-nums ${value > 0 ? 'text-gray-900 dark:text-gray-100' : 'text-gray-300 dark:text-gray-600'}`}>
        {value.toLocaleString()}
      </span>
      <span className="ml-1 text-xs text-gray-400 dark:text-gray-500 hidden sm:inline">{label}</span>
    </td>
  )
}

function EmptyLine({ children }: { children: React.ReactNode }) {
  return <p className="text-sm text-gray-500 dark:text-gray-400">{children}</p>
}
