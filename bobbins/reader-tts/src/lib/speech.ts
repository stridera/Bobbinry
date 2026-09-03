/**
 * Thin controller over `window.speechSynthesis`.
 *
 * Speaks segments chunk by chunk, keeps a strong reference to the live
 * utterance (Chrome drops `onend` on garbage-collected utterances), and uses a
 * generation counter so callbacks from cancelled utterances are ignored.
 */

import type { Segment } from './segments'

export type SpeechState = 'idle' | 'playing' | 'paused'

export interface SpeechCallbacks {
  onSegmentStart?: (index: number) => void
  /** Fired only when playback reaches the end naturally (not on stop/error). */
  onEnd?: () => void
  onError?: (error: unknown) => void
  onStateChange?: (state: SpeechState) => void
}

export interface SpeechController {
  play(segments: Segment[], from?: number): void
  pause(): void
  resume(): void
  stop(): void
  setRate(rate: number): void
  setVoice(voice: SpeechSynthesisVoice | null): void
  getState(): SpeechState
  getIndex(): number
}

export const MIN_RATE = 0.5
export const MAX_RATE = 2

export function clampRate(rate: number): number {
  if (!Number.isFinite(rate)) return 1
  return Math.min(MAX_RATE, Math.max(MIN_RATE, Math.round(rate * 10) / 10))
}

/** Errors the engine reports when we cancel on purpose. */
const BENIGN_ERRORS = new Set(['interrupted', 'canceled'])

export function createSpeechController(
  synth: SpeechSynthesis,
  callbacks: SpeechCallbacks = {}
): SpeechController {
  let segments: Segment[] = []
  let segmentIndex = 0
  let chunkIndex = 0
  let generation = 0
  let state: SpeechState = 'idle'
  let rate = 1
  let voice: SpeechSynthesisVoice | null = null
  let current: SpeechSynthesisUtterance | null = null

  const setState = (next: SpeechState) => {
    if (state === next) return
    state = next
    callbacks.onStateChange?.(next)
  }

  const invalidate = () => {
    generation += 1
    current = null
  }

  const finish = (natural: boolean) => {
    invalidate()
    segments = []
    segmentIndex = 0
    chunkIndex = 0
    setState('idle')
    if (natural) callbacks.onEnd?.()
  }

  const speakCurrent = () => {
    const segment = segments[segmentIndex]
    if (!segment) {
      finish(true)
      return
    }
    const text = segment.chunks[chunkIndex]
    if (text === undefined) {
      advance()
      return
    }
    if (chunkIndex === 0) callbacks.onSegmentStart?.(segmentIndex)

    const gen = generation
    const utterance = new SpeechSynthesisUtterance(text)
    utterance.rate = rate
    if (voice) {
      utterance.voice = voice
      utterance.lang = voice.lang
    }
    utterance.onend = () => {
      if (gen !== generation) return
      chunkIndex += 1
      if (chunkIndex >= segment.chunks.length) advance()
      else speakCurrent()
    }
    utterance.onerror = (event: SpeechSynthesisErrorEvent) => {
      if (gen !== generation) return
      if (BENIGN_ERRORS.has(event.error)) return
      callbacks.onError?.(event)
      finish(false)
    }
    current = utterance
    synth.speak(utterance)
  }

  const advance = () => {
    segmentIndex += 1
    chunkIndex = 0
    if (segmentIndex >= segments.length) finish(true)
    else speakCurrent()
  }

  const restartChunk = () => {
    invalidate()
    synth.cancel()
    speakCurrent()
  }

  return {
    play(next, from = 0) {
      invalidate()
      synth.cancel()
      segments = next
      segmentIndex = Math.max(0, Math.min(from, next.length))
      chunkIndex = 0
      if (segments.length === 0) {
        finish(true)
        return
      }
      setState('playing')
      speakCurrent()
    },
    pause() {
      if (state !== 'playing') return
      synth.pause()
      setState('paused')
    },
    resume() {
      if (state !== 'paused') return
      setState('playing')
      synth.resume()
      // Chrome can drop the utterance during a long pause; restart the chunk if the engine went idle.
      setTimeout(() => {
        if (state === 'playing' && current && !synth.speaking && !synth.pending) restartChunk()
      }, 250)
    },
    stop() {
      const wasActive = state !== 'idle'
      invalidate()
      synth.cancel()
      segments = []
      segmentIndex = 0
      chunkIndex = 0
      if (wasActive) setState('idle')
    },
    setRate(next) {
      const clamped = clampRate(next)
      if (clamped === rate) return
      rate = clamped
      if (state === 'playing') restartChunk()
    },
    setVoice(next) {
      if (next === voice) return
      voice = next
      if (state === 'playing') restartChunk()
    },
    getState: () => state,
    getIndex: () => segmentIndex,
  }
}

/**
 * Resolve the voice list. Chrome returns an empty list until `voiceschanged`
 * fires; Safari and Firefox usually have it ready synchronously.
 */
export function loadVoices(synth: SpeechSynthesis, timeoutMs = 1500): Promise<SpeechSynthesisVoice[]> {
  const immediate = synth.getVoices()
  if (immediate.length > 0) return Promise.resolve(immediate)

  return new Promise(resolve => {
    let settled = false
    const done = () => {
      if (settled) return
      settled = true
      synth.removeEventListener?.('voiceschanged', done)
      resolve(synth.getVoices())
    }
    synth.addEventListener?.('voiceschanged', done)
    setTimeout(done, timeoutMs)
  })
}

/** Prefer a default voice for the page language, then any voice for it, then the engine default. */
export function pickDefaultVoice(
  voices: SpeechSynthesisVoice[],
  lang: string
): SpeechSynthesisVoice | null {
  if (voices.length === 0) return null
  const base = lang.toLowerCase().split('-')[0] ?? ''
  const matches = base ? voices.filter(v => v.lang.toLowerCase().startsWith(base)) : []
  return (
    matches.find(v => v.default) ??
    matches[0] ??
    voices.find(v => v.default) ??
    voices[0] ??
    null
  )
}
