/**
 * Bookworm Siege — game simulation.
 *
 * Pure TypeScript, no React and no canvas. The engine owns the live entities
 * (bookworms, siegers, towers, projectiles) and advances them each frame. The
 * panel drives it: it calls `fireTower(word)` once per completed word, `burst()`
 * on milestones / rescue words, and `step(dt)` every animation frame.
 *
 * Positions along the path are normalised: a bookworm's `t` runs 0 (entry, at
 * the bottom) → 1 (the castle, at the top). Towers sit at fixed `t`. Rendering
 * maps `t` to screen coordinates; the engine stays resolution-independent.
 *
 * When a worm reaches the gate it does NOT vanish — it becomes a `sieger` that
 * queues up on the path near the castle and repeatedly flings itself at the gate
 * (its `t` lunges toward 1 and recoils). Siegers never damage the castle (no
 * real punishment), but they linger as visible pressure until your towers clear
 * them, which is the nudge to catch up. Towers target siegers first.
 */

export interface Bookworm {
  id: number
  t: number // 0 = entry, 1 = castle
  hp: number
  maxHp: number
  speed: number // units of t per second
  wobble: number // phase seed for the render wiggle
  incoming: number // damage already in-flight toward this worm
}

export interface Sieger {
  id: number
  hp: number
  maxHp: number
  incoming: number
  phase: number // seed for the fling animation
  t: number // live position on the path (engine-updated), lunges toward 1
}

export interface Tower {
  id: number
  t: number // position along the path
  side: -1 | 1 // which side of the path it sits on
  flash: number // muzzle-flash timer (seconds remaining)
}

export interface Projectile {
  id: number
  fromT: number
  fromSide: -1 | 1
  targetId: number | null
  // remembered target position so a projectile still flies if its target dies
  targetT: number
  progress: number // 0 → 1
  word: string
}

export interface GameStats {
  score: number
  kills: number
  pressure: number // number of bookworms bashing the gate, 0..MAX_PRESSURE
  shield: number // "love" banked while ahead; absorbs gate-reachers, 0..MAX_SHIELD
}

interface Aim {
  ref: Bookworm | Sieger
  isSieger: boolean
}

// Towers sit at the wave's turning points (where the path swings furthest to a
// side), pushed outward onto the crest rather than on the path itself. The
// `side` matches the direction the path bulges at that t, so the offset moves
// the tower off the path to the outside of the bend.
// Sine extrema fall at t = (0.5 + k) / (PATH_WAVES * 2); sign alternates.
const TOWER_LAYOUT: Array<{ t: number; side: -1 | 1 }> = [
  { t: 0.104, side: 1 },
  { t: 0.3125, side: -1 },
  { t: 0.52, side: 1 },
  { t: 0.729, side: -1 },
]

// How many worms can pile up bashing the gate before extras simply bounce off.
const MAX_SIEGERS = 6
const MAX_PRESSURE = MAX_SIEGERS
// How much "love" (hearts) the castle can bank as a protective shield.
const MAX_SHIELD = 6
const PROJECTILE_SPEED = 2.6 // progress per second (~0.38s flight)
const CROSS_TIME_SEC = 14 // base time for a worm to crawl entry → castle
const TOUGH_EVERY = 7 // every Nth worm is a 2-hp "thick" worm

// Sieger queue geometry: front sieger sits near the gate; the rest line up
// behind it along the path. Each lunges toward t=1 (the castle) and recoils.
const SIEGE_FRONT_T = 0.96
const SIEGE_GAP = 0.05
const SIEGE_LUNGE = 0.07
const SIEGE_RATE = 4.2 // radians/sec of the fling cycle

export class Game {
  bookworms: Bookworm[] = []
  siegers: Sieger[] = []
  towers: Tower[] = []
  projectiles: Projectile[] = []
  stats: GameStats = { score: 0, kills: 0, pressure: 0, shield: 0 }

  private targetWpm: number
  private spawnAccumulator = 0
  private spawnedCount = 0
  private clock = 0
  private nextId = 1
  private nextTowerIndex = 0

