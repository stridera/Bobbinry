'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { Game } from '../lib/engine'
import { draw, type RenderTheme } from '../lib/render'
import { newlyCompleted, normalizeWord } from '../lib/words'
import { WpmTracker } from '../lib/wpm'
import {
  DEFAULT_CONFIG,
  loadConfig,
  loadHighScore,
  pickRescueWord,
  recordHighScore,
  saveConfig,
  type GameConfig,
} from '../lib/config'

type Phase = 'config' | 'playing' | 'won'

interface Hud {
  wpm: number
  words: number
  score: number
  pressure: number
  shield: number
}

// Guard against a chapter-load / paste dumping the whole document as "typed".
const MAX_WORDS_PER_EVENT = 12

// Gate pressure (0..10) at which the surprise rescue word appears.
const RESCUE_PRESSURE = 2

const now = (): number =>
  typeof performance !== 'undefined' ? performance.now() : Date.now()

const LIGHT_THEME: RenderTheme = {
  path: '#e7d8c0',
  pathEdge: '#cbb894',
  worm: '#7cb342',
  wormEdge: '#3f7117',
  stone: '#cbd5e1',
  stoneEdge: '#94a3b8',
  text: '#374151',
  danger: '#ef4444',
  accent: '#7c3aed',
}
const DARK_THEME: RenderTheme = {
  path: '#3f3a32',
  pathEdge: '#26221c',
  worm: '#7bc24a',
  wormEdge: '#356012',
  stone: '#64748b',
  stoneEdge: '#475569',
  text: '#d1d5db',
  danger: '#f87171',
  accent: '#a78bfa',
}

