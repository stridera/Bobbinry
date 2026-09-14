'use client'

import Link from 'next/link'
import type { ReactNode } from 'react'
import { OptimizedImage } from '@/components/OptimizedImage'
import { ProjectTabs } from './ProjectTabs'
import { StatusBadge } from './StatusBadge'
import type { ProjectSummary } from './useProjectSummary'

interface ProjectPageHeaderProps {
  projectId: string
  /** Null while loading: the band renders with placeholders so the page doesn't jump. */
  summary: ProjectSummary | null
  /** Trailing breadcrumb segment for this page, e.g. "Settings". */
  pageTitle: string
  /** Optional right-aligned content, e.g. a page-specific action. */
  actions?: ReactNode
}

/**
 * The compact project band for pages other than the dashboard: breadcrumb,
 * cover thumb, name and status, actions, and the same tab row the dashboard
 * shows. Keeps every project page one click from every other.
 */
export function ProjectPageHeader({ projectId, summary, pageTitle, actions }: ProjectPageHeaderProps) {
  const isLive = summary?.publishConfig.publishingMode === 'live'
  const openFeedback = summary && summary.publishConfig.enableAnnotations
    ? summary.annotationStats.open + summary.annotationStats.acknowledged
    : 0

  return (
    <header className="bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 pt-4">
        <div className="flex items-center gap-1.5 text-sm text-gray-500 dark:text-gray-400">
          <Link href="/dashboard" className="hover:text-gray-900 dark:hover:text-gray-100 transition-colors">Projects</Link>
          <Chevron />
          {summary ? (
            <Link href={`/projects/${projectId}`} className="truncate hover:text-gray-900 dark:hover:text-gray-100 transition-colors">
              {summary.project.name}
            </Link>
          ) : (
            <span className="inline-block h-4 w-32 rounded bg-gray-100 dark:bg-gray-700 animate-pulse" />
          )}
          <Chevron />
          <span className="text-gray-700 dark:text-gray-200">{pageTitle}</span>
        </div>

        <div className="mt-3 flex items-center gap-3 sm:gap-4">
          <Link
            href={`/projects/${projectId}`}
            className="shrink-0 w-9 h-[52px] rounded overflow-hidden shadow-sm ring-1 ring-black/10 dark:ring-white/10 bg-gray-100 dark:bg-gray-700"
            title="Project overview"
          >
            {summary?.project.coverImage ? (
              <OptimizedImage src={summary.project.coverImage} variant="thumb" alt="" className="w-full h-full object-cover" />
            ) : (
              <span className="flex w-full h-full items-center justify-center bg-gradient-to-br from-teal-500/80 via-teal-600/60 to-amber-500/40 dark:from-teal-700/80 dark:via-teal-800/60 dark:to-amber-700/40 font-display text-lg font-bold text-white/90 select-none">
                {summary?.project.name.charAt(0).toUpperCase() ?? ''}
              </span>
            )}
          </Link>

          <div className="min-w-0 flex-1 flex flex-wrap items-center justify-between gap-x-6 gap-y-2">
            <div className="min-w-0 flex flex-wrap items-center gap-x-2.5 gap-y-1">
              {summary ? (
                <>
                  <Link
                    href={`/projects/${projectId}`}
                    className="font-display text-xl font-bold text-gray-900 dark:text-gray-100 leading-tight truncate hover:underline decoration-gray-300 dark:decoration-gray-600 underline-offset-4"
                  >
                    {summary.project.name}
                  </Link>
                  <StatusBadge isLive={isLive} visibility={summary.publishConfig.projectVisibility} />
                </>
              ) : (
                <span className="inline-block h-6 w-56 rounded bg-gray-200 dark:bg-gray-700 animate-pulse" />
              )}
            </div>
            <div className="flex flex-wrap items-center gap-2 shrink-0">
              {actions}
              <Link
                href={`/publish/${projectId}`}
                className="inline-flex items-center px-3 py-1.5 border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700 rounded-lg font-medium text-sm transition-colors"
              >
                Publisher
              </Link>
              <Link
                href={`/projects/${projectId}/write`}
                className="inline-flex items-center gap-2 px-3 py-1.5 bg-blue-600 hover:bg-blue-700 dark:bg-blue-700 dark:hover:bg-blue-600 text-white rounded-lg font-medium text-sm transition-colors"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                </svg>
                Write
              </Link>
            </div>
          </div>
        </div>

        {summary ? (
          <ProjectTabs
            projectId={projectId}
            bobbins={summary.bobbins}
            bobbinStats={summary.bobbinStats}
            openFeedback={openFeedback}
          />
        ) : (
          <div className="mt-4 h-[42px]" aria-hidden="true" />
        )}
      </div>
    </header>
  )
}

function Chevron() {
  return (
    <svg className="w-3.5 h-3.5 shrink-0 text-gray-400 dark:text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
    </svg>
  )
}