  constructor(targetWpm: number) {
    this.targetWpm = Math.max(1, targetWpm)
    this.towers = TOWER_LAYOUT.map((layout) => ({
      id: this.nextId++,
      t: layout.t,
      side: layout.side,
      flash: 0,
    }))
  }

  /** Advance the simulation by `dt` seconds. */
  step(dt: number): void {
    if (dt <= 0) return
    if (dt > 0.1) dt = 0.1 // clamp after a tab-switch / long frame
    this.clock += dt

    this.spawnTick(dt)
    this.moveBookworms(dt)
    this.updateSiegers()
    this.moveProjectiles(dt)
    this.decayTimers(dt)
    this.stats.pressure = this.siegers.length
  }

  /** Fire one tower at the highest-priority target. Called once per word. */
  fireTower(word: string): void {
    const aim = this.pickTarget()
    const tower = this.towers[this.nextTowerIndex % this.towers.length]
    this.nextTowerIndex++
    if (!tower) return
    this.launch(tower, aim, word)
  }

  /** All towers fire at once — used for milestone and rescue-word bursts. */
  burst(): void {
    const aims = this.pickTargets(this.towers.length)
    this.towers.forEach((tower, i) => {
      this.launch(tower, aims[i] ?? null, '★')
    })
  }

  /**
   * Rescue: the writer typed the surprise word while under siege. Scatter the
   * worms bashing the gate and fire a burst — the catch-up reward for getting
   * unstuck.
   */
  rescue(): void {
    this.siegers = []
    this.stats.pressure = 0
    this.burst()
  }

  private launch(tower: Tower, aim: Aim | null, word: string): void {
    tower.flash = 0.12
    if (aim) aim.ref.incoming += 1
    this.projectiles.push({
      id: this.nextId++,
      fromT: tower.t,
      fromSide: tower.side,
      targetId: aim ? aim.ref.id : null,
      targetT: aim ? aim.ref.t : 1, // both worms and siegers carry a live `t`
      progress: 0,
      word,
    })
  }

  // ---- internals -------------------------------------------------------

  private spawnTick(dt: number): void {
    // At the target pace, the writer produces ~targetWpm kills/min. Spawn a bit
    // slower than that so keeping pace clears the lane; falling behind lets the
    // swarm grow. (0.8 → 20% breathing room.)
    const spawnsPerSec = (this.targetWpm / 60) * 0.8
    const interval = 1 / spawnsPerSec
    this.spawnAccumulator += dt
    while (this.spawnAccumulator >= interval) {
      this.spawnAccumulator -= interval
      this.spawnWorm()
    }
  }

  private spawnWorm(): void {
    this.spawnedCount++
    const tough = this.spawnedCount % TOUGH_EVERY === 0
    const hp = tough ? 2 : 1
    this.bookworms.push({
      id: this.nextId++,
      t: 0,
      hp,
      maxHp: hp,
      // a little speed variety so the column doesn't march in lockstep
      speed: (1 / CROSS_TIME_SEC) * (0.85 + Math.random() * 0.4),
      wobble: Math.random() * Math.PI * 2,
      incoming: 0,
    })
  }

  private moveBookworms(dt: number): void {
    const survivors: Bookworm[] = []
    for (const w of this.bookworms) {
      w.t += w.speed * dt
      if (w.t >= 1) {
        // Reached the castle — join the siege at the gate (no HP loss). Extras
        // beyond the cap bounce off so the gate doesn't overflow visually.
        this.addSieger(Math.max(1, w.hp))
      } else {
        survivors.push(w)
      }
    }
    this.bookworms = survivors
  }

  private addSieger(hp: number): void {
    // Shield (banked love) absorbs the worm at the gate, delaying the siege.
    if (this.stats.shield > 0) {
      this.stats.shield -= 1
      return
    }
    if (this.siegers.length >= MAX_SIEGERS) return
    this.siegers.push({
      id: this.nextId++,
      hp,
      maxHp: hp,
      incoming: 0,
      phase: Math.random() * Math.PI * 2,
      t: SIEGE_FRONT_T,
    })
  }

