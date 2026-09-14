'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'

export interface ProjectTabBobbin {
  bobbinId: string
  manifest: {
    name: string
    hasLeftPanel: boolean
    annotationInbox?: boolean
  }
}

interface ProjectTabsProps {
  projectId: string
  bobbins: ProjectTabBobbin[]
  /** bobbinId → item count, shown as a badge on the tab. */
  bobbinStats: Record<string, number>
  /** Open + acknowledged annotations; badge on the Feedback tab. */
  openFeedback: number
}

interface Tab {
  key: string
  label: string
  href: string
  count?: number | undefined
}

/**
 * The project's destinations as a tab row: Overview, then every installed
 * bobbin that owns a project-wide workspace (a `shell.leftPanel`
 * contribution), then the feedback inbox when a bobbin provides one. This is
 * what makes Entities a peer of the manuscript rather than a card to scroll
 * to. Sits flush with the bottom edge of the masthead band.
 */
export function ProjectTabs({ projectId, bobbins, bobbinStats, openFeedback }: ProjectTabsProps) {
  const pathname = usePathname()
  const base = `/projects/${projectId}`

  const workspaces = bobbins.filter(b => b.manifest.hasLeftPanel)
  // Manuscript always leads; it's the core workspace and has a dedicated route.
  const manuscript = workspaces.find(b => b.bobbinId === 'manuscript')
  const others = workspaces.filter(b => b.bobbinId !== 'manuscript')

  const tabs: Tab[] = [{ key: 'overview', label: 'Overview', href: base }]
  if (manuscript) {
    tabs.push({ key: 'manuscript', label: manuscript.manifest.name, href: `${base}/write` })
  }
  for (const b of others) {
    const count = bobbinStats[b.bobbinId] ?? 0
    tabs.push({
      key: b.bobbinId,
      label: b.manifest.name,
      href: `${base}/${b.bobbinId}`,
      count: count > 0 ? count : undefined,
    })
  }
  if (bobbins.some(b => b.manifest.annotationInbox)) {
    tabs.push({
      key: 'feedback',
      label: 'Feedback',
      href: `${base}/feedback`,
      count: openFeedback > 0 ? openFeedback : undefined,
    })
  }

  return (
    <nav aria-label="Project sections" className="mt-4 -mb-px flex items-end gap-1 overflow-x-auto">
      {tabs.map(tab => {
        const active = pathname === tab.href
        return (
          <Link
            key={tab.key}
            href={tab.href}
            aria-current={active ? 'page' : undefined}
            className={`group inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap border-b-2 px-3 py-2.5 text-sm font-medium transition-colors ${
              active
                ? 'border-blue-600 dark:border-blue-400 text-gray-900 dark:text-gray-100'
                : 'border-transparent text-gray-600 dark:text-gray-400 hover:border-gray-300 dark:hover:border-gray-600 hover:text-gray-900 dark:hover:text-gray-100'
            }`}
          >
            {tab.label}
            {tab.count !== undefined && (
              <span className={`rounded-full px-1.5 py-px text-[11px] font-medium tabular-nums leading-4 ${
                active
                  ? 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300'
                  : 'bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-300'
              }`}>
                {tab.count.toLocaleString()}
              </span>
            )}
          </Link>
        )
      })}
      <Link
        href={`${base}/bobbins`}
        className="ml-1 inline-flex shrink-0 items-center self-center rounded-md p-1.5 text-gray-400 hover:bg-gray-100 hover:text-gray-700 dark:text-gray-500 dark:hover:bg-gray-700 dark:hover:text-gray-200 transition-colors"
        title="Add bobbins"
        aria-label="Add bobbins"
      >
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
        </svg>
      </Link>
    </nav>
  )
}
