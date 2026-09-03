'use client'

/**
 * Read Aloud toolbar control for the public reader.
 *
 * Mounted in the `reader.toolbar` slot. Speaks the chapter with the browser's
 * speechSynthesis engine, highlights the paragraph being read, and hands off
 * to the next chapter when the current one finishes.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { collectSegments, titleSegment, type Segment } from '../lib/segments'
import {
  createSpeechController,
  loadVoices,
  pickDefaultVoice,
  MAX_RATE,
  MIN_RATE,
  type SpeechController,
  type SpeechState,
} from '../lib/speech'
import {
  consumeAutoplayTarget,
  readTtsPrefs,
  setAutoplayTarget,
  writeTtsPrefs,
  type TtsPrefs,
} from '../lib/prefs'
import { clearHighlight, highlightSegment, type ReaderTheme } from '../lib/highlight'

interface ReaderSlotContext {
  chapterId?: string | null
  projectId?: string | null
  readerTheme?: ReaderTheme
  chapterTitle?: string | null
  contentElementId?: string
  nextChapterHref?: string | null
  navigate?: (href: string) => void
}

type ListenPanelProps = ReaderSlotContext & { context?: ReaderSlotContext }

function hasSpeechSynthesis(): boolean {
  return typeof window !== 'undefined' && 'speechSynthesis' in window && typeof window.SpeechSynthesisUtterance === 'function'
}

function currentHref(): string {
  if (typeof window === 'undefined') return ''
  return `${window.location.pathname}${window.location.search}`
}

const ICONS = {
  play: <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 4l14 8-14 8V4z" />,
  pause: <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 5v14M16 5v14" />,
  stop: <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 6h12v12H6z" />,
  settings: (
    <path
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth={2}
      d="M4 6h10M18 6h2M4 12h2M10 12h10M4 18h10M18 18h2M14 4v4M6 10v4M14 16v4"
    />
  ),
}

function Icon({ name, className }: { name: keyof typeof ICONS; className: string }) {
  return (
    <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
      {ICONS[name]}
    </svg>
  )
}

export default function ListenPanel(props: ListenPanelProps) {
  const ctx = props.context ?? props
  const chapterId = ctx.chapterId ?? props.chapterId ?? null
  const readerTheme: ReaderTheme = ctx.readerTheme ?? props.readerTheme ?? 'light'
  const chapterTitle = ctx.chapterTitle ?? props.chapterTitle ?? null
  const contentElementId = ctx.contentElementId ?? props.contentElementId ?? 'reader-chapter-content'
  const nextChapterHref = ctx.nextChapterHref ?? props.nextChapterHref ?? null
  const navigate = ctx.navigate ?? props.navigate

  const [supported] = useState(hasSpeechSynthesis)
  const [prefs, setPrefs] = useState<TtsPrefs>(() => readTtsPrefs())
  const [state, setState] = useState<SpeechState>('idle')
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([])
  const [showSettings, setShowSettings] = useState(false)

  const controllerRef = useRef<SpeechController | null>(null)
  const segmentsRef = useRef<Segment[]>([])
  const activeElRef = useRef<HTMLElement | null>(null)
  const themeRef = useRef<ReaderTheme>(readerTheme)
  const prefsRef = useRef<TtsPrefs>(prefs)
  const nextHrefRef = useRef<string | null>(nextChapterHref)
  const navigateRef = useRef<typeof navigate>(navigate)
  const popoverRef = useRef<HTMLDivElement | null>(null)

  themeRef.current = readerTheme
  prefsRef.current = prefs
  nextHrefRef.current = nextChapterHref
  navigateRef.current = navigate

  const clearActiveHighlight = useCallback(() => {
    clearHighlight(activeElRef.current)
    activeElRef.current = null
  }, [])

  const getController = useCallback((): SpeechController | null => {
    if (!supported) return null
    if (controllerRef.current) return controllerRef.current
    controllerRef.current = createSpeechController(window.speechSynthesis, {
      onStateChange: next => setState(next),
      onSegmentStart: index => {
        clearHighlight(activeElRef.current)
        const el = segmentsRef.current[index]?.el ?? null
        activeElRef.current = el
        if (el) highlightSegment(el, themeRef.current)
      },
      onEnd: () => {
        clearHighlight(activeElRef.current)
        activeElRef.current = null
        const href = nextHrefRef.current
        const go = navigateRef.current
        if (prefsRef.current.autoAdvance && href && go) {
          setAutoplayTarget(href)
          go(href)
        }
      },
      onError: error => {
        console.error('[reader-tts] speech error', error)
        clearHighlight(activeElRef.current)
        activeElRef.current = null
      },
    })
    return controllerRef.current
  }, [supported])

  const selectedVoice = useMemo(() => {
    if (voices.length === 0) return null
    const chosen = prefs.voiceURI ? voices.find(v => v.voiceURI === prefs.voiceURI) : undefined
    if (chosen) return chosen
    const lang = typeof document !== 'undefined' ? document.documentElement.lang || navigator.language : 'en'
    return pickDefaultVoice(voices, lang)
  }, [voices, prefs.voiceURI])

  const startPlayback = useCallback(() => {
    const controller = getController()
    if (!controller) return
    const root = document.getElementById(contentElementId)
    if (!root) return
    const body = collectSegments(root)
    const intro = chapterTitle ? titleSegment(chapterTitle) : null
    const all = intro ? [intro, ...body] : body
    segmentsRef.current = all
    controller.setRate(prefsRef.current.rate)
    controller.setVoice(selectedVoice)
    controller.play(all)
  }, [getController, contentElementId, chapterTitle, selectedVoice])

  // Voices arrive asynchronously in Chrome.
  useEffect(() => {
    if (!supported) return
    let cancelled = false
    loadVoices(window.speechSynthesis).then(list => {
      if (!cancelled) setVoices(list)
    })
    return () => {
      cancelled = true
    }
  }, [supported])

  // Keep the engine in sync with prefs while playing.
  useEffect(() => {
    controllerRef.current?.setRate(prefs.rate)
  }, [prefs.rate])

  useEffect(() => {
    controllerRef.current?.setVoice(selectedVoice)
  }, [selectedVoice])

  // Chapter lifecycle: auto-start after a handoff, and stop when the chapter changes or we unmount.
  useEffect(() => {
    if (!supported || !chapterId) return
    // Consume the hand-off flag on a cancellable tick so React Strict Mode's
    // mount/cleanup/mount double-invoke in dev cannot swallow it.
    const timer = window.setTimeout(() => {
      if (consumeAutoplayTarget(currentHref())) startPlayback()
    }, 0)
    return () => {
      window.clearTimeout(timer)
      controllerRef.current?.stop()
      clearActiveHighlight()
    }
    // startPlayback is stable per chapter; re-running on its identity would stop playback mid-chapter.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [supported, chapterId])

  // Close the settings popover on outside click or Escape.
  useEffect(() => {
    if (!showSettings) return
    const onMouseDown = (event: MouseEvent) => {
      if (popoverRef.current && !popoverRef.current.contains(event.target as Node)) setShowSettings(false)
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setShowSettings(false)
    }
    document.addEventListener('mousedown', onMouseDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('mousedown', onMouseDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [showSettings])

  const updatePrefs = useCallback((partial: Partial<TtsPrefs>) => {
    setPrefs(prev => {
      const next = { ...prev, ...partial }
      writeTtsPrefs(partial)
      return next
    })
  }, [])

  if (!supported) return null

  const handlePlayPause = () => {
    const controller = getController()
    if (!controller) return
    if (state === 'playing') controller.pause()
    else if (state === 'paused') controller.resume()
    else startPlayback()
  }

  const handleStop = () => {
    controllerRef.current?.stop()
    clearActiveHighlight()
  }

  const isDark = readerTheme === 'dark'
  const isSepia = readerTheme === 'sepia'
  const hoverBg = isDark ? 'hover:bg-gray-800' : isSepia ? 'hover:bg-amber-100' : 'hover:bg-gray-100'
  const mutedText = isDark ? 'text-gray-400' : isSepia ? 'text-amber-700' : 'text-gray-500'
  const activeText = isDark ? 'text-blue-300' : 'text-blue-600'
  const popoverSurface = isDark
    ? 'bg-gray-900 border-gray-700 text-gray-100'
    : isSepia
      ? 'bg-amber-50 border-amber-200 text-amber-950'
      : 'bg-white border-gray-200 text-gray-900'
  const inputSurface = isDark
    ? 'bg-gray-800 border-gray-700 text-gray-100'
    : isSepia
      ? 'bg-white border-amber-200 text-amber-950'
      : 'bg-white border-gray-300 text-gray-900'
  const buttonClass = `p-1.5 rounded ${hoverBg} transition-colors`

  const sortedVoices = voices
  const isActive = state !== 'idle'
  const playLabel = state === 'playing' ? 'Pause reading' : state === 'paused' ? 'Resume reading' : 'Listen to this chapter'

  return (
    <div ref={popoverRef} className="relative flex items-center gap-1" data-reader-tts>
      <button
        type="button"
        onClick={handlePlayPause}
        className={`${buttonClass} ${isActive ? activeText : mutedText}`}
        aria-label={playLabel}
        aria-pressed={state === 'playing'}
        title={playLabel}
      >
        <Icon name={state === 'playing' ? 'pause' : 'play'} className="w-4 h-4" />
      </button>
      {isActive && (
        <button
          type="button"
          onClick={handleStop}
          className={`${buttonClass} ${mutedText}`}
          aria-label="Stop reading"
          title="Stop reading"
        >
          <Icon name="stop" className="w-4 h-4" />
        </button>
      )}
      <button
        type="button"
        onClick={() => setShowSettings(open => !open)}
        className={`${buttonClass} ${showSettings ? activeText : mutedText}`}
        aria-label="Read aloud settings"
        aria-expanded={showSettings}
        title="Read aloud settings"
      >
        <Icon name="settings" className="w-4 h-4" />
      </button>
      {isActive && (
        <span className={`text-xs ${mutedText} hidden sm:inline`} aria-live="polite">
          {state === 'paused' ? 'Paused' : 'Reading aloud'}
        </span>
      )}

      {showSettings && (
        <div
          role="dialog"
          aria-label="Read aloud settings"
          className={`absolute left-0 top-full mt-1 z-20 w-72 rounded-lg border p-3 shadow-lg space-y-3 text-sm ${popoverSurface}`}
        >
          <label className="block">
            <span className={`block text-xs mb-1 ${mutedText}`}>Voice</span>
            <select
              value={selectedVoice?.voiceURI ?? ''}
              onChange={event => updatePrefs({ voiceURI: event.target.value || null })}
              className={`w-full rounded border px-2 py-1 text-sm ${inputSurface}`}
            >
              {sortedVoices.length === 0 && <option value="">Browser default</option>}
              {sortedVoices.map(voice => (
                <option key={voice.voiceURI} value={voice.voiceURI}>
                  {voice.name} ({voice.lang})
                </option>
              ))}
            </select>
          </label>

          <label className="block">
            <span className={`flex justify-between text-xs mb-1 ${mutedText}`}>
              <span>Speed</span>
              <span>{prefs.rate.toFixed(1)}&times;</span>
            </span>
            <input
              type="range"
              min={MIN_RATE}
              max={MAX_RATE}
              step={0.1}
              value={prefs.rate}
              onChange={event => updatePrefs({ rate: Number(event.target.value) })}
              className="w-full"
              aria-label="Reading speed"
            />
          </label>

          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={prefs.autoAdvance}
              onChange={event => updatePrefs({ autoAdvance: event.target.checked })}
            />
            <span>Continue to the next chapter automatically</span>
          </label>
        </div>
      )}
    </div>
  )
}
