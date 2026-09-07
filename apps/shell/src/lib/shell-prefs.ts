/**
 * Shell layout preferences that follow the signed-in user.
 *
 * One store, three layers:
 *  - memory: what components read, through useShellPref() (useSyncExternalStore)
 *  - localStorage mirror (`bobbinry:shellPrefs`): the first-paint cache, so a
 *    reload lays panels out before the network answers
 *  - server (`/users/me/shell-preferences`): fetched once per session when the
 *    API token is known; server values win over the mirror, local-only keys are
 *    uploaded. Writes mirror immediately and PATCH debounced, only the changed
 *    keys, flushed with keepalive when the page is left.
 *
 * Namespaces match the API's allow-list (routes/users/shell-prefs.ts).
 */
import { useCallback, useSyncExternalStore } from 'react'

// Loaded on first network use so components that only read preferences do
// not pull the session/auth client into their module graph (or their tests).
const api = () => import('./api')

export type ShellPrefNamespace = 'panelWidth' | 'panelCollapsed' | 'leftRail' | 'rightRail' | 'viewPreferences' | 'lastNav'
type Bucket = Record<string, unknown>
export type ShellPrefs = Partial<Record<ShellPrefNamespace, Bucket>>

export const SHELL_PREFS_MIRROR_KEY = 'bobbinry:shellPrefs'
const FLUSH_DELAY_MS = 750

let prefs: ShellPrefs | null = null
let pending: ShellPrefs = {}
let flushTimer: ReturnType<typeof setTimeout> | null = null
let apiToken: string | null = null
let fetchedForToken: string | null = null
let pagehideBound = false
const listeners = new Set<() => void>()

function notify() { for (const fn of listeners) fn() }

function readMirror(): ShellPrefs | null {
  try {
    const raw = localStorage.getItem(SHELL_PREFS_MIRROR_KEY)
    return raw ? (JSON.parse(raw) as ShellPrefs) : null
  } catch { return null }
}

function writeMirror() {
  try { localStorage.setItem(SHELL_PREFS_MIRROR_KEY, JSON.stringify(prefs ?? {})) } catch { /* private mode */ }
}

/**
 * One-time import of the keys the shell used before the store existed. They
 * are removed afterwards and queued for upload so a returning user keeps
 * their layout on first sign-in after the change.
 */
function importLegacyKeys(): ShellPrefs {
  const out: ShellPrefs = {}
  const put = (ns: ShellPrefNamespace, key: string, value: unknown) => {
    if (value === undefined || value === null || value === '') return
    ;(out[ns] ??= {})[key] = sanitizeValue(ns, value)
  }
  try {
    const num = (k: string) => { const v = localStorage.getItem(k); return v === null ? undefined : Number(v) }
    const bool = (k: string) => { const v = localStorage.getItem(k); return v === null ? undefined : v === 'true' }
    put('panelWidth', 'left', num('shellPanelWidth:left'))
    put('panelWidth', 'right', num('shellPanelWidth:right'))
    put('panelCollapsed', 'left', bool('shellPanelCollapsed:left'))
    put('panelCollapsed', 'right', bool('shellPanelCollapsed:right'))
    put('leftRail', 'active', localStorage.getItem('shellLeftRail:active'))
    put('rightRail', 'active', localStorage.getItem('shellRightRail:active'))
    put('rightRail', 'pinned', localStorage.getItem('shellRightRail:pinned'))
    put('rightRail', 'split', num('shellRightRail:split'))
    const views = localStorage.getItem('viewPreferences')
    if (views) for (const [k, v] of Object.entries(JSON.parse(views) as Bucket)) put('viewPreferences', k, v)
    const removable: string[] = []
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i)
      if (!key) continue
      if (key.startsWith('bobbinry:lastNav:')) {
        try { put('lastNav', key.slice('bobbinry:lastNav:'.length), JSON.parse(localStorage.getItem(key) || 'null')) } catch { /* skip */ }
        removable.push(key)
      } else if (/^(shellPanelWidth|shellPanelCollapsed|shellLeftRail|shellRightRail):/.test(key) || key === 'viewPreferences') {
        removable.push(key)
      }
    }
    for (const key of removable) localStorage.removeItem(key)
  } catch { /* localStorage unavailable */ }
  return out
}

function ensureLoaded(): ShellPrefs {
  if (prefs) return prefs
  if (typeof window === 'undefined') return {}
  const mirrored = readMirror()
  if (mirrored) {
    prefs = mirrored
    if (normalizeLoaded(prefs)) { writeMirror(); scheduleFlush() }
  } else {
    prefs = importLegacyKeys()
    pending = structuredClonePrefs(prefs)
    writeMirror()
    if (Object.keys(pending).length) scheduleFlush()
  }
  return prefs
}

const NAV_KEYS = ['entityType', 'entityId', 'bobbinId', 'metadata'] as const

/**
 * A navigation target as the shell needs it. Values that arrive via
 * window.history.state carry Next.js internals (`__NA`,
 * `__PRIVATE_NEXTJS_INTERNALS_TREE`) that must never reach the store — they
 * are large, opaque, and would push the blob past the server's size cap.
 */
function sanitizeNav(value: unknown): unknown {
  if (!value || typeof value !== 'object') return value
  const nav = value as Record<string, unknown>
  const out: Record<string, unknown> = {}
  for (const k of NAV_KEYS) if (nav[k] !== undefined) out[k] = nav[k]
  return out
}

function sanitizeValue(ns: ShellPrefNamespace, value: unknown): unknown {
  return ns === 'lastNav' ? sanitizeNav(value) : value
}

