/**
 * Breadcrumb registration for views.
 *
 * The shell computes a default breadcrumb trail for the current entity, but
 * the active view knows its own context best — call publishBreadcrumb to
 * replace the shell's trail with yours. The override is cleared automatically
 * on the next navigation, so publish again whenever your view (re)loads.
 */

export interface BreadcrumbCrumb {
  id: string
  label: string
  /** Dispatched as a bobbinry:navigate detail when clicked; omit for the leaf. */
  navDetail?: {
    entityType: string
    entityId: string
    bobbinId: string
    metadata?: Record<string, any>
  }
}

export function publishBreadcrumb(crumbs: BreadcrumbCrumb[]): void {
  if (typeof window === 'undefined') return
  window.dispatchEvent(new CustomEvent('bobbinry:breadcrumb', { detail: { crumbs } }))
}
