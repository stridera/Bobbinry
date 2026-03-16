/**
 * AUTO-GENERATED — do not edit manually.
 * Run `bun run generate:views` to regenerate from bobbin manifests.
 */

// Static import map for native bobbin views.
// Next.js/webpack requires static strings in import() calls, so this map
// must be generated at build time rather than constructed dynamically.
export const NATIVE_VIEW_MAP: Record<string, () => Promise<any>> = {
  'cat.panels/cat-panel': () => import('@bobbinry/cat/panels/cat-panel'),
  'corkboard.board': () => import('@bobbinry/corkboard/views/board'),
  'dictionary-panel.panels/dictionary-panel': () => import('@bobbinry/dictionary-panel/panels/dictionary-panel'),
  'manuscript.outline': () => import('@bobbinry/manuscript/views/outline'),
  'manuscript.editor': () => import('@bobbinry/manuscript/views/editor'),
  'manuscript.panels/navigation': () => import('@bobbinry/manuscript/panels/navigation'),
  'manuscript.views/session-stats': () => import('@bobbinry/manuscript/views/session-stats'),
  'notes.note-editor': () => import('@bobbinry/notes/views/note-editor'),
  'notes.pinboard': () => import('@bobbinry/notes/views/pinboard'),
  'notes.panels/navigation': () => import('@bobbinry/notes/panels/navigation'),
  'notes.panels/chapter-notes': () => import('@bobbinry/notes/panels/chapter-notes'),
  'ai-tools.panels/ai-panel': () => import('@bobbinry/ai-tools/panels/ai-panel'),
  'google-drive-backup.panels/drive-sync': () => import('@bobbinry/google-drive-backup/panels/drive-sync'),
  'entities.config': () => import('@bobbinry/entities/views/config'),
  'entities.entity-list': () => import('@bobbinry/entities/views/entity-list'),
  'entities.entity-editor': () => import('@bobbinry/entities/views/entity-editor'),
  'entities.panels/navigation': () => import('@bobbinry/entities/panels/navigation'),
  'entities.panels/entity-preview': () => import('@bobbinry/entities/panels/entity-preview'),
  'relationships.graph': () => import('@bobbinry/relationships/views/graph'),
  'relationships.matrix': () => import('@bobbinry/relationships/views/matrix'),
  'relationships.relationship-editor': () => import('@bobbinry/relationships/views/relationship-editor'),
  'relationships.panels/navigation': () => import('@bobbinry/relationships/panels/navigation'),
  'timeline.timeline': () => import('@bobbinry/timeline/views/timeline'),
  'timeline.event-editor': () => import('@bobbinry/timeline/views/event-editor'),
  'timeline.panels/navigation': () => import('@bobbinry/timeline/panels/navigation'),
  'goals.dashboard': () => import('@bobbinry/goals/views/dashboard'),
  'goals.goal-editor': () => import('@bobbinry/goals/views/goal-editor'),
  'goals.panels/progress': () => import('@bobbinry/goals/panels/progress'),
  'web-publisher.release-config': () => import('@bobbinry/web-publisher/views/release-config'),
  'web-publisher.panels/chapter-publish': () => import('@bobbinry/web-publisher/panels/chapter-publish'),
}