export default function GamePanel() {
  const [mounted, setMounted] = useState(false)
  const [phase, setPhase] = useState<Phase>('config')
  const [config, setConfig] = useState<GameConfig>(DEFAULT_CONFIG)
  const [hud, setHud] = useState<Hud>({ wpm: 0, words: 0, score: 0, pressure: 0, shield: 0 })
  const [best, setBest] = useState(0)
  const [finalScore, setFinalScore] = useState(0)
  // Mirror of rescueWordRef for the DOM overlay (only changes on transitions).
  const [rescueWord, setRescueWord] = useState<string | null>(null)

  // Live game refs (read by the once-attached event listener + RAF loop).
  const gameRef = useRef<Game | null>(null)
  const wpmRef = useRef(new WpmTracker())
  const prevTextRef = useRef('')
  const primedRef = useRef(false)
  const wordsRef = useRef(0)
  const lastBurstWordRef = useRef(0)
  // The surprise word currently offered above the castle (hidden until stuck).
  const rescueWordRef = useRef<string | null>(null)
  const lastRescueRef = useRef<string | null>(null)
  const configRef = useRef<GameConfig>(DEFAULT_CONFIG)
  const phaseRef = useRef<Phase>('config')

  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const sizeRef = useRef({ w: 0, h: 0 })
  const reducedMotionRef = useRef(false)

  // ---- mount: load persisted config + high score ----------------------
  useEffect(() => {
    const loaded = loadConfig()
    setConfig(loaded)
    configRef.current = loaded
    setBest(loadHighScore())
    reducedMotionRef.current =
      typeof window !== 'undefined' &&
      window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
    setMounted(true)
  }, [])

  useEffect(() => {
    phaseRef.current = phase
  }, [phase])

  const updateConfig = useCallback((next: GameConfig) => {
    setConfig(next)
    configRef.current = next
  }, [])

  // ---- start a run ----------------------------------------------------
  const startRun = useCallback(() => {
    const parsed = configRef.current
    saveConfig(parsed)

    gameRef.current = new Game(parsed.targetWpm)
    wpmRef.current.reset()
    prevTextRef.current = ''
    primedRef.current = false
    wordsRef.current = 0
    lastBurstWordRef.current = 0
    rescueWordRef.current = null
    lastRescueRef.current = null
    setRescueWord(null)
    setHud({ wpm: 0, words: 0, score: 0, pressure: 0, shield: 0 })
    setPhase('playing')
  }, [])

  const stopRun = useCallback(() => {
    const score = gameRef.current?.stats.score ?? 0
    setBest(recordHighScore(score))
    gameRef.current = null
    setPhase('config')
  }, [])

  // ---- typing → towers (attached once while playing) ------------------
  useEffect(() => {
    if (phase !== 'playing') return

    const handleContentUpdate = (event: Event) => {
      const detail = (event as CustomEvent<{ text: string }>).detail
      if (typeof detail?.text !== 'string') return
      const text = detail.text

      // First event after Start primes the baseline so existing chapter text
      // doesn't fire a tower per word.
      if (!primedRef.current) {
        primedRef.current = true
        prevTextRef.current = text
        return
      }

      let words = newlyCompleted(prevTextRef.current, text)
      prevTextRef.current = text
      const game = gameRef.current
      if (!game || words.length === 0) return
      if (words.length > MAX_WORDS_PER_EVENT) words = words.slice(-MAX_WORDS_PER_EVENT)

      const t = now()
      for (const word of words) {
        game.fireTower(word)
        wpmRef.current.add(t)
        wordsRef.current++

        // Did the writer type the surprise rescue word? Big catch-up burst.
        const rescue = rescueWordRef.current
        if (rescue && normalizeWord(word) === normalizeWord(rescue)) {
          game.rescue()
          rescueWordRef.current = null
          setRescueWord(null)
        }
      }

      // Milestone bursts every N words.
      const burstEvery = configRef.current.burstEvery
      while (wordsRef.current - lastBurstWordRef.current >= burstEvery) {
        lastBurstWordRef.current += burstEvery
        game.burst()
      }

      // Win check.
      if (wordsRef.current >= configRef.current.goal) {
        const score = game.stats.score
        setFinalScore(score)
        setBest(recordHighScore(score))
        gameRef.current = null
        setPhase('won')
      }
    }

    window.addEventListener('bobbinry:editor-content-update', handleContentUpdate)
    return () =>
      window.removeEventListener('bobbinry:editor-content-update', handleContentUpdate)
  }, [phase])

  // ---- render loop ----------------------------------------------------
  useEffect(() => {
    if (phase !== 'playing') return
    const canvas = canvasRef.current
    if (!canvas) return
    const container = canvas.parentElement
    if (!container) return

    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const resize = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2)
      const w = container.clientWidth
      const h = container.clientHeight
      sizeRef.current = { w, h }
      canvas.width = Math.max(1, Math.round(w * dpr))
      canvas.height = Math.max(1, Math.round(h * dpr))
      canvas.style.width = `${w}px`
      canvas.style.height = `${h}px`
    }
    resize()
    const ro = new ResizeObserver(resize)
    ro.observe(container)

    let raf = 0
    let last = now()
    let hudFlush = 0

    const frame = () => {
      const t = now()
      const dt = (t - last) / 1000
      last = t
      const game = gameRef.current
      if (game) {
        game.step(dt)

        // Surface a surprise rescue word once the castle starts taking damage;
        // drop it again if the writer recovers without using it (fresh next time).
        if (!rescueWordRef.current && game.stats.pressure >= RESCUE_PRESSURE) {
          rescueWordRef.current = pickRescueWord(lastRescueRef.current)
          lastRescueRef.current = rescueWordRef.current
          setRescueWord(rescueWordRef.current)
        } else if (rescueWordRef.current && game.stats.pressure <= 0.05) {
          rescueWordRef.current = null
          setRescueWord(null)
        }

        const dpr = Math.min(window.devicePixelRatio || 1, 2)
        const { w, h } = sizeRef.current
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
        const dark =
          typeof document !== 'undefined' &&
          document.documentElement.classList.contains('dark')
        draw(ctx, game, {
          width: w,
          height: h,
          now: t,
          reducedMotion: reducedMotionRef.current,
          theme: dark ? DARK_THEME : LIGHT_THEME,
        })

        hudFlush += dt
        if (hudFlush >= 0.15) {
          hudFlush = 0
          setHud({
            wpm: wpmRef.current.wpm(t),
            words: wordsRef.current,
            score: game.stats.score,
            pressure: game.stats.pressure,
            shield: game.stats.shield,
          })
        }
      }
      raf = requestAnimationFrame(frame)
    }
    raf = requestAnimationFrame(frame)

    return () => {
      cancelAnimationFrame(raf)
      ro.disconnect()
    }
  }, [phase])

  // ---- render ---------------------------------------------------------
  if (!mounted) {
    return <div className="p-3 text-sm text-gray-400 dark:text-gray-500">Loading…</div>
  }

  if (phase === 'config') {
    return (
      <ConfigScreen
        config={config}
        best={best}
        onChange={updateConfig}
        onStart={startRun}
      />
    )
  }

  if (phase === 'won') {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-4 p-4 text-center">
        <span className="text-5xl">🎉</span>
        <div>
          <p className="text-lg font-semibold text-gray-800 dark:text-gray-100">
            Goal reached!
          </p>
          <p className="text-sm text-gray-500 dark:text-gray-400">
            {config.goal.toLocaleString()} words · score {finalScore.toLocaleString()}
          </p>
        </div>
        <p className="text-xs text-gray-400 dark:text-gray-500">
          Best score: {best.toLocaleString()}
        </p>
        <button
          type="button"
          onClick={() => setPhase('config')}
          className="rounded-md bg-violet-600 px-4 py-2 text-sm font-medium text-white hover:bg-violet-500"
        >
          New run
        </button>
      </div>
    )
  }

  // playing
  const goalPct = Math.min(100, Math.round((hud.words / Math.max(1, config.goal)) * 100))
  const onPace = hud.wpm >= config.targetWpm
  const underPressure = hud.pressure > 4

  return (
    <div className="flex h-full min-h-[340px] flex-col">
      <div className="relative h-72 flex-none">
        <canvas ref={canvasRef} className="block h-full w-full" />
        {/* Surprise rescue word, above the castle — only while stuck. */}
        {rescueWord && (
          <div
            className="pointer-events-none absolute inset-x-0 top-2 flex justify-center"
            aria-live="polite"
          >
            <span className="animate-pulse rounded-full bg-violet-600 px-3 py-1 text-xs font-semibold text-white shadow-lg shadow-violet-500/40">
              ✦ {rescueWord}
            </span>
          </div>
        )}
      </div>

      <div className="border-t border-gray-200 px-3 py-2 dark:border-gray-700">
        <div className="mb-1.5 flex items-center justify-between text-xs">
          <span
            className={
              onPace
                ? 'font-medium text-green-600 dark:text-green-400'
                : 'font-medium text-amber-600 dark:text-amber-400'
            }
          >
            {hud.wpm} / {config.targetWpm} wpm
          </span>
          <span className="text-gray-500 dark:text-gray-400">
            score {hud.score.toLocaleString()}
          </span>
        </div>

        <div className="mb-1 flex items-center justify-between text-[11px] text-gray-500 dark:text-gray-400">
          <span>
            {hud.words.toLocaleString()} / {config.goal.toLocaleString()} words
          </span>
          {underPressure ? (
            <span className="text-red-500 dark:text-red-400">gate under siege!</span>
          ) : hud.shield > 0 ? (
            <span className="text-pink-500 dark:text-pink-400">
              {'♥'.repeat(hud.shield)} shield
            </span>
          ) : (
            <span>keep writing</span>
          )}
        </div>
        <div className="h-1.5 w-full overflow-hidden rounded-full bg-gray-200 dark:bg-gray-700">
          <div
            className="h-full rounded-full bg-violet-500 transition-[width] duration-300"
            style={{ width: `${goalPct}%` }}
          />
        </div>

        <button
          type="button"
          onClick={stopRun}
          className="mt-2 w-full rounded-md border border-gray-300 py-1 text-xs text-gray-600 hover:bg-gray-50 dark:border-gray-600 dark:text-gray-300 dark:hover:bg-gray-800"
        >
          End run
        </button>
      </div>
    </div>
  )
}

