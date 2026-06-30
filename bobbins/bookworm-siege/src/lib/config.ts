/**
 * Game configuration and high-score persistence (localStorage only — no DB).
 */

/**
 * The hidden "rescue word" bank. The writer never sees this list. When they
 * stall and the castle starts taking damage, ONE of these surfaces above the
 * castle — typing it calls a burst (catch-up) and, ideally, dares the writer
 * down a new, surprising path. It's the digital plastic ninja handed across the
 * table at a write-in: "if you're stuck, throw in a ninja."
 *
 * Kept to single tokens on purpose: word detection fires per completed word, so
 * multi-word phrases would never match.
 */
export const RESCUE_WORDS: string[] = [
  'ninja',
  'dragon',
  'explosion',
  'betrayal',
  'ghost',
  'sword',
  'traitor',
  'monster',
  'earthquake',
  'prophecy',
  'riddle',
  'storm',
  'vow',
  'curse',
  'knife',
  'mask',
  'shadow',
  'wolf',
  'crown',
  'poison',
  'duel',
  'ambush',
  'treasure',
  'spy',
  'ritual',
  'scream',
  'whisper',
  'raven',
  'comet',
  'volcano',
  'assassin',
  'portal',
  'demon',
  'phoenix',
  'kraken',
  'blizzard',
  'avalanche',
  'stampede',
  'rebellion',
  'smuggler',
  'lighthouse',
  'shipwreck',
  'labyrinth',
  'oracle',
  'plague',
  'mutiny',
  'heist',
  'eclipse',
  'banshee',
  'stranger',
]

/** Pick a random rescue word, avoiding an immediate repeat of `previous`. */
export function pickRescueWord(previous: string | null): string {
  if (RESCUE_WORDS.length <= 1) return RESCUE_WORDS[0]!
  let word = RESCUE_WORDS[Math.floor(Math.random() * RESCUE_WORDS.length)]!
  while (word === previous) {
    word = RESCUE_WORDS[Math.floor(Math.random() * RESCUE_WORDS.length)]!
  }
  return word
}

export interface GameConfig {
  /** Word-count target that wins the run. */
  goal: number
  /** Target words-per-minute the spawn rate is balanced around. */
  targetWpm: number
  /** Fire a burst every N completed words. */
  burstEvery: number
}

export const DEFAULT_CONFIG: GameConfig = {
  goal: 500,
  targetWpm: 40,
  burstEvery: 25,
}

const CONFIG_KEY = 'bobbinry:bookworm-siege:config'
const HIGHSCORE_KEY = 'bobbinry:bookworm-siege:highscore'

function safeStorage(): Storage | null {
  try {
    return typeof window !== 'undefined' ? window.localStorage : null
  } catch {
    return null
  }
}

export function loadConfig(): GameConfig {
  const store = safeStorage()
  if (!store) return { ...DEFAULT_CONFIG }
  try {
    const raw = store.getItem(CONFIG_KEY)
    if (!raw) return { ...DEFAULT_CONFIG }
    const parsed = JSON.parse(raw) as Record<string, unknown>
    return {
      goal: clampInt(parsed.goal, DEFAULT_CONFIG.goal, 1, 1_000_000),
      targetWpm: clampInt(parsed.targetWpm, DEFAULT_CONFIG.targetWpm, 1, 500),
      burstEvery: clampInt(parsed.burstEvery, DEFAULT_CONFIG.burstEvery, 1, 1000),
    }
  } catch {
    return { ...DEFAULT_CONFIG }
  }
}

export function saveConfig(config: GameConfig): void {
  const store = safeStorage()
  if (!store) return
  try {
    store.setItem(CONFIG_KEY, JSON.stringify(config))
  } catch {
    // storage full / unavailable — non-fatal
  }
}

export function loadHighScore(): number {
  const store = safeStorage()
  if (!store) return 0
  try {
    const raw = store.getItem(HIGHSCORE_KEY)
    const n = raw ? parseInt(raw, 10) : 0
    return Number.isFinite(n) && n > 0 ? n : 0
  } catch {
    return 0
  }
}

/** Persist `score` if it beats the stored best. Returns the (possibly new) best. */
export function recordHighScore(score: number): number {
  const best = loadHighScore()
  if (score <= best) return best
  const store = safeStorage()
  try {
    store?.setItem(HIGHSCORE_KEY, String(score))
  } catch {
    // non-fatal
  }
  return score
}

function clampInt(value: unknown, fallback: number, min: number, max: number): number {
  const n = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(n)) return fallback
  return Math.min(max, Math.max(min, Math.round(n)))
}
