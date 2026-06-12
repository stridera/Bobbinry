'use client'

import type { Crumb } from '@/hooks/useBreadcrumb'

const MAX_VISIBLE_CRUMBS = 4

export function Breadcrumbs({ crumbs }: { crumbs: Crumb[] }) {
  const handleCrumbClick = (crumb: Crumb) => {
    if (!crumb.navDetail) return
    window.dispatchEvent(new CustomEvent('bobbinry:navigate', { detail: crumb.navDetail }))
  }

  // Middle-truncate long chains: first crumb + … + last (MAX-1) crumbs
  let displayCrumbs: (Crumb | 'ellipsis')[] = crumbs
  if (crumbs.length > MAX_VISIBLE_CRUMBS) {
    displayCrumbs = [crumbs[0]!, 'ellipsis', ...crumbs.slice(crumbs.length - (MAX_VISIBLE_CRUMBS - 1))]
  }

  return (
    <nav aria-label="Breadcrumb" className="flex min-w-0 items-center gap-1 text-sm">
      {displayCrumbs.map((crumb, index) => {
        if (crumb === 'ellipsis') {
          return (
            <span key={`ellipsis-${index}`} className="flex shrink-0 items-center gap-1">
              <span className="text-gray-400 dark:text-gray-500">&hellip;</span>
              <span className="text-gray-300 dark:text-gray-600">&rsaquo;</span>
            </span>
          )
        }
        const isLast = index === displayCrumbs.length - 1
        return (
          <span key={crumb.id} className={`flex items-center gap-1 ${isLast ? 'min-w-0' : 'shrink-0'}`}>
            {crumb.navDetail ? (
              <button
                onClick={() => handleCrumbClick(crumb)}
                className="max-w-[180px] truncate text-gray-500 transition-colors hover:text-gray-800 hover:underline dark:text-gray-400 dark:hover:text-gray-200"
              >
                {crumb.label}
              </button>
            ) : (
              <span className={`truncate ${isLast ? 'font-medium text-gray-700 dark:text-gray-200' : 'max-w-[180px] text-gray-500 dark:text-gray-400'}`}>
                {crumb.label}
              </span>
            )}
            {!isLast && <span className="text-gray-300 dark:text-gray-600">&rsaquo;</span>}
          </span>
        )
      })}
    </nav>
  )
}

export default Breadcrumbs
