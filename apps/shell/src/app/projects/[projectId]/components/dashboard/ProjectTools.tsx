'use client'

import Link from 'next/link'

interface ProjectToolBobbin {
  bobbinId: string
  manifest: {
    name: string
    description?: string
    icon?: string
    hasLeftPanel: boolean
  }
}

interface ProjectToolsProps {
  projectId: string
  bobbins: ProjectToolBobbin[]
  bobbinStats: Record<string, number>
}

// Tile avatar colors. Indexed by a hash of bobbinId so each bobbin gets a
// stable, distinct color when no manifest icon is provided.
const AVATAR_PALETTE = [
  'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300',
  'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300',
  'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300',
  'bg-violet-100 text-violet-700 dark:bg-violet-900/40 dark:text-violet-300',
  'bg-rose-100 text-rose-700 dark:bg-rose-900/40 dark:text-rose-300',
  'bg-cyan-100 text-cyan-700 dark:bg-cyan-900/40 dark:text-cyan-300',
  'bg-orange-100 text-orange-700 dark:bg-orange-900/40 dark:text-orange-300',
  'bg-teal-100 text-teal-700 dark:bg-teal-900/40 dark:text-teal-300',
]

function avatarColor(bobbinId: string): string {
  let hash = 0
  for (let i = 0; i < bobbinId.length; i++) {
    hash = (hash * 31 + bobbinId.charCodeAt(i)) >>> 0
  }
  return AVATAR_PALETTE[hash % AVATAR_PALETTE.length]!
}

function formatCount(count: number): string {
  if (count === 0) return 'Empty'
  if (count === 1) return '1 item'
  return `${count.toLocaleString()} items`
}

export function ProjectTools({ projectId, bobbins, bobbinStats }: ProjectToolsProps) {
  const tools = bobbins.filter(b => b.manifest.hasLeftPanel)

  return (
    <div className="bg-white dark:bg-gray-800 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700 p-6 animate-fade-in">
      <div className="flex items-center justify-between mb-4">
        <h2 className="font-display text-lg font-semibold text-gray-900 dark:text-gray-100">Project Tools</h2>
        <Link
          href={`/projects/${projectId}/bobbins`}
          className="text-xs text-blue-600 dark:text-blue-400 hover:text-blue-700 dark:hover:text-blue-300 transition-colors"
        >
          Browse Bobbins &rarr;
        </Link>
      </div>

      {tools.length === 0 ? (
        <div className="border border-dashed border-gray-300 dark:border-gray-700 rounded-lg p-6 text-center">
          <p className="text-sm text-gray-600 dark:text-gray-300 mb-1">No project-wide tools installed yet.</p>
          <p className="text-xs text-gray-500 dark:text-gray-400 mb-3">
            Install bobbins like Entities, Timeline, or Notes to manage project data outside the manuscript editor.
          </p>
          <Link
            href={`/projects/${projectId}/bobbins`}
            className="inline-block text-xs font-medium text-blue-600 dark:text-blue-400 hover:text-blue-700 dark:hover:text-blue-300"
          >
            Browse Bobbins &rarr;
          </Link>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {tools.map(tool => {
            const count = bobbinStats[tool.bobbinId] ?? 0
            const initial = tool.manifest.name.charAt(0).toUpperCase()
            return (
              <Link
                key={tool.bobbinId}
                href={`/projects/${projectId}/${tool.bobbinId}`}
                className="group flex items-start gap-3 p-3 border border-gray-200 dark:border-gray-700 rounded-lg hover:border-blue-300 dark:hover:border-blue-700 hover:bg-blue-50/40 dark:hover:bg-blue-950/20 transition-colors"
              >
                <div className={`shrink-0 w-10 h-10 rounded-lg flex items-center justify-center font-semibold text-base ${avatarColor(tool.bobbinId)}`}>
                  {tool.manifest.icon || initial}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-baseline justify-between gap-2">
                    <h3 className="text-sm font-medium text-gray-900 dark:text-gray-100 truncate">
                      {tool.manifest.name}
                    </h3>
                    <span className="shrink-0 text-xs text-gray-500 dark:text-gray-400">
                      {formatCount(count)}
                    </span>
                  </div>
                  {tool.manifest.description && (
                    <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5 line-clamp-2">
                      {tool.manifest.description}
                    </p>
                  )}
                </div>
              </Link>
            )
          })}

          <Link
            href={`/projects/${projectId}/bobbins`}
            className="group flex items-center justify-center gap-2 p-3 border border-dashed border-gray-300 dark:border-gray-700 rounded-lg text-gray-500 dark:text-gray-400 hover:border-blue-400 dark:hover:border-blue-600 hover:text-blue-600 dark:hover:text-blue-300 transition-colors"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
            </svg>
            <span className="text-sm font-medium">Add bobbins</span>
          </Link>
        </div>
      )}
    </div>
  )
}