  /** Queue siegers along the path near the gate; each flings at the castle. */
  private updateSiegers(): void {
    this.siegers.forEach((s, i) => {
      // Squared sine → spends most of the cycle pulled back, then a quick fling
      // forward that taps the gate (t→1) and recoils.
      const v = (Math.sin(this.clock * SIEGE_RATE + s.phase) + 1) / 2
      const lunge = v * v * SIEGE_LUNGE
      s.t = Math.min(1, SIEGE_FRONT_T - i * SIEGE_GAP + lunge)
    })
  }

  private moveProjectiles(dt: number): void {
    const survivors: Projectile[] = []
    for (const p of this.projectiles) {
      p.progress += PROJECTILE_SPEED * dt
      // track the live target's current position (worm or sieger)
      if (p.targetId != null) {
        const target =
          this.bookwormById(p.targetId) ??
          this.siegers.find((s) => s.id === p.targetId) ??
          null
        if (target) p.targetT = target.t
      }

      if (p.progress >= 1) {
        if (p.targetId != null) this.hitById(p.targetId)
        // A targetless shot is "love" — it reaches the castle and banks shield.
        else this.stats.shield = Math.min(MAX_SHIELD, this.stats.shield + 1)
        continue // projectile consumed
      }
      survivors.push(p)
    }
    this.projectiles = survivors
  }

  private hitById(id: number): void {
    const worm = this.bookwormById(id)
    if (worm) {
      worm.hp -= 1
      worm.incoming = Math.max(0, worm.incoming - 1)
      if (worm.hp <= 0) {
        this.bookworms = this.bookworms.filter((w) => w.id !== id)
        this.recordKill(worm.maxHp)
      }
      return
    }
    const sieger = this.siegers.find((s) => s.id === id)
    if (sieger) {
      sieger.hp -= 1
      sieger.incoming = Math.max(0, sieger.incoming - 1)
      if (sieger.hp <= 0) {
        this.siegers = this.siegers.filter((s) => s.id !== id)
        this.recordKill(sieger.maxHp)
      }
    }
  }

  private recordKill(maxHp: number): void {
    this.stats.kills++
    this.stats.score += maxHp * 10
  }

  private decayTimers(dt: number): void {
    for (const tower of this.towers) {
      if (tower.flash > 0) tower.flash = Math.max(0, tower.flash - dt)
    }
  }

  /**
   * Highest-priority target: a worm bashing the gate first (clear the siege!),
   * otherwise the front-most crawler. Skips targets already doomed by in-flight
   * projectiles, falling back to one anyway so the shot still flies.
   */
  private pickTarget(): Aim | null {
    for (const s of this.siegers) {
      if (s.hp - s.incoming > 0) return { ref: s, isSieger: true }
    }
    let best: Bookworm | null = null
    for (const w of this.bookworms) {
      if (w.hp - w.incoming <= 0) continue
      if (!best || w.t > best.t) best = w
    }
    if (best) return { ref: best, isSieger: false }
    // Everything is already doomed — aim somewhere visible anyway.
    if (this.siegers[0]) return { ref: this.siegers[0], isSieger: true }
    for (const w of this.bookworms) {
      if (!best || w.t > best.t) best = w
    }
    return best ? { ref: best, isSieger: false } : null
  }

  /** Up to `n` distinct targets for a burst — siegers first, then crawlers. */
  private pickTargets(n: number): Aim[] {
    const out: Aim[] = []
    for (const s of this.siegers) {
      if (s.hp - s.incoming > 0) {
        out.push({ ref: s, isSieger: true })
        if (out.length >= n) return out
      }
    }
    const liveWorms = this.bookworms
      .filter((w) => w.hp - w.incoming > 0)
      .sort((a, b) => b.t - a.t)
    for (const w of liveWorms) {
      out.push({ ref: w, isSieger: false })
      if (out.length >= n) break
    }
    return out
  }

  private bookwormById(id: number): Bookworm | null {
    return this.bookworms.find((w) => w.id === id) ?? null
  }
}

export { MAX_PRESSURE, MAX_SIEGERS, MAX_SHIELD }
