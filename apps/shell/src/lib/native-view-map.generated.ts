/**
 * AUTO-GENERATED — do not edit manually.
 * Run `bun run generate:views` to regenerate from bobbin manifests.
 */

// Static import map for native bobbin views.
// Next.js/webpack requires static strings in import() calls, so this map
// must be generated at build time rather than constructed dynamically.
export const NATIVE_VIEW_MAP: Record<string, () => Promise<any>> = {
  'cat.panels/cat-panel': () => import('@bobbinry/cat/panels/cat-panel'),
  'google-drive-publisher.panels/drive-sync': () => import('@bobbinry/google-drive-publisher/panels/drive-sync'),
  'corkboard.board': () => import('@bobbinry/corkboard/views/board'),
  'smart-publisher.release-manager': () => import('@bobbinry/smart-publisher/views/ReleaseManager'),
  'smart-publisher.release-config': () => import('@bobbinry/smart-publisher/views/ReleaseConfig'),
  'smart-publisher.panels/release-queue': () => import('@bobbinry/smart-publisher/panels/release-queue'),
  'manuscript.outline': () => import('@bobbinry/manuscript/views/outline'),
  'manuscript.editor': () => import('@bobbinry/manuscript/views/editor'),
  'manuscript.panels/navigation': () => import('@bobbinry/manuscript/panels/navigation'),
  'manuscript.panels/session-stats': () => import('@bobbinry/manuscript/panels/session-stats'),
  'entities.config': () => import('@bobbinry/entities/views/config'),
  'entities.entity-list': () => import('@bobbinry/entities/views/entity-list'),
  'entities.entity-editor': () => import('@bobbinry/entities/views/entity-editor'),
  'entities.views/navigation': () => import('@bobbinry/entities/views/navigation'),
  'web-publisher.panels/chapter-publish': () => import('@bobbinry/web-publisher/panels/chapter-publish'),
  'web-publisher.panels/publish-manager': () => import('@bobbinry/web-publisher/panels/publish-manager'),
}