/** Rewrite lastNav entries that were stored before sanitizing existed; returns true if anything changed. */
function normalizeLoaded(p: ShellPrefs): boolean {
  let changed = false
  for (const [key, value] of Object.entries(p.lastNav ?? {})) {
    const clean = sanitizeNav(value)
    if (JSON.stringify(clean) !== JSON.stringify(value)) {
      p.lastNav![key] = clean
      ;(pending.lastNav ??= {})[key] = clean
      changed = true
    }
  }
  return changed
}

function structuredClonePrefs(p: ShellPrefs): ShellPrefs {
  return JSON.parse(JSON.stringify(p)) as ShellPrefs
}

export function getShellPrefs(): ShellPrefs { return ensureLoaded() }

export function getShellPref<T>(ns: ShellPrefNamespace, key: string, fallback: T): T {
  const value = ensureLoaded()[ns]?.[key]
  return value === undefined ? fallback : (value as T)
}

/** Set (or, with `null`, remove) one key. Mirrors at once; uploads debounced. */
export function setShellPref(ns: ShellPrefNamespace, key: string, rawValue: unknown): void {
  const current = ensureLoaded()
  const value = sanitizeValue(ns, rawValue)
  const existing = current[ns]?.[key]
  // Effects re-run with the same value on mount; do not turn that into traffic.
  if (JSON.stringify(existing) === JSON.stringify(value ?? undefined)) return
  const bucket = { ...(current[ns] ?? {}) }
  if (value === null || value === undefined) delete bucket[key]
  else bucket[key] = value
  prefs = { ...current, [ns]: bucket }
  ;(pending[ns] ??= {})[key] = value === undefined ? null : value
  writeMirror()
  notify()
  scheduleFlush()
}

export function subscribeShellPrefs(fn: () => void): () => void {
  listeners.add(fn)
  return () => { listeners.delete(fn) }
}

type Updater<T> = T | null | ((prev: T) => T | null)

/**
 * Read one preference reactively. The setter takes a value, `null` to clear,
 * or an updater like useState's. Server-side it renders `fallback`.
 */
export function useShellPref<T>(ns: ShellPrefNamespace, key: string, fallback: T): [T, (next: Updater<T>) => void] {
  const value = useSyncExternalStore(
    subscribeShellPrefs,
    () => getShellPref(ns, key, fallback),
    () => fallback,
  )
  const set = useCallback((next: Updater<T>) => {
    const resolved = typeof next === 'function'
      ? (next as (prev: T) => T | null)(getShellPref(ns, key, fallback))
      : next
    setShellPref(ns, key, resolved)
  }, [ns, key, fallback])
  return [value, set]
}

function scheduleFlush() {
  if (typeof window === 'undefined') return
  if (flushTimer) clearTimeout(flushTimer)
  flushTimer = setTimeout(() => { flushTimer = null; void flushShellPrefs() }, FLUSH_DELAY_MS)
}

/** Send whatever changed since the last successful flush. No-op without a token. */
export async function flushShellPrefs(opts: { keepalive?: boolean } = {}): Promise<void> {
  if (!apiToken || Object.keys(pending).length === 0) return
  const batch = pending
  pending = {}
  try {
    const { apiFetch } = await api()
    const res = await apiFetch('/api/users/me/shell-preferences', apiToken, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prefs: batch }),
      ...(opts.keepalive ? { keepalive: true } : {}),
    })
    if (!res.ok) throw new Error(`shell-preferences PATCH ${res.status}`)
  } catch {
    // Put the batch back under anything newer; the next change retries.
    for (const [ns, bucket] of Object.entries(batch) as [ShellPrefNamespace, Bucket][]) {
      pending[ns] = { ...bucket, ...(pending[ns] ?? {}) }
    }
  }
}

/**
 * Called once the shell knows the API token. Fetches the server copy once per
 * token, lets it win over the mirror, uploads local-only keys, and flushes
 * pending writes when the page is left. Returns a cleanup for the listener.
 */
export function startShellPrefsSync(token: string): () => void {
  apiToken = token
  ensureLoaded()
  if (!pagehideBound && typeof window !== 'undefined') {
    pagehideBound = true
    window.addEventListener('pagehide', () => { void flushShellPrefs({ keepalive: true }) })
  }
  if (fetchedForToken !== token) {
    fetchedForToken = token
    void (async () => {
      try {
        const { apiFetch } = await api()
        const res = await apiFetch('/api/users/me/shell-preferences', token)
        if (!res.ok) return
        const { prefs: server } = (await res.json()) as { prefs: ShellPrefs }
        const local = ensureLoaded()
        const merged: ShellPrefs = {}
        const namespaces = new Set([...Object.keys(local), ...Object.keys(server)]) as Set<ShellPrefNamespace>
        for (const ns of namespaces) {
          merged[ns] = { ...(local[ns] ?? {}), ...(server[ns] ?? {}) }
          // Keys only this browser knows about go up so the next device sees them.
          for (const [key, value] of Object.entries(local[ns] ?? {})) {
            if (server[ns]?.[key] === undefined) (pending[ns] ??= {})[key] = value
          }
        }
        prefs = merged
        writeMirror()
        notify()
        if (Object.keys(pending).length) scheduleFlush()
      } catch { /* offline: keep the mirror */ }
    })()
  }
  return () => { /* listeners are per-component; nothing to tear down here */ }
}

/** Test hook: forget everything, including the token. */
export function __resetShellPrefsForTests(): void {
  prefs = null; pending = {}; apiToken = null; fetchedForToken = null
  if (flushTimer) { clearTimeout(flushTimer); flushTimer = null }
  listeners.clear()
}
