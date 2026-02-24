/**
 * AUTO-GENERATED — do not edit manually.
 * Run `bun run generate:views` to regenerate from bobbin manifests.
 */

// Static import map for native bobbin views.
// Next.js/webpack requires static strings in import() calls, so this map
// must be generated at build time rather than constructed dynamically.
export const NATIVE_VIEW_MAP: Record<string, () => Promise<any>> = {
  'manuscript.outline': () => import('@bobbinry/manuscript/views/outline'),
  'manuscript.editor': () => import('@bobbinry/manuscript/views/editor'),
  'manuscript.panels/navigation': () => import('@bobbinry/manuscript/panels/navigation'),
  'entities.config': () => import('@bobbinry/entities/views/config'),
  'entities.entity-list': () => import('@bobbinry/entities/views/entity-list'),
  'entities.entity-editor': () => import('@bobbinry/entities/views/entity-editor'),
  'entities.views/navigation': () => import('@bobbinry/entities/views/navigation'),
}
