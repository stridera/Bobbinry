/**
 * Preferences live inside the reader's existing `bobbinry-reader-prefs`
 * localStorage blob so they work for signed-out readers and survive alongside
 * font/theme settings. Only our `tts*` keys are touched.
 */

import { clampRate } from './speech'

export const READER_PREFS_KEY = 'bobbinry-reader-prefs'
export const AUTOPLAY_KEY = 'bobbinry-reader-tts-autoplay'

export interface TtsPrefs {
  voiceURI: string | null
  rate: number
  autoAdvance: boolean
}

export const DEFAULT_TTS_PREFS: TtsPrefs = {
  voiceURI: null,
  rate: 1,
  autoAdvance: true,
}

function getLocalStorage(): Storage | null {
  try {
    return typeof window !== 'undefined' ? window.localStorage : null
  } catch {
    return null
  }
}

function getSessionStorage(): Storage | null {
  try {
    return typeof window !== 'undefined' ? window.sessionStorage : null
  } catch {
    return null
  }
}

function readBlob(storage: Storage | null): Record<string, unknown> {
  if (!storage) return {}
  try {
    const raw = storage.getItem(READER_PREFS_KEY)
    const parsed = raw ? JSON.parse(raw) : {}
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : {}
  } catch {
    return {}
  }
}

export function readTtsPrefs(storage: Storage | null = getLocalStorage()): TtsPrefs {
  const blob = readBlob(storage)
  return {
    voiceURI: typeof blob.ttsVoiceURI === 'string' ? blob.ttsVoiceURI : null,
    rate: typeof blob.ttsRate === 'number' ? clampRate(blob.ttsRate) : DEFAULT_TTS_PREFS.rate,
    autoAdvance: typeof blob.ttsAutoAdvance === 'boolean' ? blob.ttsAutoAdvance : DEFAULT_TTS_PREFS.autoAdvance,
  }
}

export function writeTtsPrefs(partial: Partial<TtsPrefs>, storage: Storage | null = getLocalStorage()): void {
  if (!storage) return
  const blob = readBlob(storage)
  if (partial.voiceURI !== undefined) blob.ttsVoiceURI = partial.voiceURI
  if (partial.rate !== undefined) blob.ttsRate = clampRate(partial.rate)
  if (partial.autoAdvance !== undefined) blob.ttsAutoAdvance = partial.autoAdvance
  try {
    storage.setItem(READER_PREFS_KEY, JSON.stringify(blob))
  } catch {
    // Storage full or blocked; prefs are best-effort.
  }
}

/** Compare hrefs by decoded pathname only; query strings (viewAs etc.) may differ. */
export function normalizeHrefPath(href: string): string {
  const path = href.split(/[?#]/)[0] ?? ''
  try {
    return decodeURIComponent(path).replace(/\/+$/, '')
  } catch {
    return path.replace(/\/+$/, '')
  }
}

/** Record that the next chapter should start playing as soon as it mounts. */
export function setAutoplayTarget(href: string, storage: Storage | null = getSessionStorage()): void {
  if (!storage) return
  try {
    storage.setItem(AUTOPLAY_KEY, normalizeHrefPath(href))
  } catch {
    // ignore
  }
}

/**
 * If an autoplay handoff targets `currentHref`, clear it and return true.
 * Any stale target is cleared as well so it cannot fire on a later visit.
 */
export function consumeAutoplayTarget(currentHref: string, storage: Storage | null = getSessionStorage()): boolean {
  if (!storage) return false
  try {
    const target = storage.getItem(AUTOPLAY_KEY)
    if (!target) return false
    storage.removeItem(AUTOPLAY_KEY)
    return target === normalizeHrefPath(currentHref)
  } catch {
    return false
  }
}
