/**
 * Local draft cache + version-conflict debug trail for the manuscript editor.
 *
 * Drafts are stored per entity in localStorage so no edit is ever lost, even
 * if the server save has not completed when the user navigates away. The
 * editor reads a draft first (instant load) and reconciles against the server
 * version afterwards.
 */

const DRAFT_PREFIX = 'bobbinry:draft:'

export interface DraftEntry {
  html: string
  title: string
  wordCount: number
  savedToServer: boolean
  timestamp: number
  version: number | null
  containerId: string | null
}

export function getDraftKey(entityId: string): string {
  return `${DRAFT_PREFIX}${entityId}`
}

export function saveDraft(entityId: string, draft: Partial<DraftEntry> & { html: string }) {
  try {
    const existing = loadDraft(entityId)
    const entry: DraftEntry = {
      html: draft.html,
      title: draft.title ?? existing?.title ?? '',
      wordCount: draft.wordCount ?? existing?.wordCount ?? 0,
      savedToServer: draft.savedToServer ?? existing?.savedToServer ?? false,
      timestamp: Date.now(),
      version: draft.version !== undefined ? draft.version : (existing?.version ?? null),
      containerId: draft.containerId !== undefined ? draft.containerId : (existing?.containerId ?? null),
    }
    localStorage.setItem(getDraftKey(entityId), JSON.stringify(entry))
  } catch {
    // localStorage full or unavailable — degrade gracefully
  }
}

export function loadDraft(entityId: string): DraftEntry | null {
  try {
    const raw = localStorage.getItem(getDraftKey(entityId))
    if (!raw) return null
    return JSON.parse(raw) as DraftEntry
  } catch {
    return null
  }
}

export function removeDraft(entityId: string): void {
  try {
    localStorage.removeItem(getDraftKey(entityId))
  } catch {
    // ignore quota/security errors
  }
}

// --- Version-conflict debug trail ---
// The "Editing conflict" dialog is hard to reproduce, so every version-related
// decision is logged to the console AND to a localStorage ring buffer. When the
// dialog appears unexpectedly, the trail can be inspected after the fact with:
//   JSON.parse(localStorage.getItem('bobbinry:version-debug'))
const VERSION_DEBUG_KEY = 'bobbinry:version-debug'
const VERSION_DEBUG_MAX = 100

export function versionDebug(
  site: string,
  data: Record<string, unknown>,
  level: 'debug' | 'info' | 'warn' = 'info'
) {
  console[level]('[manuscript:version]', site, data)
  try {
    const raw = localStorage.getItem(VERSION_DEBUG_KEY)
    const trail: unknown[] = raw ? JSON.parse(raw) : []
    trail.push({ t: new Date().toISOString(), site, ...data })
    if (trail.length > VERSION_DEBUG_MAX) trail.splice(0, trail.length - VERSION_DEBUG_MAX)
    localStorage.setItem(VERSION_DEBUG_KEY, JSON.stringify(trail))
  } catch {
    // localStorage full or unavailable — console output still happened
  }
}