function ConfigScreen({
  config,
  best,
  onChange,
  onStart,
}: {
  config: GameConfig
  best: number
  onChange: (next: GameConfig) => void
  onStart: () => void
}) {
  return (
    <div className="flex flex-col gap-4 p-3">
      <div className="text-center">
        <span className="text-3xl">🏰</span>
        <h3 className="mt-1 text-sm font-semibold text-gray-800 dark:text-gray-100">
          Bookworm Siege
        </h3>
        <p className="mt-0.5 text-xs text-gray-500 dark:text-gray-400">
          Every word you type fires a tower. Keep your pace and hold the line — if
          you stall, a surprise word appears to get you moving again.
        </p>
      </div>

      <label className="flex flex-col gap-1 text-xs text-gray-600 dark:text-gray-300">
        Word goal
        <input
          type="number"
          min={1}
          value={config.goal}
          onChange={(e) =>
            onChange({ ...config, goal: Math.max(1, Number(e.target.value) || 0) })
          }
          className="rounded-md border border-gray-300 bg-white px-2 py-1 text-sm text-gray-900 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100"
        />
      </label>

      <label className="flex flex-col gap-1 text-xs text-gray-600 dark:text-gray-300">
        Target WPM
        <input
          type="number"
          min={1}
          value={config.targetWpm}
          onChange={(e) =>
            onChange({ ...config, targetWpm: Math.max(1, Number(e.target.value) || 0) })
          }
          className="rounded-md border border-gray-300 bg-white px-2 py-1 text-sm text-gray-900 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100"
        />
      </label>

      <button
        type="button"
        onClick={onStart}
        className="rounded-md bg-violet-600 px-4 py-2 text-sm font-medium text-white hover:bg-violet-500"
      >
        Start writing
      </button>

      {best > 0 && (
        <p className="text-center text-[11px] text-gray-400 dark:text-gray-500">
          Best score: {best.toLocaleString()}
        </p>
      )}
    </div>
  )
}
