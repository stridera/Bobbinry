'use client'

import Link from 'next/link'
import type { ReactNode } from 'react'
import { TagsEditor } from './TagsEditor'
import { ImportManuscript } from './ImportManuscript'
import { useBackupStatus } from './useBackupStatus'
import { relativeTime } from '@/lib/relative-time'

interface Tag {
  id: string
  tagCategory: string
  tagName: string
}

interface RailPublishConfig {
  publishingMode: string
  projectVisibility?: string
  enableComments: boolean
  enableReactions: boolean
  enableAnnotations: boolean
  annotationAccess: string
}

interface DashboardRailProps {
  projectId: string
  tags: Tag[]
  onTagsChange: (tags: Tag[]) => void
  publishConfig: RailPublishConfig
  /** Public reader URL for the project, or null when it has none yet. */
  readerHref: string | null
  onImportComplete: () => void
}

/**
 * Right-hand rail: the set-once reference and the rarely-used tools, kept
 * off the main scroll path. Plain sections with hairline dividers, no cards.
 */
export function DashboardRail({ projectId, tags, onTagsChange, publishConfig, readerHref, onImportComplete }: DashboardRailProps) {
  const isLive = publishConfig.publishingMode === 'live'
  const settingsBase = `/projects/${projectId}/settings`

  return (
    <aside className="divide-y divide-gray-200 dark:divide-gray-700 [&>section]:py-5 [&>section:first-child]:pt-0">
      {/* About */}
      <section>
        <h2 className="text-[11px] font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400 mb-2">About</h2>
        <dl className="space-y-1.5 text-sm">
          <div className="flex items-center justify-between gap-3">
            <dt className="text-gray-500 dark:text-gray-400">Status</dt>
            <dd className="text-gray-900 dark:text-gray-100">
              {isLive ? `Live · ${visibilityLabel(publishConfig.projectVisibility)}` : 'Draft, not published'}
            </dd>
          </div>
          {isLive && readerHref && (
            <div className="flex items-center justify-between gap-3 min-w-0">
              <dt className="text-gray-500 dark:text-gray-400 shrink-0">Reader link</dt>
              <dd className="min-w-0">
                <Link
                  href={readerHref}
                  className="inline-flex items-center gap-1 max-w-full text-blue-600 dark:text-blue-400 hover:underline"
                  title={readerHref}
                >
                  <span className="truncate">{readerHref.replace(/^\/read\//, '')}</span>
                  <svg className="w-3 h-3 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                  </svg>
                </Link>
              </dd>
            </div>
          )}
          <FeatureRow label="Comments" on={publishConfig.enableComments} />
          <FeatureRow label="Reactions" on={publishConfig.enableReactions} />
          <FeatureRow
            label="Feedback"
            on={publishConfig.enableAnnotations}
            detail={publishConfig.enableAnnotations ? publishConfig.annotationAccess.replace(/_/g, ' ') : undefined}
          />
        </dl>
        <Link
          href={`/publish/${projectId}`}
          className="mt-2.5 inline-block text-xs text-gray-500 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-100 transition-colors"
        >
          Change in Publisher &rarr;
        </Link>
      </section>

      {/* Tags */}
      <TagsEditor projectId={projectId} tags={tags} onTagsChange={onTagsChange} />

      {/* Tools */}
      <section>
        <h2 className="text-[11px] font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400 mb-1">Tools</h2>
        <ul className="-mx-2">
          <li>
            <ImportManuscript projectId={projectId} onImportComplete={onImportComplete}>
              {(open) => (
                <RailRow as="button" onClick={open} icon={<UploadIcon />} label="Import manuscript" />
              )}
            </ImportManuscript>
          </li>
          <li>
            <RailRow href={`${settingsBase}#export`} icon={<DownloadIcon />} label="Export" />
          </li>
          <li>
            <RailRow href={`${settingsBase}#backup`} icon={<CloudIcon />} label="Backup" meta={<BackupMeta projectId={projectId} />} />
          </li>
          <li>
            <RailRow href={`${settingsBase}#manuscript-display`} icon={<TypeIcon />} label="Manuscript display" />
          </li>
          <li>
            <RailRow href={settingsBase} icon={<CogIcon />} label="Project settings" />
          </li>
        </ul>
      </section>
    </aside>
  )
}

function visibilityLabel(visibility?: string): string {
  switch (visibility) {
    case 'private': return 'Private'
    case 'unlisted': return 'Unlisted'
    default: return 'Public'
  }
}

function FeatureRow({ label, on, detail }: { label: string; on: boolean; detail?: string | undefined }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <dt className="text-gray-500 dark:text-gray-400">{label}</dt>
      <dd className={`inline-flex items-center gap-1.5 ${on ? 'text-gray-900 dark:text-gray-100' : 'text-gray-400 dark:text-gray-500'}`}>
        <span className={`w-1.5 h-1.5 rounded-full ${on ? 'bg-green-500' : 'bg-gray-300 dark:bg-gray-600'}`} aria-hidden="true" />
        {on ? (detail ? `On · ${detail}` : 'On') : 'Off'}
      </dd>
    </div>
  )
}

/** Compact status for the Backup row: last sync time, or why there isn't one. */
function BackupMeta({ projectId }: { projectId: string }) {
  const { status, loading } = useBackupStatus()
  if (loading || !status) return null
  if (!status.connection.connected) {
    return <span className="text-gray-400 dark:text-gray-500">Not connected</span>
  }
  const project = status.projects.find(p => p.id === projectId)
  if (project && !project.isBackedUp) {
    return <span className="text-gray-400 dark:text-gray-500">Off</span>
  }
  if (project?.lastSyncStatus === 'failed') {
    return <span className="text-red-600 dark:text-red-400">Failed</span>
  }
  if (project?.lastSyncedAt) {
    return <span className="text-gray-400 dark:text-gray-500">{relativeTime(project.lastSyncedAt)}</span>
  }
  return <span className="text-gray-400 dark:text-gray-500">Pending</span>
}

type RailRowProps = {
  icon: ReactNode
  label: string
  meta?: ReactNode
} & (
  | { as?: 'link'; href: string; onClick?: never }
  | { as: 'button'; onClick: () => void; href?: never }
)

function RailRow({ icon, label, meta, ...rest }: RailRowProps) {
  const className = 'flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800 hover:text-gray-900 dark:hover:text-gray-100 transition-colors cursor-pointer'
  const inner = (
    <>
      <span className="shrink-0 text-gray-400 dark:text-gray-500" aria-hidden="true">{icon}</span>
      <span className="flex-1 truncate text-left">{label}</span>
      {meta && <span className="shrink-0 text-xs">{meta}</span>}
    </>
  )
  if (rest.as === 'button') {
    return <button type="button" onClick={rest.onClick} className={className}>{inner}</button>
  }
  return <Link href={rest.href} className={className}>{inner}</Link>
}

const iconProps = {
  className: 'w-4 h-4',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.75,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
  viewBox: '0 0 24 24',
}

function UploadIcon() {
  return <svg {...iconProps}><path d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" /></svg>
}
function DownloadIcon() {
  return <svg {...iconProps}><path d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" /></svg>
}
function CloudIcon() {
  return <svg {...iconProps}><path d="M7 18a4.5 4.5 0 01-.6-8.96A6 6 0 0118.3 8.5 4 4 0 0117 18H7z" /></svg>
}
function TypeIcon() {
  return <svg {...iconProps}><path d="M4 7V4h16v3M9 20h6M12 4v16" /></svg>
}
function CogIcon() {
  return (
    <svg {...iconProps}>
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.7 1.7 0 00.3 1.8l.1.1a2 2 0 11-2.8 2.8l-.1-.1a1.7 1.7 0 00-1.8-.3 1.7 1.7 0 00-1 1.5V21a2 2 0 11-4 0v-.1a1.7 1.7 0 00-1.1-1.5 1.7 1.7 0 00-1.8.3l-.1.1a2 2 0 11-2.8-2.8l.1-.1a1.7 1.7 0 00.3-1.8 1.7 1.7 0 00-1.5-1H3a2 2 0 110-4h.1a1.7 1.7 0 001.5-1.1 1.7 1.7 0 00-.3-1.8l-.1-.1a2 2 0 112.8-2.8l.1.1a1.7 1.7 0 001.8.3H9a1.7 1.7 0 001-1.5V3a2 2 0 114 0v.1a1.7 1.7 0 001 1.5 1.7 1.7 0 001.8-.3l.1-.1a2 2 0 112.8 2.8l-.1.1a1.7 1.7 0 00-.3 1.8V9a1.7 1.7 0 001.5 1H21a2 2 0 110 4h-.1a1.7 1.7 0 00-1.5 1z" />
    </svg>
  )
}
