'use client'

import Link from 'next/link'
import { relativeTime } from '@/lib/relative-time'

interface ActivityChapter {
  id: string
  slug?: string | null
  title: string
  archivedAt: string | null
  commentCount: number
}

export interface RecentComment {
  id: string
  chapterId: string
  parentId: string | null
  authorName: string | null
  content: string
  createdAt: string
}

export interface OpenAnnotation {
  id: string
  chapterId: string
  authorName: string | null
  annotationType: string
  errorCategory: string | null
  anchorQuote: string
  content: string
  status: string
  createdAt: string
}

interface ReaderActivityProps {
  projectId: string
  chapters: ActivityChapter[]
  recentComments: RecentComment[]
  openAnnotations: OpenAnnotation[]
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

const MAX_ROWS = 8

type FeedItem =
  | { kind: 'comment'; at: number; comment: RecentComment }
  | { kind: 'annotation'; at: number; annotation: OpenAnnotation }

/**
 * What readers are doing with the manuscript, newest first: the latest
 * comments and every annotation still waiting on the author, each linking to
 * the thing itself.
 */
export function ReaderActivity({
  projectId,
  chapters,
  recentComments,
  openAnnotations,
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
  const chapterById = new Map(chapters.map(c => [c.id, c]))

  const feed: FeedItem[] = [
    ...recentComments.map(comment => ({ kind: 'comment' as const, at: Date.parse(comment.createdAt), comment })),
    ...openAnnotations.map(annotation => ({ kind: 'annotation' as const, at: Date.parse(annotation.createdAt), annotation })),
  ].sort((a, b) => b.at - a.at).slice(0, MAX_ROWS)

  const inboxHref = `/projects/${projectId}/feedback`
  const showInboxLink = enableAnnotations && hasAnnotationInbox

  const chapterHref = (chapterId: string): string | null => {
    const chapter = chapterById.get(chapterId)
    if (!chapter || !readerBaseUrl) return null
    return `${readerBaseUrl}/${chapter.slug ?? chapter.id}`
  }

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
      ) : feed.length === 0 ? (
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
          <ol className="-mx-2 divide-y divide-gray-100 dark:divide-gray-700/60">
            {feed.map(item => {
              if (item.kind === 'comment') {
                const { comment } = item
                const chapter = chapterById.get(comment.chapterId)
                const base = chapterHref(comment.chapterId)
                return (
                  <FeedRow
                    key={`c-${comment.id}`}
                    href={base ? `${base}#comment-${comment.id}` : null}
                    icon={<CommentIcon />}
                    tone="text-gray-400 dark:text-gray-500"
                    lead={
                      <>
                        <Name>{comment.authorName}</Name>
                        {comment.parentId ? ' replied on ' : ' commented on '}
                        <ChapterName>{chapter?.title}</ChapterName>
                      </>
                    }
                    snippet={comment.content}
                    at={comment.createdAt}
                  />
                )
              }
              const { annotation } = item
              const chapter = chapterById.get(annotation.chapterId)
              const href = showInboxLink
                ? `${inboxHref}?annotationId=${annotation.id}`
                : chapterHref(annotation.chapterId)
              const tone = annotation.annotationType === 'error'
                ? 'text-red-500 dark:text-red-400'
                : annotation.annotationType === 'suggestion'
                  ? 'text-blue-500 dark:text-blue-400'
                  : 'text-amber-500 dark:text-amber-400'
              return (
                <FeedRow
                  key={`a-${annotation.id}`}
                  href={href}
                  icon={<AnnotationIcon type={annotation.annotationType} />}
                  tone={tone}
                  lead={
                    <>
                      <Name>{annotation.authorName}</Name>
                      {' '}{annotationVerb(annotation)}{' '}
                      <ChapterName>{chapter?.title}</ChapterName>
                      {annotation.status === 'acknowledged' && (
                        <span className="ml-1.5 text-[11px] text-gray-400 dark:text-gray-500">acknowledged</span>
                      )}
                    </>
                  }
                  snippet={annotation.content || `“${annotation.anchorQuote}”`}
                  at={annotation.createdAt}
                />
              )
            })}
          </ol>

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

const ERROR_CATEGORY_PHRASES: Record<string, string> = {
  typo: 'reported a typo in',
  grammar: 'reported a grammar issue in',
  formatting: 'reported a formatting issue in',
  continuity: 'reported a continuity issue in',
  other: 'reported an error in',
}

function annotationVerb(a: OpenAnnotation): string {
  switch (a.annotationType) {
    case 'error':
      return (a.errorCategory && ERROR_CATEGORY_PHRASES[a.errorCategory]) || 'reported an error in'
    case 'suggestion':
      return 'suggested a change to'
    default:
      return 'left feedback on'
  }
}

function FeedRow({
  href, icon, tone, lead, snippet, at,
}: {
  href: string | null
  icon: React.ReactNode
  tone: string
  lead: React.ReactNode
  snippet: string
  at: string
}) {
  const body = (
    <>
      <span className={`mt-0.5 shrink-0 ${tone}`} aria-hidden="true">{icon}</span>
      <span className="min-w-0 flex-1">
        <span className="block text-sm text-gray-600 dark:text-gray-400 truncate">{lead}</span>
        <span className="block text-sm text-gray-900 dark:text-gray-100 line-clamp-2">{snippet}</span>
      </span>
      <time
        dateTime={at}
        title={new Date(at).toLocaleString()}
        className="shrink-0 text-xs text-gray-400 dark:text-gray-500 tabular-nums whitespace-nowrap"
      >
        {relativeTime(at)}
      </time>
    </>
  )
  const className = 'flex items-start gap-3 px-2 py-2.5 rounded-md'
  return (
    <li>
      {href ? (
        <Link href={href} className={`${className} hover:bg-gray-50 dark:hover:bg-gray-700/40 transition-colors`}>
          {body}
        </Link>
      ) : (
        <div className={className}>{body}</div>
      )}
    </li>
  )
}

function Name({ children }: { children: string | null }) {
  return <span className="font-medium text-gray-900 dark:text-gray-100">{children || 'A reader'}</span>
}

function ChapterName({ children }: { children: string | undefined }) {
  return <span className="text-gray-900 dark:text-gray-100">{children || 'a chapter'}</span>
}

function EmptyLine({ children }: { children: React.ReactNode }) {
  return <p className="text-sm text-gray-500 dark:text-gray-400">{children}</p>
}

function CommentIcon() {
  return (
    <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24">
      <path d="M21 12a8 8 0 01-8 8H8l-5 3 1.6-4.4A8 8 0 1121 12z" />
    </svg>
  )
}

function AnnotationIcon({ type }: { type: string }) {
  if (type === 'error') {
    return (
      <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24">
        <path d="M12 9v4m0 4h.01M10.3 3.9L2.5 17.5A2 2 0 004.2 20.5h15.6a2 2 0 001.7-3L13.7 3.9a2 2 0 00-3.4 0z" />
      </svg>
    )
  }
  if (type === 'suggestion') {
    return (
      <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24">
        <path d="M9 18h6m-5 3h4M12 3a6 6 0 00-3.5 10.9c.6.5 1 1.2 1 2.1h5c0-.9.4-1.6 1-2.1A6 6 0 0012 3z" />
      </svg>
    )
  }
  return (
    <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24">
      <path d="M4 5h16v11H8l-4 4V5z" />
      <path d="M8 9h8M8 12h5" />
    </svg>
  )
}
